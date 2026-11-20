/**
 * Uncertainty Forge — pure physics core.
 *
 * Everything here is plain TypeScript with no DOM and no React so it can be
 * driven by the canvas at 60 Hz *and* unit-tested in Node. Units are atomic:
 * ħ = mₑ = 1, so the Heisenberg floor is exactly σx·σp = 1/2.
 *
 * Storage convention (important, it is what keeps Parseval and the phase right):
 * the wavefunction lives in **solver order**, i.e. `psi[j]` samples
 *
 *     x_j = (j − N/2)·dx ,  dx = 2·xMax / N
 *
 * so x = 0 sits at index N/2 and the array can be fed straight into `fft()`.
 * The momentum samples obtained by a *cyclic half-shift first* (see
 * {@link toMomentum}) therefore carry the physical Fourier phase, not just the
 * magnitude. Position-space plotting needs no shift at all — only the axis
 * label moves.
 */

import { fft, ifft, floorPow2, kineticKick, type FftArray } from '@/engine/physics/fft';
import type { SimParams } from '@/simulations/types';

/**
 * Tolerant numeric getter. `select` controls write their value as a *string*
 * (so a permalink round-trips), while sliders write numbers — both have to work
 * for keys like `gridN` whose canonical default is numeric.
 */
export function numParam(p: SimParams, key: string, fallback: number): number {
  const v = p[key];
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export type EnvelopeKind = 'gauss' | 'square' | 'lorentz' | 'custom';

export const ENVELOPES: { value: EnvelopeKind; label: string }[] = [
  { value: 'gauss', label: 'Gaussian' },
  { value: 'square', label: 'Top-hat' },
  { value: 'lorentz', label: 'Lorentz' },
  { value: 'custom', label: 'Freehand' },
];

export interface ForgeGrid {
  /** Power-of-two sample count. */
  N: number;
  /** Half-width of the position window, x ∈ [−xMax, +xMax). */
  xMax: number;
  dx: number;
  /** Fourier sample spacing, 2π/(N·dx). */
  dk: number;
  /** Highest representable momentum, π/dx. */
  kMax: number;
  /** xMax − center of the packet, used for the analytic line shapes. */
  length: number;
}

export interface ForgeParams {
  envelope: EnvelopeKind;
  /** σ for the Gaussian, half-width for the top-hat, HWHM for the Lorentzian. */
  width: number;
  /** Quadratic phase coefficient c: ψ ∝ exp(i·c·(x−x₀)²/2). */
  chirp: number;
  /** Linear phase ⇒ mean momentum ⟨p⟩ = tilt. */
  tilt: number;
  /** Packet centre in position units. */
  center: number;
  /** Freehand Re ψ samples (−1..1), solver order, resampled to N when needed. */
  drawn: number[];
}

export interface Moments {
  norm: number;
  meanX: number;
  varX: number;
  sigmaX: number;
  meanP: number;
  varP: number;
  sigmaP: number;
  product: number;
  /** ⟨p²⟩/2m with m = 1. */
  kinetic: number;
}

export function makeGrid(gridN: number, xMax: number): ForgeGrid {
  const N = Math.max(64, Math.min(4096, floorPow2(Math.round(gridN) || 512)));
  const span = Math.max(2, Math.min(200, xMax || 12));
  const dx = (2 * span) / N;
  const dk = (2 * Math.PI) / (N * dx);
  return { N, xMax: span, dx, dk, kMax: Math.PI / dx, length: N * dx };
}

/** Position coordinate of solver-order sample j. */
export const xAt = (g: ForgeGrid, j: number): number => (j - g.N / 2) * g.dx;

/** Wrapped Fourier momentum of plain-FFT bin i (bin 0 = k = 0). */
export const kAt = (g: ForgeGrid, i: number): number =>
  (i < g.N / 2 ? i : i - g.N) * g.dk;

/** Momentum of display-order (negative k on the left) sample m. */
export const kDisplayAt = (g: ForgeGrid, m: number): number => (m - g.N / 2) * g.dk;

/**
 * Envelope amplitude A(x) ≥ 0 requested by the UI, before phase and
 * normalisation. `custom` linearly resamples the freehand stroke, which lets a
 * drawing made at N = 512 survive a grid change.
 */
export function envelopeAt(p: ForgeParams, g: ForgeGrid, x: number): number {
  const u = x - p.center;
  const w = Math.max(0.02, p.width);
  switch (p.envelope) {
    case 'square':
      return Math.abs(u) <= w ? 1 : 0;
    case 'lorentz':
      return 1 / (1 + (u / w) * (u / w));
    case 'custom':
      return sampleDrawn(p.drawn, g, x);
    case 'gauss':
    default: {
      const t = u / (2 * w);
      return Math.exp(-t * t);
    }
  }
}

/** Linear resampling of the freehand buffer into the current grid. */
export function sampleDrawn(drawn: number[], g: ForgeGrid, x: number): number {
  const n = drawn.length;
  if (n === 0) return 0;
  const t = (x + g.xMax) / (2 * g.xMax);
  const f = t * (n - 1);
  if (f <= 0) return n === 1 ? drawn[0] : 0;
  if (f >= n - 1) return n === 1 ? drawn[0] : 0;
  const i = Math.floor(f);
  const frac = f - i;
  const a = drawn[i];
  const b = drawn[i + 1];
  return a + (b - a) * frac;
}

/**
 * Build the normalised position-space wavefunction into `out`
 * (interleaved re/im, length 2·N). Returns the L² norm actually stored, which
 * is 1 unless the envelope is empty.
 */
export function buildWavefunction(p: ForgeParams, g: ForgeGrid, out: FftArray): number {
  const c = Math.max(-g.xMax + 1, Math.min(g.xMax - 1, p.center));
  const chirp = Number.isFinite(p.chirp) ? p.chirp : 0;
  const tilt = Number.isFinite(p.tilt) ? p.tilt : 0;
  let acc = 0;
  for (let j = 0; j < g.N; j++) {
    const x = xAt(g, j);
    const a = envelopeAt(p, g, x);
    const u = x - c;
    const phase = tilt * u + 0.5 * chirp * u * u;
    const re = a * Math.cos(phase);
    const im = a * Math.sin(phase);
    out[j * 2] = re;
    out[j * 2 + 1] = im;
    acc += re * re + im * im;
  }
  const norm = acc * g.dx;
  if (norm <= 0 || !Number.isFinite(norm)) {
    out.fill(0);
    return 0;
  }
  const s = 1 / Math.sqrt(norm);
  for (let i = 0; i < out.length; i++) out[i] *= s;
  return 1;
}

/**
 * Continuous-normalised momentum wavefunction φ(k) = (1/√2π)∫ψ e^{−ikx}dx.
 *
 * Written into `out` in **display order** (most negative k first) so it can be
 * plotted directly; `dx/√(2π)` scaling makes Σ|φ|²·dk = Σ|ψ|²·dx exactly.
 */
export function toMomentum(psi: FftArray, g: ForgeGrid, out: FftArray): void {
  const n = g.N;
  const half = n >> 1;
  const scale = g.dx / Math.sqrt(2 * Math.PI);
  // ifftshift: move x = 0 from index N/2 to index 0 (self-inverse for even N).
  for (let i = 0; i < n; i++) {
    const src = (i + half) % n;
    out[i * 2] = psi[src * 2] * scale;
    out[i * 2 + 1] = psi[src * 2 + 1] * scale;
  }
  fft(out);
  // fftshift the result so negative momenta appear on the left.
  for (let i = 0; i < half; i++) {
    const ra = i * 2;
    const rb = (i + half) * 2;
    const tr = out[ra];
    const ti = out[ra + 1];
    out[ra] = out[rb];
    out[ra + 1] = out[rb + 1];
    out[rb] = tr;
    out[rb + 1] = ti;
  }
}

/** Second-moment statistics of ψ(x) (solver order). */
export function positionMoments(
  psi: FftArray,
  g: ForgeGrid,
): Pick<Moments, 'norm' | 'meanX' | 'varX' | 'sigmaX'> {
  let n0 = 0;
  let n1 = 0;
  let n2 = 0;
  for (let j = 0; j < g.N; j++) {
    const re = psi[j * 2];
    const im = psi[j * 2 + 1];
    const rho = re * re + im * im;
    const x = xAt(g, j);
    n0 += rho;
    n1 += rho * x;
    n2 += rho * x * x;
  }
  const norm = n0 * g.dx;
  if (norm <= 0) return { norm: 0, meanX: 0, varX: 0, sigmaX: 0 };
  const meanX = n1 / n0;
  const varX = Math.max(0, n2 / n0 - meanX * meanX);
  return { norm, meanX, varX, sigmaX: Math.sqrt(varX) };
}

/**
 * Momentum-space statistics. Deliberately reads the *unshifted* spectrum: the
 * cyclic shift used for display only multiplies φ by a unit phase, so ⟨p⟩ and
 * σp are identical either way and no extra buffer is needed.
 */
export function momentumMoments(
  psi: FftArray,
  g: ForgeGrid,
  work?: FftArray,
): { meanP: number; varP: number; sigmaP: number } {
  const buf = work ?? new Float64Array(psi.length);
  buf.set(psi);
  fft(buf);
  const scale = g.dx / Math.sqrt(2 * Math.PI);
  let n0 = 0;
  let n1 = 0;
  let n2 = 0;
  for (let i = 0; i < g.N; i++) {
    const re = buf[i * 2] * scale;
    const im = buf[i * 2 + 1] * scale;
    const rho = re * re + im * im;
    const k = kAt(g, i);
    n0 += rho;
    n1 += rho * k;
    n2 += rho * k * k;
  }
  if (n0 <= 0) return { meanP: 0, varP: 0, sigmaP: 0 };
  const meanP = n1 / n0;
  const varP = Math.max(0, n2 / n0 - meanP * meanP);
  return { meanP, varP, sigmaP: Math.sqrt(varP) };
}

/** Full Heisenberg report for a wavefunction. */
export function measure(psi: FftArray, g: ForgeGrid): Moments {
  const x = positionMoments(psi, g);
  const p = momentumMoments(psi, g);
  return {
    ...x,
    ...p,
    product: x.sigmaX * p.sigmaP,
    kinetic: 0.5 * (p.varP + p.meanP * p.meanP),
  };
}

/**
 * Closed-form moments of the *chirped Gaussian* the forge builds analytically.
 *
 * With ψ = exp(−x²/(4σ²))·exp(i(chirp·x²/2 + tilt·x)) and ħ = 1:
 *   σx = σ,  σp² = 1/(4σ²) + chirp²σ²,  (σxσp)² = 1/4 + chirp²σ⁴.
 * The chirp term is the spectral broadening the gauge compares against.
 */
export function analyticGaussian(p: ForgeParams): {
  sigmaX: number;
  sigmaP: number;
  product: number;
  excess: number;
  meanP: number;
} {
  const s = Math.max(0.02, p.width);
  const sigmaP = Math.sqrt(1 / (4 * s * s) + p.chirp * p.chirp * s * s);
  const product = s * sigmaP;
  return {
    sigmaX: s,
    sigmaP,
    product,
    excess: product - 0.5,
    meanP: p.tilt,
  };
}

/**
 * Exact free-particle spreading of a (possibly chirped) Gaussian.
 *
 * With ħ = m = 1 the Heisenberg operator is x̂(t) = x̂(0) + t·p̂(0), so
 *   σx²(t) = σx²(0) + 2t·Cov + t²σp²(0),   Cov = c·σ²,  σp² = 1/(4σ²) + c²σ²
 * which collapses to σ²(1 + ct)² + t²/(4σ²). At c = 0 that is the textbook
 * σ0·√(1 + (t/2σ0²)²). Used to cross-check the split-step integrator on screen.
 */
export function analyticSpreading(sigma0: number, t: number, chirp = 0): number {
  if (sigma0 <= 0) return 0;
  if (chirp === 0) {
    const u = t / (2 * sigma0 * sigma0);
    return sigma0 * Math.sqrt(1 + u * u);
  }
  const u = 1 + chirp * t;
  return Math.sqrt(sigma0 * sigma0 * u * u + (t * t) / (4 * sigma0 * sigma0));
}

/**
 * One Strang-split free propagation step. For V ≡ 0 the kinetic exponential is
 * the *exact* propagator, so the scheme is unitary to FFT round-off and norm
 * drift stays at the 1e-13 level no matter how long the tour runs.
 */
export function stepFree(psi: FftArray, g: ForgeGrid, dt: number): void {
  fft(psi);
  kineticKick(psi, g.dk, dt);
  ifft(psi);
}

/** Apply a real potential phase e^{−iV(x)dt} in place (Strang half-kick). */
export function potentialKick(
  psi: FftArray,
  g: ForgeGrid,
  v: (x: number) => number,
  dt: number,
): void {
  for (let j = 0; j < g.N; j++) {
    const p = v(xAt(g, j)) * dt;
    const c = Math.cos(p);
    const s = Math.sin(p);
    const re = psi[j * 2];
    const im = psi[j * 2 + 1];
    psi[j * 2] = re * c - im * s;
    psi[j * 2 + 1] = re * s + im * c;
  }
}

/** Rescale ψ in place so ∫|ψ|²dx = 1 (guards against float32 creep). */
export function renormalize(psi: FftArray, g: ForgeGrid): number {
  let acc = 0;
  for (let i = 0; i < psi.length; i += 2) {
    const re = psi[i];
    const im = psi[i + 1];
    acc += re * re + im * im;
  }
  const norm = acc * g.dx;
  if (norm <= 0 || !Number.isFinite(norm)) return 0;
  const s = 1 / Math.sqrt(norm);
  for (let i = 0; i < psi.length; i++) psi[i] *= s;
  return norm;
}

/** Gauge state for the Heisenberg read-out: only a true minimum lights green. */
export function gaugeState(product: number): 'good' | 'warn' | 'bad' {
  if (!Number.isFinite(product)) return 'bad';
  if (product <= 0.5 * 1.005) return 'good';
  if (product <= 0.5 * 1.25) return 'warn';
  return 'bad';
}

/**
 * Paint a freehand stroke sample into the drawn buffer.
 * `drawn` is mutated in place (or resampled) and returned. The brush blends the
 * stored Re ψ value toward `value` with a Gaussian falloff of radius `brush`, so
 * a stroke can both raise and lower the envelope and stays band-limited enough
 * for a clean FFT — no jagged step, which would otherwise spray the spectrum.
 */
export function paintDrawn(
  drawn: number[],
  length: number,
  g: ForgeGrid,
  xFrom: number,
  xTo: number,
  value: number,
  brush: number,
): number[] {
  const out = drawn.length === length ? drawn : resampleDrawn(drawn, length);
  const half = Math.max(g.dx, brush * 0.5);
  const lo = Math.max(0, Math.floor(((Math.min(xFrom, xTo) - half + g.xMax) / (2 * g.xMax)) * length));
  const hi = Math.min(
    length - 1,
    Math.ceil(((Math.max(xFrom, xTo) + half + g.xMax) / (2 * g.xMax)) * length),
  );
  for (let i = lo; i <= hi; i++) {
    const x = -g.xMax + (i / (length - 1 || 1)) * 2 * g.xMax;
    const t = (x - xTo) / half;
    const w = Math.exp(-t * t * 1.6);
    if (w <= 0.004) continue;
    const target = value * w + out[i] * (1 - w);
    out[i] = Math.max(-1, Math.min(1, target));
  }
  return out;
}

/** Linear resample of the freehand buffer to a new length. */
export function resampleDrawn(drawn: number[], length: number): number[] {
  if (drawn.length === length) return drawn.slice();
  if (drawn.length === 0) return new Array<number>(length).fill(0);
  const out = new Array<number>(length);
  const m = drawn.length - 1;
  for (let i = 0; i < length; i++) {
    const f = length === 1 ? 0 : (i / (length - 1)) * m;
    const a = Math.floor(f);
    const b = Math.min(m, a + 1);
    out[i] = drawn[a] + (drawn[b] - drawn[a]) * (f - a);
  }
  return out;
}

export const HBAR = 1; // atomic units
/** The bound the gauge checks against: ħ/2. */
export const HEISENBERG_FLOOR = HBAR / 2;
