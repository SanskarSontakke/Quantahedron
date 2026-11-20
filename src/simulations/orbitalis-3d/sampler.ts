/**
 * Orbitalis 3D — CPU sampler.
 *
 * Reads the decimated complex grids produced by the bake pass and draws exact
 * Born-rule positions: p(x) ∝ |Σ_k c_k e^{-iE_k t} ψ_k(x)|². The same routine
 * feeds the particle-cloud renderer and the measurement/collapse engine, so the
 * dots the learner sees really are distributed as the cloud they overlay.
 *
 * Deterministic: a seeded PRNG keeps a permalink reproducing the same cloud.
 */

import type { BakeData } from './types';

export const POINT_STRIDE = 6; // x, y, z, phase, intensity, size

export interface FieldSlot {
  data: BakeData;
  amp: number;
  phase: number;
  omega: number;
}

export interface Field {
  slots: FieldSlot[];
  rBox: number;
  res: number;
}

/** mulberry32 — small, fast, reproducible. */
export function makeRng(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildField(slots: FieldSlot[]): Field {
  const first = slots[0]?.data;
  return {
    slots,
    rBox: first?.rBox ?? 1,
    res: first?.cpuRes ?? 1,
  };
}

/** Ψ on the coarse grid at voxel index `o`, fully time-evolved and summed. */
export function psiVoxel(field: Field, o: number, t: number): [number, number] {
  let re = 0;
  let im = 0;
  for (const s of field.slots) {
    if (s.amp <= 0) continue;
    const vr = s.data.cpuRe[o] ?? 0;
    const vi = s.data.cpuIm[o] ?? 0;
    const ang = s.phase - s.omega * t;
    const cs = Math.cos(ang) * s.amp;
    const sn = Math.sin(ang) * s.amp;
    re += cs * vr - sn * vi;
    im += cs * vi + sn * vr;
  }
  return [re, im];
}

/** Peak density over a strided scan of the coarse grid (rejection envelope). */
export function peakDensity(field: Field, t: number, samples = 3000): number {
  const n = field.res * field.res * field.res;
  if (n <= 0) return 0;
  const step = Math.max(1, Math.floor(n / samples));
  let peak = 0;
  for (let o = 0; o < n; o += step) {
    const [re, im] = psiVoxel(field, o, t);
    const d = re * re + im * im;
    if (d > peak) peak = d;
  }
  return peak;
}

/**
 * Rejection-sample `count` positions from |Ψ(t)|² into `out` (interleaved
 * POINT_STRIDE floats starting at particle index `from`). Returns how many
 * particles were actually written; the caller pads or retries on the next frame.
 */
export function sampleCloud(
  field: Field,
  t: number,
  out: Float32Array,
  from: number,
  count: number,
  rng: () => number,
  opts: { peak: number; size?: number; intensity?: number } ,
): number {
  const { res, rBox } = field;
  const peak = opts.peak;
  if (peak <= 0 || res < 2) return 0;
  const cell = (2 * rBox) / res;
  const size = opts.size ?? 1.7;
  const baseIntensity = opts.intensity ?? 0.9;
  const maxTries = count * 24 + 400;
  let written = from;
  for (let tries = 0; tries < maxTries && written - from < count; tries++) {
    const i = Math.floor(rng() * res);
    const j = Math.floor(rng() * res);
    const k = Math.floor(rng() * res);
    const o = (k * res + j) * res + i;
    const [re, im] = psiVoxel(field, o, t);
    const d = re * re + im * im;
    if (d <= 0 || rng() * peak > d) continue;
    const p = written * POINT_STRIDE;
    if (p + POINT_STRIDE > out.length) break;
    out[p] = -rBox + (i + 0.5) * cell;
    out[p + 1] = -rBox + (j + 0.5) * cell;
    out[p + 2] = -rBox + (k + 0.5) * cell;
    out[p + 3] = Math.atan2(im, re);
    out[p + 4] = baseIntensity * Math.min(1, 0.35 + (d / peak) * 0.9);
    out[p + 5] = size;
    written++;
  }
  return written - from;
}

/**
 * A single detector hit for the measurement engine: exact position plus the
 * eigenstate that would be found if the same trial measured energy instead.
 */
export function measurePositions(field: Field, t: number, count: number, rng: () => number, peak: number): number[][] {
  const pts: number[][] = [];
  const buf = new Float32Array(count * POINT_STRIDE);
  const n = sampleCloud(field, t, buf, 0, count, rng, { peak, size: 1.2, intensity: 1 });
  for (let i = 0; i < n; i++) {
    pts.push([buf[i * POINT_STRIDE], buf[i * POINT_STRIDE + 1], buf[i * POINT_STRIDE + 2], buf[i * POINT_STRIDE + 3]]);
  }
  return pts;
}

/** Probability of each eigenstate in the superposition (Born rule, |c|²/Σ|c|²). */
export function bornWeights(amps: number[]): number[] {
  const w = amps.map((a) => a * a);
  const s = w.reduce((x, y) => x + y, 0) || 1;
  return w.map((x) => x / s);
}

/** Draw an index from a weight vector — used for projective collapse. */
export function drawIndex(weights: number[], rng: () => number): number {
  const r = rng();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r <= acc) return i;
  }
  return Math.max(0, weights.length - 1);
}
