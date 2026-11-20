/**
 * 2D Double-Slit — pure solver core (no DOM, no WebGL).
 *
 * This module owns everything that must agree with the GPU shaders in
 * `@/engine/shaders/doubleSlit`: the unit conversion from the flat parameter map
 * to lattice config, the four-stage RK4 Horner step, the which-path phase plate,
 * the phosphor strip and the histogram statistics. The CPU engine
 * implemented here is both the fallback renderer (no WebGL2 / no float
 * textures) and the reference the GPU path is checked against, so the two paths
 * are the *same* discretisation, not an approximation of each other.
 *
 * Units: ħ = mₑ = 1, lattice spacing dx = 1 cell, domain coordinates
 * u ∈ [0,1]². A `momentum` of p (domain units) has de Broglie wavelength
 * λ = 2π/p and lattice wavenumber k = p/N rad/cell. The field is normalised so
 * that Σ_cells |ψ|² = 1 per emitted electron.
 */

import { pArr, pBool } from '@/store/useSimStore';
import { fft, floorPow2 } from '@/engine/physics/fft';
import type { SimParams } from '@/simulations/types';

/* ------------------------------- constants -------------------------------- */

/** Barrier height in lattice energy units (κ = √(2V) ≈ 2 cells⁻¹ ⇒ opaque). */
export const BARRIER_V = 2.0;
/** Complex-absorbing-potential peak rate in the edge sponge. */
export const SPONGE_W = 5.0;
/** Sponge thickness in domain units. */
export const SPONGE_SPAN = 0.09;
/** RK4 imaginary-axis limit is 2√2; 0.88 of it keeps a safety margin. */
export const CFL = 2.5;
/** Longitudinal packet width as a multiple of `packetSigma`. */
export const LONG_RATIO = 1.6;
/** Detector plane position in domain units — just upstream of the right sponge. */
export const SCREEN_X = 0.885;
/** Leftmost injection plane; `buildConfig` slides it right if the packet needs it. */
export const INJECT_X = 0.075;
/** Cap on the persisted histogram length. */
export const MAX_BINS = 320;
/** Cap on on-screen single-electron dots. */
export const MAX_DOTS = 2600;

/* -------------------------------- config ---------------------------------- */

export interface SlitConfig {
  /** Cells per side. */
  N: number;
  barrierX: number;
  barrierT: number;
  slitW: number;
  sep: number;
  /** Slit centres in domain units (0 = upper, 1 = lower). */
  slitY0: number;
  slitY1: number;
  /** Domain momentum, de Broglie wavelength and the rad/cell equivalent. */
  momentum: number;
  lambda: number;
  kCell: number;
  packetY: number;
  sigmaD: number;
  sigmaX: number;
  injectX: number;
  screenX: number;
  /** Peak amplitude of one emitted packet (Σ_cells |ψ|² = 1). */
  amp: number;
  /** Stable lattice time step for this geometry. */
  dt: number;
  /** CFL-saturated substeps needed for a visible crossing speed. */
  stepsPerFrame: number;
  barrierV: number;
  sponge: number;
  spongeW: number;
  /** Detector mark phase φ = (π/2)·decoherence, carried by each new packet. */
  tagPhase: number;
  tagSlit: number;
  whichPath: boolean;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Accept numbers or numeric strings — the inspector writes strings for selects. */
export function numParam(p: SimParams, key: string, fallback: number): number {
  const raw = p[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Grid resolution the learner asked for, snapped to a supported square. */
export function requestGridRes(p: SimParams, fallback = 512): number {
  const raw = numParam(p, 'gridRes', fallback);
  const allowed = [256, 384, 512];
  let best = allowed[1];
  let bd = Infinity;
  for (const a of allowed) {
    const d = Math.abs(a - raw);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best;
}

/** CPU fallback lattice — half the requested resolution, kept square. */
export function cpuGridRes(res: number): number {
  return res >= 512 ? 160 : res >= 384 ? 128 : 96;
}

/**
 * Map the flat parameter map onto lattice config. Everything downstream (GPU
 * uniforms and the CPU integrator) reads only this, so the two cannot drift.
 */
export function buildConfig(p: SimParams, N: number): SlitConfig {
  const grid = Math.max(32, Math.round(N));
  const barrierX = clamp(numParam(p, 'barrierX', 0.34), 0.08, 0.82);
  const barrierT = clamp(numParam(p, 'barrierThickness', 0.035), 0.004, 0.2);
  const slitW = clamp(numParam(p, 'slitWidth', 0.028), 0.004, 0.22);
  const sep = clamp(numParam(p, 'separation', 0.16), 0.02, 0.62);
  const momentum = clamp(numParam(p, 'momentum', 210), 20, 900);
  const sigmaD = clamp(numParam(p, 'packetSigma', 0.06), 0.01, 0.3);
  const packetY = clamp(numParam(p, 'packetY', 0.5), 0.08, 0.92);
  const lambda = (2 * Math.PI) / momentum;
  const sigmaX = sigmaD * LONG_RATIO;
  // Σ_cells |ψ|² = 1 over the blended Gaussian: the emission window exp(−1.5r²)
  // multiplies the amplitude envelope, leaving |ψ|² = amp²·exp(−4r²), whose
  // integral is amp²·π·σX·σD·N².
  const amp = 1 / (Math.sqrt(Math.PI) * Math.sqrt(sigmaX * sigmaD) * grid);
  // Kinetic band edge of −½∇² is 4 (2D, dx=1); add the barrier step height, so
  // dt·λmax = CFL = 2.5 stays inside the RK4 imaginary-axis window 2√2.
  const dt = CFL / (4 + BARRIER_V);
  const substeps = clamp(numParam(p, 'substeps', 2), 1, 8);
  const timeScale = clamp(numParam(p, 'timeScale', 2.5), 0.2, 4);
  const decoherence = clamp(numParam(p, 'decoherence', 1), 0, 1);
  return {
    N: grid,
    barrierX,
    barrierT,
    slitW,
    sep,
    slitY0: clamp(0.5 + sep / 2, 0.02, 0.98),
    slitY1: clamp(0.5 - sep / 2, 0.02, 0.98),
    momentum,
    lambda,
    kCell: momentum / grid,
    packetY,
    sigmaD,
    sigmaX,
    injectX: Math.min(
      Math.max(INJECT_X, 1.6 * sigmaX),
      Math.max(INJECT_X * 0.5, barrierX - barrierT - 0.05),
    ),
    screenX: SCREEN_X,
    amp,
    dt,
    stepsPerFrame: Math.max(1, Math.min(10, Math.round(substeps * timeScale))),
    barrierV: BARRIER_V,
    sponge: SPONGE_W,
    spongeW: SPONGE_SPAN,
    tagPhase: (Math.PI / 2) * decoherence,
    tagSlit: numParam(p, 'whichPathSlit', 0) >= 1 ? 1 : 0,
    whichPath: pBool(p, 'whichPath', false),
  };
}

/* ------------------------------- geometry --------------------------------- */

/** 1 inside solid barrier material — mirrors `q_barrier()` in GLSL. */
export function barrierAt(cfg: SlitConfig, ux: number, uy: number): number {
  const x0 = cfg.barrierX - 0.5 * cfg.barrierT;
  const x1 = cfg.barrierX + 0.5 * cfg.barrierT;
  if (ux < x0 || ux > x1) return 0;
  const a0 = Math.abs(uy - cfg.slitY0) < 0.5 * cfg.slitW ? 1 : 0;
  const a1 = Math.abs(uy - cfg.slitY1) < 0.5 * cfg.slitW ? 1 : 0;
  return a0 + a1 > 0 ? 0 : 1;
}

/**
 * Which-path plate weight along y — mirrors `q_tag()`: 1 over the arm feeding the
 * marked slit, 0 over the other, with a C1 cubic ramp of half-width sep/4 centred
 * on the beam axis. The apertures sit at mid ± sep/2, deep inside the saturated
 * zones, so every ray reaching a slit carries that slit's single mark phase and
 * the ramp itself has no sharp edge to diffract.
 */
export function tagWeight(cfg: SlitConfig, uy: number, slit: number): number {
  const mid = 0.5 * (cfg.slitY0 + cfg.slitY1);
  const hw = Math.max(1e-4, 0.25 * Math.abs(cfg.slitY0 - cfg.slitY1));
  let u = (uy - mid + hw) / (2 * hw);
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const g = u * u * (3 - 2 * u);
  return slit === 1 ? 1 - g : g;
}

/** CAP rate W(ux,uy) — mirrors `q_absorb()`. */
export function absorbAt(cfg: SlitConfig, ux: number, uy: number): number {
  const w = cfg.spongeW;
  const r = (ux - (1 - w)) / w;
  const t = (w - uy) / w;
  const b = (uy - (1 - w)) / w;
  const s = Math.max(r, t, b);
  const ramp = s > 0 ? s * s : 0;
  return cfg.sponge * ramp + 2.5 * cfg.barrierV * barrierAt(cfg, ux, uy);
}

/* ------------------------------ field state ------------------------------- */

export interface Field {
  re: Float32Array;
  im: Float32Array;
  N: number;
}

export function createField(N: number): Field {
  return { re: new Float32Array(N * N), im: new Float32Array(N * N), N };
}

export interface SlitBuffers {
  state: Field;
  tmp1: Field;
  tmp2: Field;
}

export function createBuffers(N: number): SlitBuffers {
  return { state: createField(N), tmp1: createField(N), tmp2: createField(N) };
}

export function clearField(f: Field): void {
  f.re.fill(0);
  f.im.fill(0);
}

/** Cell-centred domain coordinate. */
export const cellU = (N: number, i: number): number => (i + 0.5) / N;

/**
 * Inject one normalised packet with the which-path coin `phase` imprinted through
 * the plate `tagWeight` — mirrors `DS_EMIT_FRAG`. Because the phase rides on the
 * *new* packet only, packets already in flight keep the coin they were emitted
 * with, so the ensemble coherence is exactly ⟨e^{±iφ}⟩ = cos φ.
 */
export function emitPacket(state: Field, cfg: SlitConfig, phase: number): void {
  const { N } = state;
  const inv2x = 1 / (2 * cfg.sigmaX);
  const inv2y = 1 / (2 * cfg.sigmaD);
  for (let j = 0; j < N; j++) {
    const uy = cellU(N, j);
    const band = cfg.whichPath ? tagWeight(cfg, uy, cfg.tagSlit) : 0;
    const ang0 = phase * band;
    const dy = uy - cfg.packetY;
    const ry2 = dy * dy * inv2y * inv2y;
    const row = j * N;
    for (let i = 0; i < N; i++) {
      const dx = cellU(N, i) - cfg.injectX;
      const rx2 = dx * dx * inv2x * inv2x;
      const r2 = rx2 + ry2;
      const w = Math.exp(-r2 * 1.5);
      if (w < 1e-5) continue;
      const amp = cfg.amp * Math.exp(-r2 * 0.5);
      const ang = ang0 + cfg.momentum * dx;
      const idx = row + i;
      const pr = state.re[idx];
      const pi = state.im[idx];
      state.re[idx] = pr + (amp * Math.cos(ang) - pr) * w;
      state.im[idx] = pi + (amp * Math.sin(ang) - pi) * w;
    }
  }
}

/**
 * One Horner factor out = base + coef·(−iĤ)(src), optional CAP damping —
 * mirrors `DS_STEP_FRAG`.
 */
function hornerPass(src: Field, base: Field, out: Field, cfg: SlitConfig, coef: number, final: boolean): void {
  const N = src.N;
  const re = src.re;
  const im = src.im;
  const oR = out.re;
  const oI = out.im;
  const bR = base.re;
  const bI = base.im;
  const invN = 1 / N;
  for (let j = 0; j < N; j++) {
    const uy = (j + 0.5) * invN;
    const up = j > 0 ? (j - 1) * N : -1;
    const dn = j < N - 1 ? (j + 1) * N : -1;
    const row = j * N;
    for (let i = 0; i < N; i++) {
      const ux = (i + 0.5) * invN;
      const lf = i > 0 ? row + i - 1 : -1;
      const rt = i < N - 1 ? row + i + 1 : -1;
      const idx = row + i;
      const cRe = re[idx];
      const cIm = im[idx];
      let lapRe = -4 * cRe;
      let lapIm = -4 * cIm;
      if (lf >= 0) {
        lapRe += re[lf];
        lapIm += im[lf];
      }
      if (rt >= 0) {
        lapRe += re[rt];
        lapIm += im[rt];
      }
      if (up >= 0) {
        lapRe += re[up + i];
        lapIm += im[up + i];
      }
      if (dn >= 0) {
        lapRe += re[dn + i];
        lapIm += im[dn + i];
      }
      // Ĥ = −½∇² + V with the 5-point stencil: `lap` below is ∇²ψ (negative
      // semi-definite, band [−8, 0]), so the kinetic term is −0.5·lap ∈ [0, 4].
      const V = cfg.barrierV * barrierAt(cfg, ux, uy);
      const hRe = -0.5 * lapRe + V * cRe;
      const hIm = -0.5 * lapIm + V * cIm;
      let oRe = bR[idx] + coef * hIm;
      let oIm = bI[idx] - coef * hRe;
      if (final) {
        const damp = Math.exp(-absorbAt(cfg, ux, uy) * cfg.dt);
        oRe *= damp;
        oIm *= damp;
      }
      oR[idx] = Number.isFinite(oRe) ? oRe : 0;
      oI[idx] = Number.isFinite(oIm) ? oIm : 0;
    }
  }
}

/**
 * One classical RK4 step of size cfg.dt, four passes over three buffers. The
 * buffer roles rotate exactly like the GPU version: after the step `buf.state`
 * holds ψ(t+dt) and the previous ψ₀ slot becomes scratch.
 */
export function rk4Step(buf: SlitBuffers, cfg: SlitConfig): void {
  const { dt } = cfg;
  const a = buf.state;
  const t1 = buf.tmp1;
  const t2 = buf.tmp2;
  hornerPass(a, a, t1, cfg, dt / 4, false);
  hornerPass(t1, a, t2, cfg, dt / 3, false);
  hornerPass(t2, a, t1, cfg, dt / 2, false);
  hornerPass(t1, a, t2, cfg, dt, true);
  buf.state = t2;
  buf.tmp2 = a;
  buf.tmp1 = t1;
}

/** Σ_cells |ψ|² over the whole field (1.0 = one electron present). */
export function fieldNorm(f: Field): number {
  let s = 0;
  for (let i = 0; i < f.re.length; i++) {
    const re = f.re[i];
    const im = f.im[i];
    s += re * re + im * im;
  }
  return s;
}

/**
 * Detector line read-out: density and x-current *area-averaged over the cells
 * belonging to each detector row* — mirrors `DS_SCREEN_FRAG`. A phosphor pixel
 * integrates light, it does not sample one cell, and averaging the whole cell band
 * is what keeps the read-out free of resampling moiré when rows ≠ N.
 */
export function readStrip(
  f: Field,
  cfg: SlitConfig,
  rows: number,
  densityOut: Float32Array,
  fluxOut: Float32Array,
): void {
  const N = f.N;
  const cx = Math.min(N - 2, Math.max(1, Math.round(cfg.screenX * N)));
  for (let r = 0; r < rows; r++) {
    // Cells whose centre (j + 0.5)/N falls inside the row's span [r/rows,
    // (r+1)/rows). This partitions the lattice: every cell belongs to exactly one
    // row, so no cell is skipped or double-counted however rows and N compare.
    const j0 = Math.max(0, Math.ceil((r * N) / rows - 0.5));
    const j1 = Math.min(N - 1, Math.max(j0, Math.ceil(((r + 1) * N) / rows - 0.5) - 1));
    let acc = 0;
    let fwd = 0;
    let cnt = 0;
    for (let j = j0; j <= j1; j++) {
      if (j < 0 || j >= N) continue;
      const idx = j * N + cx;
      const a = f.re[idx];
      const b = f.im[idx];
      acc += a * a + b * b;
      fwd += a * (f.im[idx + 1] - f.im[idx - 1]) - b * (f.re[idx + 1] - f.re[idx - 1]);
      cnt++;
    }
    const n = cnt || 1;
    densityOut[r] = acc / n;
    fluxOut[r] = fwd / n;
  }
}

/* --------------------------- phosphor statistics -------------------------- */

/** Bin a detector strip into the histogram, conserving the integrated weight. */
export function binStrip(strip: Float32Array, bins: number, out: Float64Array): void {
  const n = Math.min(bins, out.length);
  out.fill(0);
  const rows = strip.length;
  if (rows === 0 || n <= 0) return;
  // Each row is distributed over the bins its cell spans, weighted by the
  // overlap fraction, so bins ≠ rows keeps the integral exact instead of
  // aliasing (Σ out = Σ strip for any bin count).
  for (let r = 0; r < rows; r++) {
    const lo = (r / rows) * n;
    const hi = ((r + 1) / rows) * n;
    const b0 = Math.min(n - 1, Math.floor(lo));
    const b1 = Math.min(n - 1, Math.max(b0, Math.ceil(hi) - 1));
    const v = strip[r];
    if (b0 === b1) {
      out[b0] += v;
      continue;
    }
    const span = hi - lo;
    for (let b = b0; b <= b1; b++) {
      const from = Math.max(lo, b);
      const to = Math.min(hi, b + 1);
      out[b] += (v * Math.max(0, to - from)) / span;
    }
  }
}

/**
 * Fringe visibility V = (Imax − Imin)/(Imax + Imin) of a phosphor histogram,
 * taken between the central maximum and the *first* minimum on either side of it
 * — the textbook central-fringe definition. Walking only to the adjacent minima
 * (rather than to the deepest dip anywhere) keeps the single-slit envelope and the
 * faint outer ripples out of the number. Returns 0 for an empty or
 * featureless pattern rather than a spurious 1.
 */
export function fringeVisibility(hist: ArrayLike<number>, bins: number): number {
  const n = Math.min(bins, hist.length);
  if (n < 8) return 0;
  const sm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = hist[Math.max(0, i - 1)];
    const b = hist[i];
    const c = hist[Math.min(n - 1, i + 1)];
    sm[i] = (a + 2 * b + c) / 4;
  }
  let peak = 0;
  let peakIdx = -1;
  for (let i = 0; i < n; i++) {
    if (sm[i] > peak) {
      peak = sm[i];
      peakIdx = i;
    }
  }
  if (peakIdx < 0 || peak <= 0) return 0;
  const left = adjacentMin(sm, peakIdx, -1);
  const right = adjacentMin(sm, peakIdx, 1);
  const parts: number[] = [];
  if (left >= 0) parts.push(sm[left]);
  if (right >= 0) parts.push(sm[right]);
  if (parts.length === 0) return 0;
  const valley = parts.reduce((a, b) => a + b, 0) / parts.length;
  const v = (peak - valley) / (peak + valley);
  return clamp(v, 0, 1);
}

/** Walk from a maximum in direction `dir` to the first minimum it turns up at. */
function adjacentMin(sm: Float64Array, from: number, dir: number): number {
  let i = from;
  let fell = false;
  for (let guard = 0; guard < sm.length; guard++) {
    const j = i + dir;
    if (j < 0 || j >= sm.length) return -1;
    if (sm[j] < sm[i]) {
      fell = true;
      i = j;
      continue;
    }
    if (sm[j] === sm[i]) {
      i = j;
      continue;
    }
    return fell ? i : -1;
  }
  return -1;
}

/**
 * Measured fringe spacing in domain units. A power-of-two window centred on the
 * brightest maximum is mean-removed, Hann-tapered and Fourier analysed, and the
 * dominant spatial frequency is refined with a parabola. Spectral analysis is the
 * only robust way here: the dark fringes dip to zero, so any "region above a
 * threshold" scan cuts the pattern after one period, and counting maxima is
 * defeated by the envelope and the click noise. Returns NaN when the spectrum
 * shows no line standing out of the noise floor.
 */
export function measureFringeSpacing(hist: ArrayLike<number>, bins: number): number {
  const n = Math.min(bins, hist.length);
  if (n < 16) return NaN;
  let peak = 0;
  let peakIdx = -1;
  for (let i = 0; i < n; i++) {
    if (hist[i] > peak) {
      peak = hist[i];
      peakIdx = i;
    }
  }
  if (peakIdx < 0 || peak <= 0) return NaN;
  const size = floorPow2(n);
  if (size < 16) return NaN;
  const start = Math.min(n - size, Math.max(0, Math.round(peakIdx - size / 2)));
  let mean = 0;
  for (let i = 0; i < size; i++) mean += hist[start + i];
  mean /= size;
  const buf = new Float64Array(size * 2);
  for (let i = 0; i < size; i++) {
    buf[i * 2] = (hist[start + i] - mean) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  fft(buf);
  let best = 0;
  let bestBin = 0;
  let floor = 0;
  for (let k = 2; k <= size >> 1; k++) {
    const mag = Math.hypot(buf[k * 2], buf[k * 2 + 1]);
    floor += mag;
    if (mag > best) {
      best = mag;
      bestBin = k;
    }
  }
  floor /= Math.max(1, (size >> 1) - 1);
  if (bestBin === 0 || !(best > 2.5 * floor)) return NaN;
  const a = bestBin > 1 ? Math.hypot(buf[(bestBin - 1) * 2], buf[(bestBin - 1) * 2 + 1]) : 0;
  const c = bestBin < size / 2 ? Math.hypot(buf[(bestBin + 1) * 2], buf[(bestBin + 1) * 2 + 1]) : 0;
  const den = a - 2 * best + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  const freq = bestBin + Math.max(-0.5, Math.min(0.5, Number.isFinite(shift) ? shift : 0));
  if (!(freq > 0)) return NaN;
  return size / freq / n;
}

/** Round-robin-free exponential wait sampler for the phosphor click train. */
export function poissonCount(mean: number, rnd: () => number): number {
  if (mean <= 0) return 0;
  if (mean < 30) {
    // Knuth: exact Poisson, and clicks are what the money shot is made of.
    const l = Math.exp(-mean);
    let k = 0;
    let pp = 1;
    do {
      k++;
      pp *= rnd();
    } while (pp > l);
    return k - 1;
  }
  return Math.max(0, Math.round(mean + Math.sqrt(mean) * gaussian(rnd)));
}

export function gaussian(rnd: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Inverse-CDF bin pick over a non-negative weight vector. */
export function pickBin(weights: ArrayLike<number>, total: number, r: number): number {
  if (total <= 0) return -1;
  let target = r * total;
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i];
    if (target <= 0) return i;
  }
  return weights.length - 1;
}

/** Compact the histogram into the persisted number[] (clamped length + range). */
export function histToArray(hist: ArrayLike<number>, bins: number): number[] {
  const n = Math.min(MAX_BINS, Math.max(0, Math.round(bins)));
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.min(99999, Math.max(0, Math.round(hist[i] ?? 0)));
  }
  return out;
}

/** Restore a persisted histogram (permalink restore of a built-up pattern). */
export function histFromArray(p: SimParams, bins: number): number[] {
  const src = pArr(p, 'screenHits');
  const n = Math.min(MAX_BINS, Math.max(0, Math.round(bins)));
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < Math.min(n, src.length); i++) {
    const v = src[i];
    out[i] = Number.isFinite(v) ? Math.min(99999, Math.max(0, v)) : 0;
  }
  return out;
}

/* ------------------------- engine interface (shared) ---------------------- */

export interface SlitDrawOptions {
  contrast: number;
  phaseColor: boolean;
  palette: 0 | 1;
  showBarrier: boolean;
  fieldAlpha: number;
}

/**
 * Common surface of the WebGL2 and CPU engines. The stage component never
 * branches on which one it got, except to report it in the telemetry.
 */
export interface SlitEngine {
  readonly kind: 'gpu' | 'cpu';
  readonly N: number;
  reset(cfg: SlitConfig): void;
  /** Emit one packet; `phase` is that electron's ± detector mark (0 = none). */
  emit(cfg: SlitConfig, phase: number): void;
  advance(cfg: SlitConfig, steps: number): void;
  /** Fill the detector strip; returns Σ_cells |ψ|². */
  probe(cfg: SlitConfig, rows: number, density: Float32Array, flux: Float32Array): number;
  draw(canvas: HTMLCanvasElement, cfg: SlitConfig, opts: SlitDrawOptions): void;
  dispose(): void;
}
