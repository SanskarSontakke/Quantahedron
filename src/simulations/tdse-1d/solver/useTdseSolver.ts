'use client';

/**
 * Sim 3 — the single place the TDSE sandbox talks to its solver.
 *
 * Strategy, in priority order:
 *   1. **Web Worker** — `new Worker(new URL('../engine/workers/tdseWorker.ts',
 *      import.meta.url), { type: 'module' })`, i.e. the entry that webpack emits as
 *      its own chunk, resolved from *this* file into
 *      `src/simulations/tdse-1d/engine/workers/tdseWorker.ts`. The main thread owns
 *      the clock: `pump()` is called once per animation frame and posts
 *      `{type:'frame', steps}`; at most one request is ever in flight (a second
 *      request is coalesced, not queued), so a slow device loses frames instead of
 *      building a message backlog.
 *   2. **Synchronous main-thread fallback** driving the very same {@link TdseCore}
 *      the worker wraps. It engages when `typeof Worker === 'undefined'` (SSR,
 *      jsdom, tests), when constructing the worker throws (blocked blob URL,
 *      strict CSP, worker chunk fetch failure) or when the worker later fires
 *      `onerror`. Because the physics lives in `TdseCore` and not in the worker,
 *      both paths produce bit-identical evolution.
 *
 * React never re-renders to animate: the caller reads `stateRef.current` inside
 * its own rAF callback.
 */

import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { TdseCore, type StateDiagnostics } from '@/engine/physics/crankNicolson';
import type {
  TdseWorkerFrame,
  TdseWorkerRequest,
  TdseWorkerResponse,
  TdseWorkerSpectrum,
} from '../engine/workers/tdseWorker';
import type { SimParams } from '@/simulations/types';
import { liveTdse } from '../model';
import {
  buildSetup,
  eigenCountOf,
  needsSpectrum,
  packetSig,
  potentialSig,
  type TdseSetup,
} from '../model';

export interface TdseFrameView {
  re: Float64Array;
  im: Float64Array;
  /** |⟨φₖ|ψ⟩|², empty while no spectrum is loaded. */
  weights: Float64Array;
  diag: StateDiagnostics | null;
  /** Probability removed by the sponge since the packet was launched. */
  drained: number;
  simTime: number;
  steps: number;
  computeMs: number;
  /** Frames delivered since mount — lets the canvas detect a stalled worker. */
  seq: number;
}

export interface TdseSpectrumView {
  energies: Float64Array;
  /** count × n eigenfunctions, column-major, ∫|φ|²dx = 1. */
  states: Float64Array;
  count: number;
  n: number;
  computeMs: number;
}

export interface TdseSolverState {
  setup: TdseSetup | null;
  frame: TdseFrameView;
  spectrum: TdseSpectrumView;
  worker: boolean;
  /** True once the transport has accepted an init (or immediately in sync mode). */
  ready: boolean;
  /** Change detectors so nothing is rebuilt twice. */
  potSig: string;
  packSig: string;
  specSig: string;
  dtSig: number;
  /** performance.now() of the last delivered frame. */
  lastDelivery: number;
}

export interface TdseSolver {
  stateRef: RefObject<TdseSolverState>;
  /** Align the solver with `p` (rebuilding only what changed) and advance `steps` CN steps. */
  pump: (p: SimParams, steps: number) => void;
  /** Rebuild ψ and the propagator from scratch (R key, demo jump, grid change). */
  reset: (p: SimParams) => void;
}

const EMPTY = new Float64Array(0);

function initialState(): TdseSolverState {
  return {
    setup: null,
    frame: {
      re: EMPTY,
      im: EMPTY,
      weights: EMPTY,
      diag: null,
      drained: 0,
      simTime: 0,
      steps: 0,
      computeMs: 0,
      seq: 0,
    },
    spectrum: { energies: EMPTY, states: EMPTY, count: 0, n: 0, computeMs: 0 },
    worker: false,
    ready: false,
    potSig: '',
    packSig: '',
    specSig: '',
    dtSig: 0,
    lastDelivery: 0,
  };
}

export function useTdseSolver(): TdseSolver {
  const stateRef = useRef<TdseSolverState>(initialState());
  const workerRef = useRef<Worker | null>(null);
  const coreRef = useRef<TdseCore | null>(null);
  const inFlightRef = useRef(false);
  const queuedRef = useRef<number | null>(null);

  /* ------------------------------ main thread ------------------------------ */

  /** Create (or reuse) the fallback core, resuming from the last frame if we have one. */
  const ensureCore = useCallback((): TdseCore | null => {
    const s = stateRef.current;
    if (!s.setup) return null;
    const resume = s.frame.re.length === s.setup.n ? s.frame.re : s.setup.re;
    const resumeIm = s.frame.im.length === s.setup.n ? s.frame.im : s.setup.im;
    coreRef.current = new TdseCore({
      n: s.setup.n,
      dx: s.setup.dx,
      dt: s.setup.dt,
      v: s.setup.v,
      cap: s.setup.cap,
      re: resume,
      im: resumeIm,
      origin: s.setup.origin,
    });
    if (s.spectrum.count > 0) coreRef.current.computeSpectrum(s.spectrum.count);
    return coreRef.current;
  }, []);

  const acceptSyncFrame = useCallback((steps: number): void => {
    const s = stateRef.current;
    const core = coreRef.current ?? ensureCore();
    if (!core) return;
    const t0 = performance.now();
    const snap = core.frame(steps);
    const computeMs = performance.now() - t0;
    s.frame = {
      re: snap.re,
      im: snap.im,
      weights: snap.weights,
      drained: snap.drained,
      diag: snap.diag,
      simTime: snap.simTime,
      steps: snap.steps,
      computeMs,
      seq: s.frame.seq + 1,
    };
    s.ready = true;
    s.lastDelivery = t0;
  }, [ensureCore]);

  const readSyncSpectrum = useCallback((count: number): void => {
    const s = stateRef.current;
    const n = s.setup ? s.setup.n : 0;
    const core = coreRef.current ?? ensureCore();
    if (!core) return;
    const t0 = performance.now();
    if (count <= 0) core.clearSpectrum();
    else core.computeSpectrum(count);
    const energies = core.energies;
    const states = core.eigenStates;
    s.spectrum =
      count > 0 && energies && states
        ? {
            energies: Float64Array.from(energies),
            states: Float64Array.from(states),
            count: core.spectrumCount,
            n,
            computeMs: performance.now() - t0,
          }
        : { energies: EMPTY, states: EMPTY, count: 0, n, computeMs: 0 };
  }, [ensureCore]);

  /* -------------------------------- worker --------------------------------- */

  const send = useCallback((request: TdseWorkerRequest): void => {
    const worker = workerRef.current;
    if (!worker) return;
    try {
      worker.postMessage(request);
    } catch {
      // A postMessage failure (e.g. a non-cloneable payload after a transfer)
      // must not kill the simulation: the next pump takes the sync path.
      workerRef.current = null;
      inFlightRef.current = false;
      stateRef.current.worker = false;
      try {
        worker.terminate();
      } catch {
        /* already gone */
      }
    }
  }, []);

  const acceptWorkerFrame = useCallback((msg: TdseWorkerFrame): void => {
    const s = stateRef.current;
    s.frame = {
      re: msg.re,
      im: msg.im,
      weights: msg.weights,
      drained: msg.drained,
      diag: msg.diag,
      simTime: msg.simTime,
      steps: msg.steps,
      computeMs: msg.computeMs,
      seq: s.frame.seq + 1,
    };
    s.ready = true;
    s.lastDelivery = performance.now();
  }, []);

  const acceptWorkerSpectrum = useCallback((msg: TdseWorkerSpectrum): void => {
    const s = stateRef.current;
    s.spectrum = {
      energies: msg.energies,
      states: msg.states,
      count: msg.count,
      n: s.setup ? s.setup.n : 0,
      computeMs: msg.computeMs,
    };
  }, []);

  const requestFrame = useCallback(
    (steps: number): void => {
      const s = stateRef.current;
      if (s.worker && workerRef.current) {
        if (inFlightRef.current) {
          queuedRef.current = steps;
          return;
        }
        inFlightRef.current = true;
        send({ type: 'frame', steps });
        return;
      }
      acceptSyncFrame(steps);
    },
    [acceptSyncFrame, send],
  );

  /** Ship the full state (potential + sponge + ψ) to the active transport. */
  const install = useCallback(
    (setup: TdseSetup, spectrumCount: number, resume: boolean): void => {
      const s = stateRef.current;
      s.setup = setup;
      s.spectrum = { energies: EMPTY, states: EMPTY, count: 0, n: setup.n, computeMs: 0 };
      // Editing V(x) keeps the wavefunction that is already flying through it —
      // only an explicit reset (or a grid change) relaunches the packet.
      const live = resume && s.frame.re.length === setup.n && s.frame.im.length === setup.n;
      const re = live ? s.frame.re : setup.re;
      const im = live ? s.frame.im : setup.im;
      if (s.worker && workerRef.current) {
        send({
          type: 'init',
          n: setup.n,
          dx: setup.dx,
          dt: setup.dt,
          origin: setup.origin,
          v: Float64Array.from(setup.v),
          cap: Float64Array.from(setup.cap),
          re: Float64Array.from(re),
          im: Float64Array.from(im),
          spectrum: spectrumCount,
        });
        return;
      }
      coreRef.current = null;
      ensureCore();
      if (spectrumCount > 0) readSyncSpectrum(spectrumCount);
      else s.ready = true;
    },
    [ensureCore, readSyncSpectrum, send],
  );

  /* ------------------------------- lifecycle ------------------------------- */

  useEffect(() => {
    if (typeof Worker === 'undefined') return undefined;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../engine/workers/tdseWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      worker = null;
    }
    if (!worker) return undefined;
    const s = stateRef.current;
    s.worker = true;
    worker.onmessage = (event: MessageEvent<TdseWorkerResponse>) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'frame') {
        inFlightRef.current = false;
        acceptWorkerFrame(msg);
        const queued = queuedRef.current;
        queuedRef.current = null;
        if (queued !== null) requestFrame(queued);
      } else if (msg.type === 'spectrum') {
        acceptWorkerSpectrum(msg);
      } else {
        s.ready = true;
      }
    };
    // Any runtime worker failure: keep simulating on the main thread.
    worker.onerror = () => {
      workerRef.current = null;
      inFlightRef.current = false;
      queuedRef.current = null;
      s.worker = false;
      try {
        worker?.terminate();
      } catch {
        /* ignore */
      }
      coreRef.current = null;
      ensureCore();
    };
    workerRef.current = worker;
    return () => {
      workerRef.current = null;
      inFlightRef.current = false;
      queuedRef.current = null;
      s.worker = false;
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
    };
    // Mount-once: every later parameter change flows through pump().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --------------------------------- pump ---------------------------------- */

  const pump = useCallback(
    (p: SimParams, steps: number): void => {
      const s = stateRef.current;
      const wantSpec = needsSpectrum(p);
      const count = wantSpec ? eigenCountOf(p) : 0;
      const spec = wantSpec ? `on|${count}` : 'off|0';
      const potSig = potentialSig(p);
      const packSig = packetSig(p);

      if (!s.setup || potSig !== s.potSig) {
        const setup = buildSetup(p);
        s.potSig = potSig;
        s.packSig = packSig;
        s.specSig = spec;
        s.dtSig = setup.dt;
        install(setup, count, true);
        requestFrame(Math.max(0, Math.round(steps)));
        return;
      }

      if (spec !== s.specSig) {
        s.specSig = spec;
        if (s.worker && workerRef.current) send({ type: 'spectrum', count });
        else readSyncSpectrum(count);
      }

      if (packSig !== s.packSig) {
        s.packSig = packSig;
        const next = buildSetup(p);
        s.setup = next;
        if (s.worker && workerRef.current) {
          send({
            type: 'packet',
            re: Float64Array.from(next.re),
            im: Float64Array.from(next.im),
            renormalize: false,
          });
        } else if (coreRef.current) {
          coreRef.current.setPsi(next.re, next.im, false);
        }
      }

      if (s.setup.dt !== s.dtSig) {
        s.dtSig = s.setup.dt;
        if (s.worker && workerRef.current) send({ type: 'dt', dt: s.setup.dt });
        else coreRef.current?.setTimeStep(s.setup.dt);
      }

      requestFrame(Math.max(0, Math.round(steps)));
    },
    [install, readSyncSpectrum, requestFrame, send],
  );

  const reset = useCallback(
    (p: SimParams): void => {
      const s = stateRef.current;
      const setup = buildSetup(p);
      const wantSpec = needsSpectrum(p);
      const count = wantSpec ? eigenCountOf(p) : 0;
      s.potSig = potentialSig(p);
      s.packSig = packetSig(p);
      s.specSig = wantSpec ? `on|${count}` : 'off|0';
      s.dtSig = setup.dt;
      coreRef.current = null;
      inFlightRef.current = false;
      queuedRef.current = null;
      install(setup, count, false);
      liveTdse.maxDrift = 0;
      liveTdse.drained = 0;
      requestFrame(0);
    },
    [install, requestFrame],
  );

  // Stable identity: the canvas keeps `solver` in its rAF dependency list.
  const api = useMemo<TdseSolver>(() => ({ stateRef, pump, reset }), [pump, reset]);
  return api;
}
