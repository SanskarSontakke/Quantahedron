/**
 * Web Worker bridge for the 1D time-dependent Schrödinger solver.
 *
 * Location note: this entry lives next to the simulation that owns it because
 * webpack only emits a worker chunk for a specifier it can resolve from the
 * *call site* — `new URL('../engine/workers/tdseWorker.ts', import.meta.url)`
 * inside `src/simulations/tdse-1d/solver/` maps to exactly this file. The physics
 * it drives is imported from the shared engine, so the worker and the
 * main-thread fallback run the same `TdseCore`.
 *
 * The Crank–Nicolson step is a synchronous O(N) tridiagonal solve repeated
 * `stepsPerFrame` times per animation frame. At N = 512 that is a few hundred
 * microseconds of *pure* floating-point work — small, but on the main thread it
 * competes with layout, the inspector sliders and the canvas raster, and any GC
 * pause shows up as a dropped frame. Running it here keeps the viewport at 60 fps
 * and leaves the eigenvalue diagonalisation (20-60 ms whenever V(x) is edited)
 * completely off the UI thread.
 *
 * Contract (deliberately request/response, never a self-driving timer):
 *   main → worker  { type: 'frame', steps }     advance and send ψ back
 *   worker → main  { type: 'frame', re, im, … }  transferable buffers, zero-copy
 * The main thread owns the clock (`useAnimationClock`), so pausing, time-scaling,
 * the Demo Director and tab-hidden throttling all work without worker-side state
 * machines, and at most one frame is ever in flight.
 *
 * Everything numerical lives in {@link TdseCore} inside the physics module, which
 * the synchronous main-thread fallback drives identically — the worker is only a
 * message pump, so both paths are guaranteed to agree bit for bit.
 *
 * Typing note: the project compiles with `lib: ["dom", …]` and no WebWorker lib,
 * so `self` here would be typed as `Window`. The scope object is therefore taken
 * from `globalThis` through a minimal structural interface instead.
 */

import { TdseCore, type StateDiagnostics } from '../../../../engine/physics/crankNicolson';

/* -------------------------------- protocol -------------------------------- */

export type TdseWorkerRequest =
  | {
      type: 'init';
      n: number;
      dx: number;
      dt: number;
      origin: number;
      v: Float64Array;
      cap: Float64Array;
      re: Float64Array;
      im: Float64Array;
      spectrum: number;
    }
  | { type: 'potential'; v: Float64Array; cap: Float64Array; spectrum: number }
  | { type: 'packet'; re: Float64Array; im: Float64Array; renormalize?: boolean }
  | { type: 'dt'; dt: number }
  | { type: 'spectrum'; count: number }
  | { type: 'frame'; steps: number };

export interface TdseWorkerFrame {
  type: 'frame';
  re: Float64Array;
  im: Float64Array;
  /** |⟨φₖ|ψ⟩|² for the current spectrum, empty while no spectrum is loaded. */
  weights: Float64Array;
  /** Probability the sponge has drained since the packet was launched. */
  drained: number;
  diag: StateDiagnostics;
  simTime: number;
  steps: number;
  /** Wall time spent propagating, for the solver-load HUD. */
  computeMs: number;
}

export interface TdseWorkerSpectrum {
  type: 'spectrum';
  energies: Float64Array;
  states: Float64Array;
  count: number;
  computeMs: number;
}

export interface TdseWorkerReady {
  type: 'ready';
  n: number;
  /** True once a spectrum has been pushed with the init payload. */
  hasSpectrum: boolean;
}

export type TdseWorkerResponse = TdseWorkerReady | TdseWorkerFrame | TdseWorkerSpectrum;

/* ------------------------------- worker body ------------------------------- */

/**
 * Structural view of the worker global scope. `globalThis` is the only portable
 * way to reach it while the DOM lib claims `self` is a `Window`.
 */
interface WorkerScope {
  postMessage(message: TdseWorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

let core: TdseCore | null = null;

function post(message: TdseWorkerResponse, transfer?: Transferable[]): void {
  scope.postMessage(message, transfer);
}

function spectrumPayload(): TdseWorkerSpectrum | null {
  if (!core) return null;
  const energies = core.energies;
  const states = core.eigenStates;
  if (!energies || !states) return null;
  return {
    type: 'spectrum',
    energies: Float64Array.from(energies),
    states: Float64Array.from(states),
    count: core.spectrumCount,
    computeMs: 0,
  };
}

function handle(request: TdseWorkerRequest): void {
  switch (request.type) {
    case 'init': {
      core = new TdseCore({
        n: request.n,
        dx: request.dx,
        dt: request.dt,
        v: request.v,
        cap: request.cap,
        re: request.re,
        im: request.im,
        origin: request.origin,
      });
      let started = 0;
      if (request.spectrum > 0) {
        const t0 = performance.now();
        core.computeSpectrum(request.spectrum);
        started = performance.now() - t0;
      }
      const payload = spectrumPayload();
      if (payload) post({ ...payload, computeMs: started });
      post({ type: 'ready', n: request.n, hasSpectrum: payload !== null });
      return;
    }
    case 'potential': {
      if (!core) return;
      core.setPotential(request.v, request.cap);
      if (request.spectrum > 0) {
        const t0 = performance.now();
        core.computeSpectrum(request.spectrum);
        const payload = spectrumPayload();
        if (payload) post({ ...payload, computeMs: performance.now() - t0 });
      } else {
        core.clearSpectrum();
      }
      return;
    }
    case 'packet': {
      if (!core) return;
      core.setPsi(request.re, request.im, request.renormalize ?? true);
      const snapshot = core.frame(0);
      post(
        {
          type: 'frame',
          re: snapshot.re,
          im: snapshot.im,
          weights: snapshot.weights,
          drained: snapshot.drained,
          diag: snapshot.diag,
          simTime: snapshot.simTime,
          steps: snapshot.steps,
          computeMs: 0,
        },
        [snapshot.re.buffer, snapshot.im.buffer, snapshot.weights.buffer],
      );
      return;
    }
    case 'dt': {
      core?.setTimeStep(request.dt);
      return;
    }
    case 'spectrum': {
      if (!core) return;
      const t0 = performance.now();
      core.computeSpectrum(request.count);
      const payload = spectrumPayload();
      if (payload) post({ ...payload, computeMs: performance.now() - t0 });
      return;
    }
    case 'frame': {
      if (!core) return;
      const t0 = performance.now();
      const snapshot = core.frame(request.steps);
      const computeMs = performance.now() - t0;
      post(
        {
          type: 'frame',
          re: snapshot.re,
          im: snapshot.im,
          weights: snapshot.weights,
          drained: snapshot.drained,
          diag: snapshot.diag,
          simTime: snapshot.simTime,
          steps: snapshot.steps,
          computeMs,
        },
        [snapshot.re.buffer, snapshot.im.buffer, snapshot.weights.buffer],
      );
      return;
    }
    default:
      return;
  }
}

scope.onmessage = (event: { data: unknown }) => {
  const data = event.data;
  if (typeof data !== 'object' || data === null) return;
  handle(data as TdseWorkerRequest);
};
