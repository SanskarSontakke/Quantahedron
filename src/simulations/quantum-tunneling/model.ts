/**
 * Sim 4 — Quantum Tunneling & Barrier Lab: parameter ⇄ physics bridge.
 *
 * Unit convention (ℏ = 1, tunable mass):
 *   box x ∈ [−ℒ/2, +ℒ/2] with ℒ = {@link TUN_BOX_AU} = 24 a.u., `dx = ℒ/gridN`;
 *   `E0` is the packet's mean kinetic energy measured in the V = 0 leads, so the
 *   central wavenumber is exactly k₀ = √(2·m·E₀);
 *   `sigmaK` is the momentum spread in the same dimensionless units, Δk = sigmaK/ℒ,
 *   which makes the launched Gaussian the minimum-uncertainty one, σ_x = ℒ/(2·sigmaK);
 *   `width`, `gap`, `tilt`, `packetX`, `capWidth` are fractions of the domain, so a
 *   slider reads the same geometry at every resolution.
 *
 * Every analytic number the UI shows comes from the closed forms in
 * `@/engine/physics/splitStepFFT` (`transmissionRectangular`, `transmissionDouble`,
 * `transferMatrixTransmission`, `evanescentKappa`, `transmissionWkb`), which is what
 * lets the *simulated* packet be judged against exact theory frame by frame.
 */

import { buildCap, gaussianPacket } from '@/engine/physics/crankNicolson';
import {
  evanescentKappa,
  transferMatrixTransmission,
  transmissionDouble,
  transmissionRectangular,
  transmissionWkb,
} from '@/engine/physics/splitStepFFT';
import type { SimParams } from '@/simulations/types';
import { pBool, pNum, pStr } from '@/store/useSimStore';

export const TUN_BOX_AU = 24;
export const TUN_ORIGIN_AU = -TUN_BOX_AU / 2;
/** Sponge peak W₀ scale: exp(−Δt·W/ℏ) drains ~e⁻¹ per step at full strength. */
export const TUN_CAP_SCALE = 260;

export const TUN_VIEWS = ['wave', 'transmission', 'both'] as const;
export type TunnelView = (typeof TUN_VIEWS)[number];

export const BARRIERS = [
  { value: 'rect', label: 'Rectangular' },
  { value: 'tri', label: 'Triangular (tilted)' },
  { value: 'double', label: 'Double barrier' },
] as const;
export type BarrierKind = (typeof BARRIERS)[number]['value'];

export function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** SSFM needs a power-of-two grid; 128…4096 covers everything useful here. */
export function gridTOf(p: SimParams): number {
  const want = Math.round(clampNum(pNum(p, 'gridN', 1024), 128, 4096));
  let n = 128;
  while (n < want && n < 4096) n *= 2;
  return n;
}

export function viewOf(p: SimParams): TunnelView {
  const v = pStr(p, 'view', 'both');
  return (TUN_VIEWS as readonly string[]).includes(v) ? (v as TunnelView) : 'both';
}

export function barrierOf(p: SimParams): BarrierKind {
  const b = pStr(p, 'barrier', 'rect');
  return b === 'tri' || b === 'double' ? b : 'rect';
}

export function massOf(p: SimParams): number {
  return clampNum(pNum(p, 'mass', 1), 0.05, 8);
}
export function hbarOf(): number {
  return 1;
}

/* ------------------------------- geometry --------------------------------- */

export interface BarrierGeom {
  kind: BarrierKind;
  v0: number;
  /** Barrier width in a.u. (for `double`: the width of *each* barrier). */
  a: number;
  /** Well separation in a.u. (`double` only). */
  gap: number;
  /** Tilt fraction (`tri` only): 0 = vertical drop, 1 = gentle ramp. */
  tilt: number;
  /** Physical edges of the whole structured region. */
  left: number;
  right: number;
  /** Piecewise-constant decomposition used by the transfer-matrix reference. */
  regions: { width: number; v: number }[];
  /** Max V over the profile (for the energy window). */
  vmax: number;
}

const TRI_SLICES = 24;

export function geomOf(p: SimParams): BarrierGeom {
  const kind = barrierOf(p);
  const v0 = clampNum(pNum(p, 'V0', 12), 0.05, 60);
  const a = clampNum(pNum(p, 'width', 0.04), 0.004, 0.5) * TUN_BOX_AU;
  const gap = clampNum(pNum(p, 'gap', 0.1), 0.005, 0.5) * TUN_BOX_AU;
  const tilt = clampNum(pNum(p, 'tilt', 0.4), 0.02, 1);
  if (kind === 'double') {
    const left = -a - gap / 2;
    return {
      kind,
      v0,
      a,
      gap,
      tilt,
      left,
      right: left + 2 * a + gap,
      regions: [
        { width: a, v: v0 },
        { width: gap, v: 0 },
        { width: a, v: v0 },
      ],
      vmax: v0,
    };
  }
  if (kind === 'tri') {
    // A trapezoid that `tilt` turns into a triangle: flat V₀ over the first
    // (1−tilt)·a, then a linear field-thinned ramp to zero. tilt = 1 is the pure
    // triangular barrier of strong-field emission.
    const left = -a / 2;
    const regions: { width: number; v: number }[] = [];
    const slice = a / TRI_SLICES;
    for (let i = 0; i < TRI_SLICES; i++) {
      regions.push({ width: slice, v: triAt(v0, a, tilt, left + (i + 0.5) * slice) });
    }
    return { kind, v0, a, gap, tilt, left, right: left + a, regions, vmax: v0 };
  }
  return {
    kind,
    v0,
    a,
    gap,
    tilt,
    left: -a / 2,
    right: a / 2,
    regions: [{ width: a, v: v0 }],
    vmax: v0,
  };
}

/** The potential actually integrated, on the solver grid. */
export function buildBarrierV(p: SimParams, n: number): Float64Array {
  const g = geomOf(p);
  const dx = TUN_BOX_AU / n;
  const v = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const x = TUN_ORIGIN_AU + (j + 0.5) * dx;
    v[j] = profileAt(g, x);
  }
  return v;
}

/** Piecewise profile value at a physical coordinate. */
export function profileAt(g: BarrierGeom, x: number): number {
  if (g.kind === 'rect') return x >= g.left && x < g.right ? g.v0 : 0;
  if (g.kind === 'double') {
    const inLeft = x >= g.left && x < g.left + g.a;
    const inRight = x >= g.right - g.a && x < g.right;
    return inLeft || inRight ? g.v0 : 0;
  }
  return triAt(g.v0, g.a, g.tilt, x);
}

/** Trapezoid-with-ramp profile: flat (1−tilt)·a then a linear fall to zero. */
function triAt(v0: number, a: number, tilt: number, x: number): number {
  const left = -a / 2;
  if (x < left || x >= left + a) return 0;
  const flat = (1 - tilt) * a;
  const d = x - left;
  if (d < flat) return v0;
  return v0 * (1 - (d - flat) / Math.max(1e-9, tilt * a));
}

/* ------------------------------- kinematics -------------------------------- */

/** Central wavenumber of a packet with lead energy E0: k = √(2mE)/ℏ. */
export function kOfEnergy(e: number, mass: number): number {
  return e > 0 ? Math.sqrt((2 * mass * e) / hbarOf() ** 2) : 0;
}
export function energyOfK(k: number, mass: number): number {
  return ((hbarOf() * hbarOf() * k * k) / (2 * mass));
}
/** Group velocity of a free packet, v = ℏk/m. */
export function groupVelocity(e: number, mass: number): number {
  return e > 0 ? Math.sqrt((2 * e) / mass) : 0;
}
export function sigmaKOf(p: SimParams): number {
  return clampNum(pNum(p, 'sigmaK', 12), 1, 90) / TUN_BOX_AU;
}
export function sigmaXOf(p: SimParams): number {
  return 1 / (2 * sigmaKOf(p));
}
export function kappaOf(p: SimParams): number {
  const g = geomOf(p);
  return evanescentKappa(clampNum(pNum(p, 'E0', 7), 0.02, 80), g.v0, massOf(p), hbarOf());
}

/** Energy window shown by every T(E) plot: 0 … max(1.6·V₀, 1.25·E₀). */
export function eMaxOf(p: SimParams): number {
  const g = geomOf(p);
  return Math.max(g.vmax * 1.6, clampNum(pNum(p, 'E0', 7), 0.02, 80) * 1.25, 1);
}

/* ---------------------------- analytical T(E) ------------------------------ */

/**
 * Exact transmission of the *currently displayed* barrier at energy `e`:
 * textbook closed form for the rectangle and the double barrier, transfer-matrix
 * product for the tilted ramp (which has no closed form).
 */
export function analyticalT(p: SimParams, e: number): number {
  const g = geomOf(p);
  const mass = massOf(p);
  if (g.kind === 'rect') return transmissionRectangular(e, g.v0, g.a, mass, hbarOf());
  if (g.kind === 'double') return transmissionDouble(e, g.v0, g.a, g.gap, mass, hbarOf());
  return transferMatrixTransmission(e, g.regions, mass, hbarOf());
}

/** WKB estimate through the same profile — the exponential-sensitivity reference. */
export function wkbT(p: SimParams, e: number): number {
  const g = geomOf(p);
  const n = 192;
  const dx = (g.right - g.left + 4) / n;
  const v = new Float64Array(n);
  for (let j = 0; j < n; j++) v[j] = profileAt(g, g.left - 2 + (j + 0.5) * dx);
  return transmissionWkb(e, v, dx, massOf(p), hbarOf());
}

/**
 * Energies inside the plotted window where the exact T(E) of the *displayed* profile
 * touches 1 — the unitarity resonances: the Ramsauer–Townsend points of a single
 * barrier (k₂a = nπ) and the Fabry–Pérot comb of the double barrier.
 *
 * They are located numerically on the analytic curve and refined by trisection,
 * because the textbook estimate E_n = n²π²ℏ²/(2m·gap²) ignores the wave spilling
 * into the barriers. For the default double structure (a = 1.2, gap = 2.4 a.u.) that
 * estimate puts the first cavity mode at 0.857 where the exact transmission is
 * 1.5×10⁻¹⁰; the true T = 1 point sits at 0.624. Plotting the naive comb would mark
 * resonances where nothing resonates, so the marks here are the real ones.
 */
export function resonanceEnergies(p: SimParams, limit = eMaxOf(p), samples = 1200): number[] {
  const f = (e: number): number => analyticalT(p, e);
  const out: number[] = [];
  const refine = (lo: number, hi: number): number => {
    for (let it = 0; it < 60; it++) {
      const pa = lo + (hi - lo) / 3;
      const pb = hi - (hi - lo) / 3;
      if (f(pa) < f(pb)) lo = pa;
      else hi = pb;
    }
    return 0.5 * (lo + hi);
  };
  let ePrev = limit / samples;
  let tPrev = f(ePrev);
  let eLeft = 0;
  let tLeft = f(Math.max(1e-4, limit / samples - 1e-9));
  for (let i = 2; i <= samples; i++) {
    const eRight = (limit * i) / samples;
    const tRight = f(eRight);
    /*
     * Bracket on any crest taller than half height, *then* refine and demand T = 1.
     * Gating on "T ≈ 1" at the sample points would miss every narrow resonance: with
     * a spacing of limit/samples a Lorentzian of width Γ is sampled well off its
     * centre and never reads 1.
     */
    if (tPrev > tLeft && tPrev >= tRight && tPrev > 0.5) {
      const r = refine(eLeft, eRight);
      if (f(r) > 1 - 1e-9 && (out.length === 0 || r - out[out.length - 1] > (2 * limit) / samples)) {
        out.push(r);
      }
    }
    eLeft = ePrev;
    tLeft = tPrev;
    ePrev = eRight;
    tPrev = tRight;
  }
  return out;
}

export interface TCurve {
  e: Float64Array;
  t: Float64Array;
  eMax: number;
  /** Index of the sample closest to E0. */
  atE0: number;
  /** Highest T in the window (1 exactly at a resonance). */
  tMax: number;
  /** Resonance energies inside the window. */
  resonances: number[];
  /** True when the sampled curve is the double-barrier (structured) case. */
  structured: boolean;
}

const CURVE_SAMPLES = 256;
let curveCache: { sig: string; curve: TCurve } | null = null;

/** Barrier + energy-window signature; the curve is rebuilt only when it changes. */
export function barrierSig(p: SimParams): string {
  const g = geomOf(p);
  return [
    g.kind,
    g.v0.toFixed(4),
    g.a.toFixed(4),
    g.gap.toFixed(4),
    g.tilt.toFixed(3),
    massOf(p).toFixed(3),
    pNum(p, 'E0', 7).toFixed(4),
    eMaxOf(p).toFixed(4),
  ].join('|');
}

export function tCurveOf(p: SimParams): TCurve {
  const sig = barrierSig(p);
  if (curveCache && curveCache.sig === sig) return curveCache.curve;
  const eMax = eMaxOf(p);
  const e = new Float64Array(CURVE_SAMPLES);
  const t = new Float64Array(CURVE_SAMPLES);
  let tMax = 0;
  const e0 = clampNum(pNum(p, 'E0', 7), 0.02, 80);
  let atE0 = 0;
  let bestDx = Infinity;
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    // Start just above zero so the log view never sees log(0).
    const ev = (eMax * (i + 0.5)) / CURVE_SAMPLES;
    const tv = analyticalT(p, ev);
    e[i] = ev;
    t[i] = tv;
    if (tv > tMax) tMax = tv;
    const d = Math.abs(ev - e0);
    if (d < bestDx) {
      bestDx = d;
      atE0 = i;
    }
  }
  const curve: TCurve = {
    e,
    t,
    eMax,
    atE0,
    tMax,
    resonances: resonanceEnergies(p, eMax),
    structured: barrierOf(p) !== 'rect',
  };
  curveCache = { sig, curve };
  return curve;
}

/**
 * ⟨T⟩ of the *launch packet*: its Gaussian momentum distribution folded through the
 * exact T(E). This — not T(E₀) — is what the simulation must reproduce, because a
 * packet of spread Δk is not monochromatic.
 */
export function packetMeanT(p: SimParams, samples = 161): { mean: number; spread: number; ePeak: number; tPeak: number } {
  const mass = massOf(p);
  const e0 = clampNum(pNum(p, 'E0', 7), 0.02, 80);
  const k0 = kOfEnergy(e0, mass);
  const dk = sigmaKOf(p);
  let w = 0;
  let acc = 0;
  let varAcc = 0;
  let ePeak = e0;
  let tPeak = analyticalT(p, e0);
  for (let i = 0; i < samples; i++) {
    const kk = k0 + (i / (samples - 1) - 0.5) * 8 * dk;
    if (kk <= 0) continue;
    const weight = Math.exp(-((kk - k0) ** 2) / (2 * dk * dk));
    const ev = energyOfK(kk, mass);
    const tv = analyticalT(p, ev);
    acc += weight * tv;
    varAcc += weight * (ev - e0) ** 2;
    w += weight;
    if (tv > tPeak) {
      tPeak = tv;
      ePeak = ev;
    }
  }
  if (w <= 0) return { mean: 0, spread: 0, ePeak: e0, tPeak };
  return { mean: acc / w, spread: Math.sqrt(varAcc / w), ePeak, tPeak };
}

/* ---------------------------------- STM ----------------------------------- */

export interface StmScan {
  /** Lateral coordinate, fraction of the box (0..1). */
  u: Float64Array;
  /** True surface height, fraction of the tip–sample set-point. */
  trueH: Float64Array;
  /** Apparent (constant-current) height the tip has to climb to. */
  appH: Float64Array;
  /** Tunneling current at the fixed tip height, normalised to I/I₀. */
  cur: Float64Array;
  /** I₀ set point (arbitrary units, ∝ V·T). */
  i0: number;
  /** Exponent of the set-point response: dI/I per d(d)/a. */
  slope: number;
}

const STM_ATOMS = [0.34, 0.5, 0.66];

/** Geometric surface: three adsorbates of unit height sitting on a plane. */
export function surfaceHeight(uu: number, amp: number): number {
  let h = 0;
  for (const cx of STM_ATOMS) {
    const d = (uu - cx) / 0.035;
    h += amp * Math.exp(-0.5 * d * d);
  }
  return Math.min(1.6, h);
}

/**
 * Constant-current feedback: over an atom the barrier is both *narrower* by h and
 * *lower* by `contrast·h`, so the tip must retract to hold I = I₀. The feedback
 * reports the tip's absolute height relative to the flat-plane set point,
 * `appH = h + (a − d0)`: with `contrast = 0` the retraction vanishes and the
 * apparent profile is exactly the true one, while any electronic contrast makes
 * atoms look *taller* than they are, because the exponential beats geometry.
 */
export function stmScan(p: SimParams, samples = 96): StmScan {
  const u = new Float64Array(samples);
  const trueH = new Float64Array(samples);
  const appH = new Float64Array(samples);
  const cur = new Float64Array(samples);
  const mass = massOf(p);
  const g = geomOf(p);
  const e0 = clampNum(pNum(p, 'E0', 7), 0.02, 80);
  const bias = clampNum(pNum(p, 'stmBias', 0.4), 0.02, 3);
  const d0 = clampNum(pNum(p, 'stmHeight', 0.05), 0.006, 0.3) * TUN_BOX_AU;
  const amp = clampNum(pNum(p, 'stmAmp', 0.45), 0, 1.2);
  const contrast = clampNum(pNum(p, 'stmContrast', 0.35), 0, 0.8);
  const i0 = bias * transmissionRectangular(e0, g.v0, d0, mass, hbarOf());
  let slope = 0;
  for (let i = 0; i < samples; i++) {
    const uu = i / (samples - 1);
    const h = surfaceHeight(uu, amp);
    const vLocal = g.v0 * (1 - contrast * (h / Math.max(1e-6, amp)));
    u[i] = uu;
    trueH[i] = h;
    cur[i] = i0 > 0 ? (bias * transmissionRectangular(e0, vLocal, Math.max(0.05, d0 - h), mass, hbarOf())) / i0 : 0;
    // Bisection on the tip–sample gap a: T(a) is strictly decreasing.
    let lo = 0.02;
    let hi = d0 * 3 + 1;
    const target = i0 / bias;
    for (let it = 0; it < 48; it++) {
      const mid = 0.5 * (lo + hi);
      if (transmissionRectangular(e0, vLocal, mid, mass, hbarOf()) > target) lo = mid;
      else hi = mid;
    }
    const a = 0.5 * (lo + hi);
    appH[i] = h + (a - d0);
  }
  // Sensitivity of the set point: d ln I / d(d) = 2κ.
  slope = 2 * evanescentKappa(e0, g.v0, mass, hbarOf());
  return { u, trueH, appH, cur, i0, slope };
}

/* ------------------------------- signatures -------------------------------- */

/** Changing these rebuilds V(x) (and the sponge) but keeps the flying ψ. */
export function barrierChangeSig(p: SimParams): string {
  const g = geomOf(p);
  return [
    g.kind,
    g.v0.toFixed(4),
    g.a.toFixed(4),
    g.gap.toFixed(4),
    g.tilt.toFixed(3),
    gridTOf(p),
    clampNum(pNum(p, 'capWidth', 0.07), 0, 0.3).toFixed(3),
    clampNum(pNum(p, 'capStrength', 0.4), 0, 1).toFixed(3),
  ].join('|');
}

/** Changing these re-launches ψ from t = 0. */
export function packetSig(p: SimParams): string {
  return [
    pNum(p, 'E0', 7).toFixed(4),
    pNum(p, 'sigmaK', 12).toFixed(3),
    pNum(p, 'packetX', 0.16).toFixed(4),
    massOf(p).toFixed(3),
    gridTOf(p),
    Math.round(pNum(p, 'launchToken', 0)),
  ].join('|');
}

export interface TunnelSetup {
  n: number;
  dx: number;
  dt: number;
  mass: number;
  v: Float64Array;
  cap: Float64Array;
  re: Float64Array;
  im: Float64Array;
  norm0: number;
  peak0: number;
  k0: number;
  sigmaK: number;
  e0: number;
  geom: BarrierGeom;
}

export function buildTunnelSetup(p: SimParams): TunnelSetup {
  const n = gridTOf(p);
  const dx = TUN_BOX_AU / n;
  const mass = massOf(p);
  const e0 = clampNum(pNum(p, 'E0', 7), 0.02, 80);
  const k0 = kOfEnergy(e0, mass);
  const dk = sigmaKOf(p);
  const geom = geomOf(p);
  const v = buildBarrierV(p, n);
  const cap = buildCap(
    n,
    clampNum(pNum(p, 'capWidth', 0.07), 0, 0.3),
    clampNum(pNum(p, 'capStrength', 0.4), 0, 1),
    TUN_CAP_SCALE,
  );
  const xLaunch = (clampNum(pNum(p, 'packetX', 0.16), 0.02, 0.44) - 0.5) * TUN_BOX_AU;
  const [re, im] = gaussianPacket(n, dx, xLaunch, 1 / (2 * dk), k0, 1, TUN_ORIGIN_AU);
  let peak = 0;
  for (let j = 0; j < n; j++) {
    const d = (re[j] * re[j] + im[j] * im[j]) * dx;
    if (d > peak) peak = d;
  }
  return {
    n,
    dx,
    dt: clampNum(pNum(p, 'dt', 0.002), 2e-4, 0.01),
    mass,
    v,
    cap,
    re,
    im,
    norm0: 1,
    peak0: peak,
    k0,
    sigmaK: dk,
    e0,
    geom,
  };
}

/** Δt·(V₀ + E) — the phase a single Strang step must resolve to stay accurate. */
export function phasePerStep(setup: TunnelSetup): number {
  return setup.dt * (setup.geom.vmax + energyOfK(setup.k0 + 3 * setup.sigmaK, setup.mass));
}

/* --------------------------- live solver read-out --------------------------- */

export interface LiveTunnel {
  ready: boolean;
  t: number;
  steps: number;
  norm: number;
  drained: number;
  drift: number;
  maxDrift: number;
  x: number;
  p: number;
  energy: number;
  kinetic: number;
  peak: number;
  /** Probability that has cleared the barrier structure. */
  transmitted: number;
  /** Probability still on the incident side. */
  reflected: number;
  /** Probability inside the barrier region. */
  inside: number;
  /** transmitted/(transmitted+reflected) once both packets have separated. */
  tMeasured: number;
  resolved: boolean;
  fps: number;
  solverMs: number;
  lastFrameMs: number;
  n: number;
  dt: number;
}

export const liveTunnel: LiveTunnel = {
  ready: false,
  t: 0,
  steps: 0,
  norm: 1,
  drained: 0,
  drift: 0,
  maxDrift: 0,
  x: -6,
  p: 0,
  energy: 0,
  kinetic: 0,
  peak: 0,
  transmitted: 0,
  reflected: 0,
  inside: 0,
  tMeasured: 0,
  resolved: false,
  fps: 0,
  solverMs: 0,
  lastFrameMs: 0,
  n: 1024,
  dt: 0.002,
};

/** Bill one frame into the live port; drift keeps the sponge in the ledger. */
export function publishTunnelLive(
  diag: { norm: number; x: number; p: number; energy: number; kinetic: number; peak: number },
  norm0: number,
  drained: number,
  split: { transmitted: number; reflected: number; inside: number },
): void {
  liveTunnel.ready = true;
  liveTunnel.norm = diag.norm;
  liveTunnel.drained = drained;
  liveTunnel.drift = Math.abs(diag.norm + drained - norm0);
  if (liveTunnel.drift > liveTunnel.maxDrift) liveTunnel.maxDrift = liveTunnel.drift;
  liveTunnel.x = diag.x;
  liveTunnel.p = diag.p;
  liveTunnel.energy = diag.energy;
  liveTunnel.kinetic = diag.kinetic;
  liveTunnel.peak = diag.peak;
  liveTunnel.transmitted = split.transmitted;
  liveTunnel.reflected = split.reflected;
  liveTunnel.inside = split.inside;
  const free = split.transmitted + split.reflected;
  liveTunnel.tMeasured = free > 1e-6 ? split.transmitted / free : 0;
}

/* --------------------------------- helpers --------------------------------- */

export function showAnalytical(p: SimParams): boolean {
  return pBool(p, 'showAnalytical', true);
}
export function showEvanescent(p: SimParams): boolean {
  return pBool(p, 'showEvanescent', true);
}
export function stmActive(p: SimParams): boolean {
  return pBool(p, 'stmMode', false);
}
/** Probe energy: 0 means "use the packet's E₀". */
export function probeEnergy(p: SimParams): number {
  const scan = clampNum(pNum(p, 'energyScan', 0), 0, 80);
  return scan > 0.01 ? scan : clampNum(pNum(p, 'E0', 7), 0.02, 80);
}
/** Normalised x (0..1) of a physical coordinate, for drawing. */
export function auToU(xAu: number): number {
  return xAu / TUN_BOX_AU + 0.5;
}
