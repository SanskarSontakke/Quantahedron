/**
 * Harmonic Oscillator — physics core (pure, no React).
 *
 * Units: ħ = m = 1, so ω is both the angular frequency and the curvature of
 * V(x) = ½ω²x², energies are in ħω and lengths in √(ħ/mω) = ω^(−1/2).
 *
 *  • Eigenstates: ψₙ(x) = (ω/π)^¼ · Hₙ(√ω x)·e^{−ωx²/2} / √(2ⁿ n!).
 *    √(2ⁿ n!) is formed in log space with the shared Lanczos lgamma, and the
 *    Hermite polynomials use the three-term recurrence applied to the *already
 *    Gaussian-damped* functions hₙ = Hₙe^{−ξ²/2} — the damping factors out of
 *    the recurrence, so n = 20 stays comfortably inside double precision.
 *  • Time evolution is exact: cₙ → cₙe^{−i(n+½)ωt}.
 *  • All moments come from the ladder algebra, never from a quadrature:
 *      ⟨x⟩ = √(2/ω)Re⟨a⟩, ⟨p⟩ = √(2ω)Im⟨a⟩,
 *      ⟨x²⟩ = (2Re⟨a²⟩ + 2⟨n⟩ + 1)/(2ω), ⟨p²⟩ = ω(2⟨n⟩ + 1 − 2Re⟨a²⟩)/2,
 *    which makes ΔxΔp = ½ exact for |0⟩ and for every coherent state.
 *  • Glauber: cₙ = e^{−|α|²/2}αⁿ/√(n!) ⇒ Poisson weights, Fano factor 1, and a
 *    packet that orbits phase space on a circle of radius |α| without spreading.
 */

import { lgamma } from '@/engine/physics/hydrogen';
import type { SimParams } from '@/simulations/types';
import { pArr, pBool, pNum } from '@/store/useSimStore';

/** Basis size the UI unlocks: |0⟩ … |MAX_LEVELS−1⟩, i.e. n up to 20. */
export const MAX_LEVELS = 21;
/** Phasor dock cell count offered to the learner. */
export const DOCK_CELLS = 10;

const LN2 = Math.log(2);

/** `dim` is rendered by a select, so it may arrive as '1'/'2' or 1/2. */
export const dimOf = (p: SimParams): 1 | 2 => (String(p['dim']) === '2' ? 2 : 1);

/* ------------------------------- eigenstates ------------------------------ */

/** Hₙ(ξ)·e^{−ξ²/2} via the three-term recurrence (numerically damped). */
export function hermiteScaled(n: number, xi: number): number {
  if (n <= 0) return Math.exp((-xi * xi) / 2);
  let h0 = Math.exp((-xi * xi) / 2);
  let h1 = 2 * xi * h0;
  for (let k = 1; k < n; k++) {
    const h2 = 2 * xi * h1 - 2 * k * h0;
    h0 = h1;
    h1 = h2;
  }
  return h1;
}

/** log of the normalisation prefactor (ω/π)^¼ / √(2ⁿ n!). */
export function psiNormLog(n: number, omega: number): number {
  return 0.25 * Math.log(omega / Math.PI) - 0.5 * (n * LN2 + lgamma(n + 1));
}

/** ψₙ(x), exact and stable up to n = 20. */
export function psiN(n: number, x: number, omega: number): number {
  const xi = Math.sqrt(omega) * x;
  return Math.exp(psiNormLog(n, omega)) * hermiteScaled(n, xi);
}

/* ------------------------------ coefficients ------------------------------ */

export interface Coeffs {
  ns: number[];
  re: number[];
  im: number[];
  /** Σ|cₙ|² — 1 for a normalised stack, < 1 when a coherent state is truncated. */
  norm: number;
  coherent: boolean;
  alphaRe: number;
  alphaIm: number;
  /** |α|. */
  absA: number;
  /** Poisson Fano factor Var(n)/⟨n⟩ of the *rendered* coefficients. */
  fano: number;
  /** ⟨n⟩ of the rendered coefficients. */
  nbar: number;
  /** Σ|cₙ|² of the exact infinite Poisson series that survived the truncation. */
  poissonKept: number;
  /** Expected ⟨n⟩ = |α|² for a coherent state. */
  nExpected: number;
}

/** |α| needs roughly |α|² + 6|α| + 4 terms before the tail is negligible. */
export function coherentDepth(absA: number, levels: number): number {
  const need = Math.ceil(absA * absA + 6 * absA + 4);
  return Math.max(2, Math.min(MAX_LEVELS, Math.max(levels, need)));
}

/** Exact Poisson weights |cₙ|² = e^{−|α|²}|α|^{2n}/n! in log space. */
export function poissonWeights(absA: number, count: number): number[] {
  const out: number[] = [];
  for (let n = 0; n < count; n++) {
    const logw = -absA * absA + 2 * n * Math.log(Math.max(absA, 1e-12)) - lgamma(n + 1);
    out.push(Math.exp(logw));
  }
  return out;
}

/** cₙ = e^{−|α|²/2}αⁿ/√(n!) for an arbitrary complex α, truncated at `depth`. */
export function coherentCoeffs(
  alphaRe: number,
  alphaIm: number,
  depth: number,
): { ns: number[]; re: number[]; im: number[] } {
  const absA = Math.hypot(alphaRe, alphaIm);
  const theta = Math.atan2(alphaIm, alphaRe);
  const logEnv = -0.5 * absA * absA;
  const logR = Math.log(Math.max(absA, 1e-12));
  const ns: number[] = [];
  const re: number[] = [];
  const im: number[] = [];
  for (let n = 0; n < depth; n++) {
    const mag = n === 0 && absA < 1e-12 ? Math.exp(logEnv) : Math.exp(logEnv + n * logR - 0.5 * lgamma(n + 1));
    ns.push(n);
    re.push(mag * Math.cos(n * theta));
    im.push(mag * Math.sin(n * theta));
  }
  return { ns, re, im };
}

export function stateCoeffs(p: SimParams): Coeffs {
  const levels = Math.max(1, Math.min(MAX_LEVELS, Math.round(pNum(p, 'levels', 8))));
  const coherent = pBool(p, 'coherent', false);
  const alphaRe = pNum(p, 'alphaRe', 1.6);
  const alphaIm = pNum(p, 'alphaIm', 0);
  const absA = Math.hypot(alphaRe, alphaIm);

  const ns: number[] = [];
  const re: number[] = [];
  const im: number[] = [];

  if (coherent) {
    const depth = coherentDepth(absA, levels);
    const c = coherentCoeffs(alphaRe, alphaIm, depth);
    ns.push(...c.ns);
    re.push(...c.re);
    im.push(...c.im);
  } else {
    const hn = pArr(p, 'hn');
    const amp = pArr(p, 'hampAmp');
    const phase = pArr(p, 'hampPhase');
    for (let i = 0; i < hn.length && i < MAX_LEVELS; i++) {
      const n = Math.round(hn[i] ?? 0);
      if (n < 0 || n >= MAX_LEVELS) continue;
      const a = amp[i] ?? 0;
      if (a === 0) continue;
      const ph = phase[i] ?? 0;
      ns.push(n);
      re.push(a * Math.cos(ph));
      im.push(a * Math.sin(ph));
    }
    if (ns.length === 0) {
      ns.push(0);
      re.push(1);
      im.push(0);
    }
  }

  let norm = 0;
  let nbar = 0;
  let nvar = 0;
  for (let i = 0; i < ns.length; i++) {
    const w = re[i] * re[i] + im[i] * im[i];
    norm += w;
    nbar += w * ns[i];
    nvar += w * ns[i] * ns[i];
  }
  if (norm > 0) {
    nbar /= norm;
    nvar = nvar / norm - nbar * nbar;
  }
  const exact = poissonWeights(absA, MAX_LEVELS * 3);
  const poissonKept = exact.reduce((s, v, i) => s + (i < ns.length ? v : 0), 0);

  return {
    ns,
    re,
    im,
    norm,
    coherent,
    alphaRe,
    alphaIm,
    absA,
    fano: nbar > 1e-9 ? nvar / nbar : 0,
    nbar,
    poissonKept,
    nExpected: absA * absA,
  };
}

/** Advance cₙ by the exact propagator e^{−i(n+½)ωt}. */
export function propagate(c: Coeffs, omega: number, t: number): { re: number[]; im: number[] } {
  const re = new Array<number>(c.ns.length);
  const im = new Array<number>(c.ns.length);
  for (let i = 0; i < c.ns.length; i++) {
    const ang = -(c.ns[i] + 0.5) * omega * t;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    re[i] = c.re[i] * ca - c.im[i] * sa;
    im[i] = c.re[i] * sa + c.im[i] * ca;
  }
  return { re, im };
}

/* --------------------------------- moments -------------------------------- */

export interface Moments {
  x: number;
  p: number;
  x2: number;
  p2: number;
  dx: number;
  dp: number;
  product: number;
  /** ΔxΔp/ħ — 0.5 is the Heisenberg floor. */
  scaled: number;
  nbar: number;
  energy: number;
  /** ⟨a⟩, whose real/imaginary parts are the phase-space coordinates. */
  aRe: number;
  aIm: number;
  absA: number;
  /** E in ħω units. */
  units: number;
}

export function moments(c: Coeffs, omega: number): Moments {
  const idx = new Map<number, number>();
  for (let i = 0; i < c.ns.length; i++) idx.set(c.ns[i], i);
  const at = (n: number): [number, number] => {
    const i = idx.get(n);
    return i === undefined ? [0, 0] : [c.re[i], c.im[i]];
  };
  let aRe = 0;
  let aIm = 0;
  let a2Re = 0;
  let nbar = 0;
  let norm = 0;
  for (let n = 0; n < MAX_LEVELS; n++) {
    const [ur, ui] = at(n);
    const [vr, vi] = at(n + 1);
    const [wr, wi] = at(n + 2);
    const w = ur * ur + ui * ui;
    norm += w;
    nbar += w * n;
    const s = Math.sqrt(n + 1);
    // ⟨a⟩ = Σ cₙ* cₙ₊₁ √(n+1)
    aRe += (ur * vr + ui * vi) * s;
    aIm += (ur * vi - ui * vr) * s;
    const s2 = Math.sqrt((n + 1) * (n + 2));
    a2Re += (ur * wr + ui * wi) * s2;
  }
  if (norm > 0) {
    aRe /= norm;
    aIm /= norm;
    a2Re /= norm;
    nbar /= norm;
  }
  const x = Math.sqrt(2 / omega) * aRe;
  const p = Math.sqrt(2 * omega) * aIm;
  const x2 = (2 * a2Re + 2 * nbar + 1) / (2 * omega);
  const p2 = omega * (2 * nbar + 1 - 2 * a2Re) / 2;
  const dx = Math.sqrt(Math.max(0, x2 - x * x));
  const dp = Math.sqrt(Math.max(0, p2 - p * p));
  const product = dx * dp;
  const energy = (nbar + 0.5) * omega;
  return {
    x,
    p,
    x2,
    p2,
    dx,
    dp,
    product,
    scaled: product,
    nbar,
    energy,
    aRe,
    aIm,
    absA: Math.hypot(aRe, aIm),
    units: nbar + 0.5,
  };
}

/* ------------------------- classical comparison --------------------------- */

/** Turning point of a classical oscillator with the same energy (m = ħ = 1). */
export const turningAmplitude = (energy: number, omega: number): number =>
  Math.sqrt(Math.max(0, (2 * energy) / (omega * omega)));

/** P_cl(x) = 1/(π√(A²−x²)) inside the well, 0 outside (it diverges at ±A). */
export function classicalDensity(x: number, A: number): number {
  const d = A * A - x * x;
  if (d <= 1e-12) return 0;
  return 1 / (Math.PI * Math.sqrt(d));
}

export const potential = (x: number, omega: number): number => 0.5 * omega * omega * x * x;

/* -------------------------------- Wigner ---------------------------------- */

export interface WignerField {
  values: Float64Array;
  max: number;
}

/**
 * W(x,p) = (1/π)∫dy Re[ψ*(x+y)ψ(x−y)e^{2ipy}] evaluated on a size×size grid.
 * The fast oscillation lives entirely in the (p, y) table, so `wignerPlan`
 * precomputes cos/sin once and every frame only touches the wavefunction.
 */
export interface WignerPlan {
  xs: number[];
  ps: number[];
  ys: number[];
  cos: Float64Array;
  sin: Float64Array;
}

/** Precompute the (p, y) phase tables and the sample coordinates. */
export function wignerPlan(size: number, pSamples: number, omega: number, xMax: number): WignerPlan {
  const xs: number[] = [];
  const ps: number[] = [];
  const span = xMax * 0.98;
  const pSpan = Math.sqrt(omega) * 3.4;
  for (let i = 0; i < size; i++) {
    xs.push(-span + (2 * span * i) / (size - 1));
    ps.push(-pSpan + (2 * pSpan * i) / (size - 1));
  }
  const ySpan = span;
  const ys: number[] = [];
  for (let j = 0; j < pSamples; j++) ys.push(-ySpan + (2 * ySpan * j) / (pSamples - 1));
  const cos = new Float64Array(size * pSamples);
  const sin = new Float64Array(size * pSamples);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < pSamples; j++) {
      const ang = 2 * ps[i] * ys[j];
      cos[i * pSamples + j] = Math.cos(ang);
      sin[i * pSamples + j] = Math.sin(ang);
    }
  }
  return { xs, ps, ys, cos, sin };
}

/** Evaluate W(x,p) for a state sampled on a uniform grid (re/im of ψ). */
export function wignerEvaluate(
  plan: WignerPlan,
  grid: { x0: number; dx: number; re: Float64Array; im: Float64Array },
): { values: Float64Array; max: number } {
  const size = plan.xs.length;
  const ny = plan.ys.length;
  const out = new Float64Array(size * size);
  const dy = ny > 1 ? plan.ys[1] - plan.ys[0] : 0;
  const re = grid.re;
  const im = grid.im;
  const last = re.length - 1;

  // A(x,y) = Re(ψ*(x+y)ψ(x−y)), B(x,y) = Im(ψ*(x+y)ψ(x−y))
  const A = new Float64Array(ny);
  const B = new Float64Array(ny);
  let max = 0;
  for (let i = 0; i < size; i++) {
    const x = plan.xs[i];
    for (let j = 0; j < ny; j++) {
      const y = plan.ys[j];
      let ar = 0;
      let ai = 0;
      let br = 0;
      let bi = 0;
      const up = (x + y - grid.x0) / grid.dx;
      const ip = Math.floor(up);
      if (ip >= 0 && ip < last) {
        const f = up - ip;
        ar = re[ip] * (1 - f) + re[ip + 1] * f;
        ai = im[ip] * (1 - f) + im[ip + 1] * f;
      }
      const um = (x - y - grid.x0) / grid.dx;
      const jm = Math.floor(um);
      if (jm >= 0 && jm < last) {
        const f = um - jm;
        br = re[jm] * (1 - f) + re[jm + 1] * f;
        bi = im[jm] * (1 - f) + im[jm + 1] * f;
      }
      A[j] = ar * br + ai * bi;
      B[j] = ai * br - ar * bi;
    }
    for (let k = 0; k < size; k++) {
      const base = k * ny;
      let acc = 0;
      for (let j = 0; j < ny; j++) acc += A[j] * plan.cos[base + j] - B[j] * plan.sin[base + j];
      const v = acc * (dy / Math.PI);
      out[i * size + k] = v;
      const av = Math.abs(v);
      if (av > max) max = av;
    }
  }
  return { values: out, max };
}

/* --------------------------------- 2D ------------------------------------ */

export interface Product2D {
  nx: number;
  ny: number;
  /** Second degenerate partner mixed in by `mix2D` (|ny,nx⟩). */
  mix: number;
  energy: number;
}

export function product2D(p: SimParams): Product2D {
  const nx = Math.max(0, Math.min(MAX_LEVELS - 1, Math.round(pNum(p, 'nx2', 0))));
  const ny = Math.max(0, Math.min(MAX_LEVELS - 1, Math.round(pNum(p, 'ny2', 0))));
  const mix = Math.max(0, Math.min(1, pNum(p, 'mix2D', 0)));
  return { nx, ny, mix, energy: (nx + ny + 1) * pNum(p, 'omega', 1) };
}

/* ------------------------------ field sampling ---------------------------- */

export interface WaveField {
  x0: number;
  dx: number;
  count: number;
  re: Float64Array;
  im: Float64Array;
  density: Float64Array;
  /** max |ψ|² on the grid — the normaliser for drawing. */
  peak: number;
  /** Σ|ψ|²·dx over the sampled window (≈ 1 for a well-contained state). */
  mass: number;
}

/**
 * Sample ψ(x) = Σₙ cₙψₙ(x) on a uniform grid.  The Hermite basis is evaluated
 * once per (n, x) pair and cached inside this call, so the cost is
 * O(count · levels) with a very small constant.
 */
export function evaluateWave(
  ns: number[],
  cre: number[],
  cim: number[],
  omega: number,
  count: number,
  xMax: number,
): WaveField {
  const n = Math.max(16, Math.min(4096, Math.round(count)));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const density = new Float64Array(n);
  const x0 = -xMax;
  const dx = (2 * xMax) / (n - 1);
  const basis = new Float64Array(n);
  let peak = 0;
  let mass = 0;
  for (let s = 0; s < ns.length; s++) {
    const nn = ns[s];
    const cr = cre[s];
    const ci = cim[s];
    if (cr === 0 && ci === 0) continue;
    const amp = Math.exp(psiNormLog(nn, omega));
    const sq = Math.sqrt(omega);
    for (let i = 0; i < n; i++) {
      basis[i] = amp * hermiteScaled(nn, sq * (x0 + i * dx));
    }
    for (let i = 0; i < n; i++) {
      const b = basis[i];
      re[i] += cr * b;
      im[i] += ci * b;
    }
  }
  for (let i = 0; i < n; i++) {
    const d = re[i] * re[i] + im[i] * im[i];
    density[i] = d;
    mass += d * dx;
    if (d > peak) peak = d;
  }
  return { x0, dx, count: n, re, im, density, peak, mass };
}

/* --------------------------------- 2D ------------------------------------ */

/** One separable branch of a 2D state: Ψ = Σ_b amp_b·e^{iφ_b}·x_b(x)·y_b(y). */
export interface Branch1D {
  re: Float64Array;
  im: Float64Array;
}

export interface Branch2D {
  x: Branch1D;
  y: Branch1D;
  amp: number;
  phase: number;
}

export interface Field2D {
  size: number;
  span: number;
  /** |Ψ(x,y)|², row-major (row = +y), scaled so the peak is 1. */
  density: Float32Array;
  /** arg Ψ ∈ (−π, π] for hue colouring. */
  phase: Float32Array;
  /** Ψ itself, scaled by the same factor, so ∇Ψ (and hence J) is available. */
  re: Float32Array;
  im: Float32Array;
}

/**
 * Composite a 2D state from separable branches on a size×size grid.  Both the
 * degenerate eigenstate combination cos(θ)|nx,ny⟩ + sin(θ)|ny,nx⟩ and the
 * two-axis coherent product |αₓ⟩⊗|α_y⟩ are exactly two such branches, so one
 * routine covers every 2D state the UI offers.
 */
/** Both the branch sampler and the compositor must agree on this grid size. */
export const grid2DSize = (size: number): number => Math.max(24, Math.min(256, Math.round(size)));

export function compose2D(branches: Branch2D[], span: number, size: number): Field2D {
  const n = grid2DSize(size);
  const density = new Float32Array(n * n);
  const phase = new Float32Array(n * n);
  const re = new Float32Array(n * n);
  const im = new Float32Array(n * n);
  const nb = branches.length;
  const ka = new Float64Array(nb);
  const kb = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    ka[b] = branches[b].amp * Math.cos(branches[b].phase);
    kb[b] = branches[b].amp * Math.sin(branches[b].phase);
  }
  let peak = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let sr = 0;
      let si = 0;
      for (let b = 0; b < nb; b++) {
        const br = branches[b];
        const xr = br.x.re[i];
        const xi = br.x.im[i];
        const yr = br.y.re[j];
        const yi = br.y.im[j];
        const pr = xr * yr - xi * yi;
        const pi = xr * yi + xi * yr;
        sr += pr * ka[b] - pi * kb[b];
        si += pr * kb[b] + pi * ka[b];
      }
      const o = j * n + i;
      re[o] = sr;
      im[o] = si;
      const d = sr * sr + si * si;
      density[o] = d;
      phase[o] = Math.atan2(si, sr);
      if (d > peak) peak = d;
    }
  }
  if (peak > 0) {
    const inv = 1 / Math.sqrt(peak);
    for (let o = 0; o < n * n; o++) {
      re[o] *= inv;
      im[o] *= inv;
      density[o] *= inv * inv;
    }
  }
  return { size: n, span, density, phase, re, im };
}

/** Probability current J = Im(Ψ*∇Ψ) at one grid point (m = ħ = 1). */
export function current2D(field: Field2D, i: number, j: number): [number, number] {
  const n = field.size;
  const cl = (a: number, b: number): [number, number] => [field.re[a * n + b], field.im[a * n + b]];
  const y = Math.max(1, Math.min(n - 2, j));
  const x = Math.max(1, Math.min(n - 2, i));
  const p1 = cl(y, x + 1);
  const m1 = cl(y, x - 1);
  const p2 = cl(y + 1, x);
  const m2 = cl(y - 1, x);
  const c = cl(y, x);
  const hx = 2 * field.span / (n - 1);
  const dr = (p1[0] - m1[0]) / hx;
  const di = (p1[1] - m1[1]) / hx;
  const ur = (p2[0] - m2[0]) / hx;
  const ui = (p2[1] - m2[1]) / hx;
  return [c[0] * di - c[1] * dr, c[0] * ui - c[1] * ur];
}

/**
 * Split the live 2D state into its separable branches at time `t` (ħ = m = 1).
 * Coherent mode uses αₓ = α and α_y = −iα, which makes the packet travel on a
 * circle of radius √(2/ω)|α| rather than merely sloshing along one line; the
 * eigenstate mode uses the two degenerate partners |nx,ny⟩ and |ny,nx⟩.
 */
export interface State2D {
  branches: Branch2D[];
  /** ⟨x⟩, ⟨y⟩, ⟨pₓ⟩, ⟨p_y⟩ of the packet centre. */
  cx: number;
  cy: number;
  cpx: number;
  cpy: number;
  energy: number;
  coherent: boolean;
  /** Σ|c|² kept inside the truncated basis. */
  kept: number;
}

export function state2D(p: SimParams, t: number, size: number): State2D {
  const omega = pNum(p, 'omega', 1);
  const xMax = pNum(p, 'xMax', 7);
  const count = grid2DSize(size);
  const coherent = pBool(p, 'coherent', false);
  const alphaRe = pNum(p, 'alphaRe', 1.6);
  const alphaIm = pNum(p, 'alphaIm', 0);
  const absA = Math.hypot(alphaRe, alphaIm);
  const depth = coherentDepth(absA, Math.round(pNum(p, 'levels', 8)));

  if (coherent) {
    const ang = -omega * t;
    const axr = alphaRe * Math.cos(ang) - alphaIm * Math.sin(ang);
    const axi = alphaRe * Math.sin(ang) + alphaIm * Math.cos(ang);
    // α_y = −i·α  ⇒  rotate by −π/2 in the complex plane.
    const ayr = axi;
    const ayi = -axr;
    const bx = coherentCoeffs(axr, axi, depth);
    const by = coherentCoeffs(ayr, ayi, depth);
    const wx = evaluateWave(bx.ns, bx.re, bx.im, omega, count, xMax);
    const wy = evaluateWave(by.ns, by.re, by.im, omega, count, xMax);
    const s = Math.sqrt(2 / omega);
    return {
      branches: [{ x: { re: wx.re, im: wx.im }, y: { re: wy.re, im: wy.im }, amp: 1, phase: 0 }],
      cx: s * axr,
      cy: s * ayr,
      cpx: Math.sqrt(2 * omega) * axi,
      cpy: Math.sqrt(2 * omega) * ayi,
      // αₓ = α and α_y = −iα each carry |α|² quanta, plus the two zero-points.
      energy: (2 * absA * absA + 1) * omega,
      coherent: true,
      kept: poissonWeights(absA, depth).reduce((a, v) => a + v, 0),
    };
  }

  const nx = Math.max(0, Math.min(MAX_LEVELS - 1, Math.round(pNum(p, 'nx2', 0))));
  const ny = Math.max(0, Math.min(MAX_LEVELS - 1, Math.round(pNum(p, 'ny2', 0))));
  const mix = Math.max(0, Math.min(1, pNum(p, 'mix2D', 0)));
  const th = (mix * Math.PI) / 2;
  const vec = (n: number): Branch1D => {
    const w = evaluateWave([n], [1], [0], omega, count, xMax);
    return { re: w.re, im: w.im };
  };
  const a = vec(nx);
  const b = ny === nx ? a : vec(ny);
  const global = -(nx + ny + 1) * omega * t;
  const branches: Branch2D[] = [{ x: a, y: b, amp: Math.cos(th), phase: global }];
  if (ny !== nx && Math.sin(th) > 1e-4) branches.push({ x: b, y: a, amp: Math.sin(th), phase: global });
  return {
    branches,
    cx: 0,
    cy: 0,
    cpx: 0,
    cpy: 0,
    energy: (nx + ny + 1) * omega,
    coherent: false,
    kept: 1,
  };
}

/* ------------------------------ live viewport ----------------------------- */

/** Ring-buffer capacity of the phase-space trail. */
export const TRAIL = 360;

/**
 * Mutable hand-off between the 60 fps stage loop and the docked charts.
 *
 * The stage writes here every frame; the PlotCanvas cards read it whenever React
 * happens to repaint them. That keeps the animation itself entirely ref-driven —
 * no React state in the hot path — while the shared PlotCanvas component still
 * draws the live orbit.
 */
export const oscPort = {
  /** Accumulated simulation time (frozen when `animate` is off). */
  t: 0,
  /** Wall-clock seconds since mount, for repaint throttling. */
  elapsed: 0,
  /** Live ⟨x⟩ and ⟨p⟩ of the plotted state. */
  x: 0,
  p: 0,
  /** Live 2D packet centre. */
  y: 0,
  py: 0,
  trailX: new Float64Array(TRAIL),
  trailY: new Float64Array(TRAIL),
  trailHead: 0,
  trailN: 0,
  /** Set by the stage whenever the trajectory should start afresh. */
  clearTrail: true,
};

export function pushTrail(x: number, y: number): void {
  if (oscPort.clearTrail) {
    oscPort.clearTrail = false;
    oscPort.trailN = 0;
    oscPort.trailHead = 0;
  }
  oscPort.trailX[oscPort.trailHead] = x;
  oscPort.trailY[oscPort.trailHead] = y;
  oscPort.trailHead = (oscPort.trailHead + 1) % TRAIL;
  if (oscPort.trailN < TRAIL) oscPort.trailN += 1;
}

/* ------------------------------ formatting -------------------------------- */

export function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return v.toFixed(digits);
}
