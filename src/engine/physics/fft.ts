/**
 * Radix-2 complex FFT (Quantahedron shared engine).
 *
 * Pure TypeScript, zero dependencies, no DOM — safe to import from a Server
 * Component, a Web Worker or a unit test. Data is stored **interleaved** in a
 * single typed array (`[re0, im0, re1, im1, ...]`) so a wavefunction can be
 * transformed in place with no allocation, which is what the real-time
 * split-step propagators in `simulations/uncertainty-lab` need every frame.
 *
 * Conventions
 * -----------
 * `fft` computes the un-normalised forward DFT
 *
 *     X[k] = Σ_{n=0}^{N-1} x[n] · exp(−2πi·kn/N)
 *
 * and `ifft` computes the inverse *with* the 1/N factor, so
 * `ifft(fft(x)) === x` to floating-point accuracy. Physical normalisation
 * (the dx/√(2π) factors of the continuous transform) is applied by callers —
 * see `momentumWavefunction` in the uncertainty lab, which keeps Parseval exact.
 *
 * Both routines operate on `Float32Array` (GPU-friendly, faster) and
 * `Float64Array` (used for the precision regression tests), hence the
 * `FftArray` union.
 */

export type FftArray = Float32Array | Float64Array;

/** Largest power of two ≤ n (used to clamp a grid request to a valid FFT size). */
export function floorPow2(n: number): number {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return p;
}

/**
 * Bit-reversal permutation table for a given size, memoised per size so the
 * 60 Hz loops never re-allocate. Tables hold source indices for `dest = i`.
 */
const bitRevCache = new Map<number, Int32Array>();

function bitReversalTable(log2n: number): Int32Array {
  const n = 1 << log2n;
  const hit = bitRevCache.get(n);
  if (hit) return hit;
  const table = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i;
    let r = 0;
    for (let b = 0; b < log2n; b++) {
      r = (r << 1) | (x & 1);
      x >>= 1;
    }
    table[i] = r;
  }
  bitRevCache.set(n, table);
  return table;
}

/**
 * In-place iterative Cooley–Tukey radix-2 decimation-in-time FFT.
 *
 * @param data interleaved complex samples, length must be 2·(power of two)
 * @param sign −1 for the forward transform, +1 for the un-normalised inverse
 */
function transform(data: FftArray, sign: 1 | -1): void {
  const n2 = data.length;
  if (n2 < 4 || n2 % 2 !== 0) return;
  const n = n2 >> 1;
  if ((n & (n - 1)) !== 0) return; // not a power of two → leave data untouched
  const log2n = Math.log2(n);

  // 1. bit-reversal reordering
  const rev = bitReversalTable(log2n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const tr = data[i * 2];
      const ti = data[i * 2 + 1];
      data[i * 2] = data[j * 2];
      data[i * 2 + 1] = data[j * 2 + 1];
      data[j * 2] = tr;
      data[j * 2 + 1] = ti;
    }
  }

  // 2. butterfly stages. Twiddles are advanced by a complex multiply seeded from
  //    a freshly computed cosine per stage, which keeps the accumulated phase
  //    error O(ε) instead of the O(ε·N) of a naive recurrence.
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = Math.PI / half;
    const wRe = Math.cos(step);
    const wIm = sign * Math.sin(step);
    for (let start = 0; start < n; start += size) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = (start + k) * 2;
        const b = a + half * 2;
        const xr = data[b];
        const xi = data[b + 1];
        const vr = xr * curRe - xi * curIm;
        const vi = xr * curIm + xi * curRe;
        data[b] = data[a] - vr;
        data[b + 1] = data[a + 1] - vi;
        data[a] += vr;
        data[a + 1] += vi;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nRe;
      }
    }
  }
}

/** Forward DFT, in place, un-normalised. */
export function fft(data: FftArray): void {
  transform(data, -1);
}

/** Inverse DFT, in place, including the 1/N factor (exact round-trip). */
export function ifft(data: FftArray): void {
  transform(data, 1);
  const n = data.length >> 1;
  if (n === 0) return;
  const inv = 1 / n;
  for (let i = 0; i < data.length; i++) data[i] *= inv;
}

/**
 * Split-step Fourier free-particle kick: multiply bin k by exp(−i·k²·dt/2),
 * the exact kinetic propagator for ħ = m = 1.
 *
 * `data` must be in **plain FFT order** (bin 0 = k = 0, negative frequencies
 * wrapped to the top half), i.e. straight out of {@link fft} with no shift.
 * `dk` is the Fourier sample spacing of the grid the buffer was produced on.
 */
export function kineticKick(data: FftArray, dk: number, dt: number): void {
  const n = data.length >> 1;
  const half = n >> 1;
  for (let i = 0; i < n; i++) {
    const k = (i < half ? i : i - n) * dk;
    const phase = -0.5 * k * k * dt;
    const re = data[i * 2];
    const im = data[i * 2 + 1];
    const c = Math.cos(phase);
    const s = Math.sin(phase);
    data[i * 2] = re * c - im * s;
    data[i * 2 + 1] = re * s + im * c;
  }
}
