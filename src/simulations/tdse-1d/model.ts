/**
 * Sim 3 — 1D TDSE Sandbox: parameter ⇄ physics bridge.
 *
 * Everything the store holds is a flat scalar; this file is the only place that
 * turns those scalars into solver arrays, so the Web Worker path and the
 * synchronous main-thread path are guaranteed to start from *identical* data.
 *
 * Unit convention (documented once, here):
 *   ℏ = m = 1 atomic-style units, box x ∈ [−D/2, +D/2] with D = {@link TDSE_BOX_AU},
 *   `dx = D / gridN`. Positions `x0`, widths `sigma`, `wellWidth`, `barrierGap`,
 *   `capWidth` and the brush are all *fractions of the domain* (0..1) so a slider
 *   reads the same at every resolution; the wavenumber slider `k0` is dimensionless
 *   (k = k0/D), which makes `k0 = 60` exactly the energy E = 8 a.u. = default V0.
 */

import {
  TDSE_BOX_AU,
  buildCap,
  buildPotential,
  gaussianPacket,
  type PotentialKind,
  type StateDiagnostics,
} from '@/engine/physics/crankNicolson';
import type { SimParams } from '@/simulations/types';
import { pArr, pBool, pNum, pStr } from '@/store/useSimStore';

/** Brush resolution: 256 ≤ 512 samples keeps the permalink short. */
export const BRUSH_SAMPLES = 256;
export const BOX_AU = TDSE_BOX_AU;
export const ORIGIN_AU = -BOX_AU / 2;

export const TDSE_VIEWS = ['density', 'reim', 'spectrum', 'absorbing'] as const;
export type TdseView = (typeof TDSE_VIEWS)[number];

export const POTENTIALS: { value: PotentialKind; label: string }[] = [
  { value: 'infinite', label: 'Infinite well' },
  { value: 'finite', label: 'Finite well' },
  { value: 'double', label: 'Double well' },
  { value: 'kronig', label: 'Kronig–Penney' },
  { value: 'custom', label: 'Draw your own' },
];

export function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Grid sizes stay powers of two so the FFT-based sims share the same lattice. */
export function gridNOf(p: SimParams): number {
  return nearestPow2(Math.round(clampNum(pNum(p, 'gridN', 512), 128, 1024)));
}

function nearestPow2(n: number): number {
  let p = 128;
  while (p < n && p < 1024) p *= 2;
  return p;
}

export function viewOf(p: SimParams): TdseView {
  const v = pStr(p, 'view', 'density');
  return (TDSE_VIEWS as readonly string[]).includes(v) ? (v as TdseView) : 'density';
}

/* ---------------------------- change signatures ---------------------------- */

/** Cheap identity for V(x) + grid + sponge: recompute the solver only on change. */
export function potentialSig(p: SimParams): string {
  const custom = pArr(p, 'customV');
  let hash = 0;
  for (let i = 0; i < custom.length; i++) {
    hash = (hash * 31 + Math.round(clampNum(custom[i], -1e6, 1e6) * 1000)) | 0;
  }
  return [
    pStr(p, 'potential', 'double'),
    gridNOf(p),
    pNum(p, 'V0', 8),
    pNum(p, 'wellWidth', 0.34),
    pNum(p, 'barrierGap', 0.18),
    pNum(p, 'asymmetry', 0),
    pNum(p, 'kronigPeriods', 6),
    pNum(p, 'latticeDepth', 6),
    pNum(p, 'capWidth', 0.06),
    pNum(p, 'capStrength', 0.35),
    custom.length,
    hash,
  ].join('|');
}

/** Changing any of these re-launches ψ from scratch (clock rewinds to t = 0). */
export function packetSig(p: SimParams): string {
  return [
    pNum(p, 'x0', 0.5),
    pNum(p, 'sigma', 0.05),
    pNum(p, 'k0', 60),
    pNum(p, 'packetAmp', 1),
    gridNOf(p),
  ].join('|');
}

/* --------------------------------- builder --------------------------------- */

export interface TdseSetup {
  n: number;
  dx: number;
  dt: number;
  origin: number;
  v: Float64Array;
  cap: Float64Array;
  re: Float64Array;
  im: Float64Array;
  /** ‖ψ‖² right after launch — norm drift is measured against this. */
  norm0: number;
  /** Peak of the initial |ψ|², used to keep the vertical scale honest. */
  peak0: number;
  /** Physical packet width and wavenumber, for the read-outs. */
  sigmaAu: number;
  kAu: number;
}

/** Assemble V(x), the absorbing sponge and the initial Gaussian packet. */
export function buildSetup(p: SimParams): TdseSetup {
  const n = gridNOf(p);
  const dx = BOX_AU / n;
  const kind = pStr(p, 'potential', 'double') as PotentialKind;
  const v = buildPotential(kind, {
    n,
    V0: pNum(p, 'V0', 8),
    wellWidth: clampNum(pNum(p, 'wellWidth', 0.34), 0.02, 0.98),
    barrierGap: clampNum(pNum(p, 'barrierGap', 0.18), 0, 0.9),
    asymmetry: clampNum(pNum(p, 'asymmetry', 0), -1, 1),
    kronigPeriods: Math.round(clampNum(pNum(p, 'kronigPeriods', 6), 1, 24)),
    latticeDepth: clampNum(pNum(p, 'latticeDepth', 6), 0, 60),
    custom: pArr(p, 'customV'),
  });
  const cap = buildCap(n, clampNum(pNum(p, 'capWidth', 0.06), 0, 0.3), pNum(p, 'capStrength', 0.35));

  const sigmaAu = clampNum(pNum(p, 'sigma', 0.05), 0.004, 0.5) * BOX_AU;
  const kAu = pNum(p, 'k0', 60) / BOX_AU;
  const amp = clampNum(pNum(p, 'packetAmp', 1), 0.05, 4);
  const [re, im] = gaussianPacket(
    n,
    dx,
    (clampNum(pNum(p, 'x0', 0.5), 0.02, 0.98) - 0.5) * BOX_AU,
    sigmaAu,
    kAu,
    1,
    ORIGIN_AU,
  );
  // `packetAmp` is the *initial norm* ‖ψ‖ (not the peak): the CN map is linear and
  // unitary, so scaling ψ scales every expectation value consistently.
  const scale = Math.sqrt(amp);
  let peak = 0;
  for (let j = 0; j < n; j++) {
    re[j] *= scale;
    im[j] *= scale;
    const d = (re[j] * re[j] + im[j] * im[j]) * dx;
    if (d > peak) peak = d;
  }
  return {
    n,
    dx,
    dt: clampNum(pNum(p, 'dt', 0.0004), 5e-5, 8e-3),
    origin: ORIGIN_AU,
    v,
    cap,
    re,
    im,
    norm0: amp,
    peak0: peak,
    sigmaAu,
    kAu,
  };
}

/** Stability guard shown in the HUD: CN is unconditionally stable, but a single
 *  step must still resolve the fastest phase, Δt·E_max ≪ 1. */
export function phasePerStep(setup: TdseSetup): number {
  let vmax = 0;
  for (let j = 0; j < setup.n; j++) {
    if (setup.v[j] > vmax) vmax = setup.v[j];
  }
  const kineticCeil = 4 / (setup.dx * setup.dx); // top of the lattice band, ℏ=m=1
  return setup.dt * (vmax + kineticCeil);
}

/* --------------------------- live solver read-out --------------------------- */

/**
 * Mutable channel from the animation loop to the Inspector's Diagnostics tab.
 * Simulation state stays in the store; this only carries *measured* numbers that
 * would be pointless to permalink (they depend on how long you watched).
 */
export interface LiveTdse {
  ready: boolean;
  worker: boolean;
  t: number;
  steps: number;
  norm: number;
  norm0: number;
  /** Probability the sponge has physically drained since launch. */
  drained: number;
  /** |norm + drained − norm₀|: the pure unitarity error, sponge accounted for. */
  drift: number;
  maxDrift: number;
  x: number;
  p: number;
  energy: number;
  kinetic: number;
  potentialE: number;
  peak: number;
  weightsSum: number;
  topLevel: number;
  topWeight: number;
  fps: number;
  solverMs: number;
  diagMs: number;
  eigenCount: number;
  /** Frame-rate-independent wall time since the solver produced its last frame. */
  lastFrameMs: number;
  /** Borrowed (never copied) references to the live spectrum buffers. */
  weights: Float64Array | null;
  energies: Float64Array | null;
}

export const liveTdse: LiveTdse = {
  ready: false,
  worker: false,
  t: 0,
  steps: 0,
  norm: 1,
  norm0: 1,
  drained: 0,
  drift: 0,
  maxDrift: 0,
  x: 0,
  p: 0,
  energy: 0,
  kinetic: 0,
  potentialE: 0,
  peak: 0,
  weightsSum: 0,
  topLevel: -1,
  topWeight: 0,
  fps: 0,
  solverMs: 0,
  diagMs: 0,
  eigenCount: 0,
  lastFrameMs: 0,
  weights: null,
  energies: null,
};

/** Fold a frame into the live read-out and track the worst norm drift seen. */
export function publishLive(
  diag: StateDiagnostics,
  norm0: number,
  drained: number,
  weights: Float64Array,
  energies: Float64Array | null,
): void {
  liveTdse.ready = true;
  liveTdse.norm = diag.norm;
  liveTdse.norm0 = norm0;
  liveTdse.drained = drained;
  // The sponge is a *physical* sink: the integrator is unitary, so norm plus the
  // probability billed by exp(−Δt W/ℏ) must still add up to the launch value.
  liveTdse.drift = Math.abs(diag.norm + drained - norm0);
  if (liveTdse.drift > liveTdse.maxDrift) liveTdse.maxDrift = liveTdse.drift;
  liveTdse.x = diag.x;
  liveTdse.p = diag.p;
  liveTdse.energy = diag.energy;
  liveTdse.kinetic = diag.kinetic;
  liveTdse.potentialE = diag.energy - diag.kinetic;
  liveTdse.peak = diag.peak;
  let sum = 0;
  let top = -1;
  let topW = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i];
    if (weights[i] > topW) {
      topW = weights[i];
      top = i;
    }
  }
  liveTdse.weightsSum = sum;
  liveTdse.topLevel = top;
  liveTdse.topWeight = topW;
  liveTdse.weights = weights;
  liveTdse.energies = energies;
}

/* --------------------------------- helpers --------------------------------- */

export function showPotentialOverlay(p: SimParams): boolean {
  return pBool(p, 'showPotential', true);
}

export function eigenCountOf(p: SimParams): number {
  return Math.round(clampNum(pNum(p, 'eigenCount', 12), 2, 32));
}

/**
 * The spectrum (matrix diagonalisation) is expensive enough to keep off the
 * per-frame path, so it is only requested by the two views that show it: the
 * eigenstate bar chart and the level overlay on the density plot.
 */
export function needsSpectrum(p: SimParams): boolean {
  return viewOf(p) === 'spectrum' || pBool(p, 'showEigen', true);
}

/** Normalised x (0..1) of a physical coordinate, for drawing. */
export function auToU(xAu: number): number {
  return xAu / BOX_AU + 0.5;
}
