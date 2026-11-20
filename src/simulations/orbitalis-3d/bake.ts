/**
 * Orbitalis 3D — eigenstate bake pass.
 *
 * One eigenstate = one 3D texture holding (Re ψ, Im ψ). The bake is
 *
 *  · chunked   — z-slabs with yields, so a 96³ bake never blocks a frame;
 *  · shared-normalised — every slot is divided by the SAME peak amplitude, which
 *    keeps relative densities inside a superposition physically honest
 *    (a 1s+2p mix really is dominated by 1s). The renderer restores visibility
 *    with an auto-exposure gain instead of cheating the physics.
 *  · dual-resolution — full resolution for the GPU, a decimated copy for the CPU
 *    rejection sampler that feeds the particle cloud and the measurement engine.
 *
 * Encoding is chosen from the GPU probe: RGBA16F when float textures sample
 * correctly, otherwise a 16-bit-per-component split into RGBA8.
 */

import { MAX_N } from '@/engine/physics/constants';
import { Ylm, radialWavefunction } from '@/engine/physics/hydrogen';
import type { BakeData, BakeProgress } from './types';

/** Cell-centred sample position inside [-rBox, rBox]³. */
function voxelPos(i: number, j: number, k: number, res: number, rBox: number): [number, number, number] {
  const s = (2 * rBox) / res;
  return [-rBox + (i + 0.5) * s, -rBox + (j + 0.5) * s, -rBox + (k + 0.5) * s];
}

/**
 * Peak |ψ_nlm| over all space, evaluated analytically enough for normalisation:
 * max r of |R_nℓ|² times max θ of |Y_ℓ^m|² (independent of φ).
 */
export function peakAmplitude(n: number, l: number, m: number, Z: number): number {
  let rMax = 0;
  const rcut = (12 * n * n) / Math.max(Z, 0.4);
  for (let i = 1; i <= 900; i++) {
    const r = (i / 900) * rcut;
    const R = radialWavefunction(n, l, m, r, Z);
    const v = R * R;
    if (v > rMax) rMax = v;
  }
  let yMax = 0;
  for (let i = 0; i <= 360; i++) {
    const theta = (i / 360) * Math.PI;
    const Y = Ylm(l, m, theta, 0);
    const v = Y.re * Y.re + Y.im * Y.im;
    if (v > yMax) yMax = v;
  }
  return Math.sqrt(Math.max(1e-12, rMax * yMax));
}

/** IEEE-754 binary16 encoder (WebGL2 HALF_FLOAT upload needs the bits). */
export function floatToHalf(value: number): number {
  if (!Number.isFinite(value)) return value > 0 ? 0x7c00 : 0xfc00;
  const f32 = new Float32Array(1);
  f32[0] = value;
  const bits = new Int32Array(f32.buffer)[0];
  let sign = (bits >>> 16) & 0x8000;
  let exp = ((bits >>> 23) & 0xff) - 127 + 15;
  let frac = bits & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow to signed zero
    frac |= 0x800000;
    const shift = 14 - exp;
    exp = 0;
    frac = Math.round(frac / 2 ** shift);
    if (frac >= 0x1000000) {
      exp = 1;
      frac = 0;
    }
    return sign | (exp << 10) | (frac >> 13);
  }
  if (exp >= 31) {
    return sign | 0x7c00; // overflow → infinity
  }
  // Round-to-nearest-even on the 13 discarded mantissa bits.
  const half = frac & 0x1fff;
  frac >>= 13;
  if (half > 0x1000 || (half === 0x1000 && (frac & 1) === 1)) {
    frac++;
    if (frac > 0x3ff) {
      frac = 0;
      exp++;
      if (exp >= 31) return sign | 0x7c00;
    }
  }
  sign = sign & 0xffff;
  return sign | (exp << 10) | frac;
}

function encodeHalf(raw: Float32Array, out: Uint16Array, inv: number) {
  const n = raw.length >> 1;
  for (let i = 0; i < n; i++) {
    out[i * 4] = floatToHalf(raw[i * 2] * inv);
    out[i * 4 + 1] = floatToHalf(raw[i * 2 + 1] * inv);
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = floatToHalf(1);
  }
}

function encodePacked(raw: Float32Array, out: Uint8Array, inv: number) {
  const n = raw.length >> 1;
  for (let i = 0; i < n; i++) {
    const re = Math.max(-1, Math.min(1, raw[i * 2] * inv));
    const im = Math.max(-1, Math.min(1, raw[i * 2 + 1] * inv));
    const q0 = Math.round((re * 0.5 + 0.5) * 65535);
    const q1 = Math.round((im * 0.5 + 0.5) * 65535);
    out[i * 4] = (q0 >> 8) & 255;
    out[i * 4 + 1] = (q1 >> 8) & 255;
    out[i * 4 + 2] = q0 & 255;
    out[i * 4 + 3] = q1 & 255;
  }
}

const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

export interface BakeRequest {
  n: number;
  l: number;
  m: number;
  Z: number;
  /** Shared peak amplitude every slot is divided by. */
  norm: number;
  res: number;
  rBox: number;
  packed: boolean;
  /** Decimated CPU grid edge length used by the samplers. */
  sampleRes: number;
}

/**
 * Bake a single |n ℓ m⟩. The loop is slab-chunked: `chunk` z-planes at a time,
 * then a yield, so the stage keeps painting (and the demo clock keeps running)
 * while a high-n orbital materialises.
 */
export async function bakeSlot(req: BakeRequest, onProgress?: BakeProgress): Promise<BakeData> {
  const { n, l, m, Z, norm, res, rBox, packed, sampleRes } = req;
  const safeN = Math.min(MAX_N, Math.max(1, Math.round(n)));
  const safeL = Math.min(safeN - 1, Math.max(0, Math.round(l)));
  const safeM = Math.min(safeL, Math.max(-safeL, Math.round(m)));

  const raw = new Float32Array(res * res * res * 2);
  const rLimit = rBox * 1.001;
  let peakSeen = 0;

  const chunk = Math.max(1, Math.round(res / 9));
  for (let k = 0; k < res; k++) {
    const zEnd = Math.min(res, k + chunk);
    for (let kk = k; kk < zEnd; kk++) {
      const base = kk * res * res;
      for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) {
          const [x, y, z] = voxelPos(i, j, kk, res, rBox);
          const r2 = x * x + y * y + z * z;
          if (r2 > rLimit * rLimit) continue;
          const theta = Math.acos(Math.max(-1, Math.min(1, z / (Math.sqrt(r2) || 1e-9))));
          const phi = Math.atan2(y, x);
          const R = radialWavefunction(safeN, safeL, safeM, Math.sqrt(r2), Z);
          const Y = Ylm(safeL, safeM, theta, phi);
          const re = R * Y.re;
          const im = R * Y.im;
          const o = ((base + j * res + i) << 1) | 0;
          raw[o] = re;
          raw[o + 1] = im;
          const d = re * re + im * im;
          if (d > peakSeen) peakSeen = d;
        }
      }
    }
    k = zEnd - 1;
    onProgress?.(zEnd / res);
    if (zEnd < res) await yieldToBrowser();
  }

  const inv = 1 / norm;
  const count = raw.length >> 1;
  const gpu = packed ? new Uint8Array(count * 4) : new Uint16Array(count * 4);
  if (packed) encodePacked(raw, gpu as Uint8Array, inv);
  else encodeHalf(raw, gpu as Uint16Array, inv);

  // Decimate for the CPU samplers (particle cloud + detector hits).
  const stride = Math.max(1, Math.round(res / sampleRes));
  const sRes = Math.floor(res / stride);
  const cpuRe = new Float32Array(sRes * sRes * sRes);
  const cpuIm = new Float32Array(sRes * sRes * sRes);
  let s = 0;
  for (let k = 0; k < sRes; k++) {
    for (let j = 0; j < sRes; j++) {
      for (let i = 0; i < sRes; i++) {
        const o = (((k * stride) * res + j * stride) * res + i * stride) << 1;
        cpuRe[s] = raw[o] * inv;
        cpuIm[s] = raw[o + 1] * inv;
        s++;
      }
    }
  }

  return {
    gpu,
    res,
    packed,
    cpuRe,
    cpuIm,
    cpuRes: sRes,
    rBox,
    peak: Math.sqrt(peakSeen) * inv,
  };
}

/** Cache key — a slot is reused across amplitude/phase/time/field edits. */
export function bakeKey(n: number, l: number, m: number, Z: number, res: number, packed: boolean): string {
  return `${n}|${l}|${m}|${Z.toFixed(3)}|${res}|${packed ? 1 : 0}`;
}
