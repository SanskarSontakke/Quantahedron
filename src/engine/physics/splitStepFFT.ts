/**
 * Split-step Fourier (Kapidura–Osborne / symmetric Strang) propagator for the
 * 1D time-dependent Schrödinger equation, plus the closed-form and transfer
 * matrix transmission coefficients used by the barrier lab.
 *
 * One step splits the exact evolution operator into a kinetic half-kick, an
 * exact drift in reciprocal space and a potential half-kick:
 *
 *   ψ ← exp(−iVΔt/2ℏ) · FFT⁻¹[ exp(−iℏk²Δt/2m) FFT[ exp(−iVΔt/2ℏ) ψ ] ]
 *
 * which is second order accurate in Δt and, because both factors have unit
 * modulus, exactly norm preserving (the only drift is floating point round-off).
 * A Complex Absorbing Sponge is applied as a real contraction exp(−Δt W/ℏ).
 *
 * The FFT is a self-contained iterative radix-2 Cooley–Tukey on split real /
 * imaginary Float64 buffers: no allocations per step, no dependencies, identical
 * code path on the main thread and inside a Worker.
 */

/* ------------------------------------ FFT ---------------------------------- */

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/** Smallest power of two ≥ n (≥ 2). */
export function nextPowerOfTwo(n: number): number {
  let p = 2;
  while (p < n) p <<= 1;
  return p;
}

/**
 * In-place radix-2 Cooley–Tukey FFT on interleaved-free buffers.
 * `inverse = false` computes the unnormalised forward transform,
 * `inverse = true` computes the transform divided by N, so
 * `ifft(fft(x)) === x` to machine precision.
 */
export function fftTransform(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  if (!isPowerOfTwo(n)) {
    throw new Error(`fftTransform requires a power-of-two length, got ${n}`);
  }
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curR = 1;
      let curI = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const xr = re[b] * curR - im[b] * curI;
        const xi = re[b] * curI + im[b] * curR;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nr;
      }
    }
  }
  if (inverse) {
    const inv = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= inv;
      im[i] *= inv;
    }
  }
}

/** Forward transform returning a copy (diagnostics / spectral plots). */
export function fftForward(re: Float64Array, im: Float64Array): [Float64Array, Float64Array] {
  const outRe = Float64Array.from(re);
  const outIm = Float64Array.from(im);
  fftTransform(outRe, outIm, false);
  return [outRe, outIm];
}

/* ------------------------------ propagator -------------------------------- */

export interface SplitStepSetup {
  /** Number of grid points (power of two). */
  n: number;
  /** Grid spacing in the length unit shared with V, k and dt. */
  dx: number;
  /** Time step. */
  dt: number;
  /** Potential samples (length n). */
  v: Float64Array | number[];
  hbar?: number;
  mass?: number;
}

/**
 * Fixed-Hamiltonian split-step propagator with cached trig tables.
 * `setPotential` re-derives the two half-kicks in O(N).
 */
export class SplitStepPropagator {
  readonly n: number;
  readonly dx: number;
  readonly dt: number;
  readonly hbar: number;
  readonly mass: number;
  readonly v: Float64Array;
  /** exp(−i V Δt/2ℏ) tables. */
  readonly vCos: Float64Array;
  readonly vSin: Float64Array;
  /** exp(−i ℏ k² Δt/2m) tables in FFT bin order. */
  readonly kCos: Float64Array;
  readonly kSin: Float64Array;
  /** Momentum grid ℏk in FFT bin order (positive, then negative frequencies). */
  readonly p: Float64Array;
  /** Angular wavenumbers k in FFT bin order. */
  readonly k: Float64Array;

  constructor(setup: SplitStepSetup) {
    const n = setup.n;
    if (!isPowerOfTwo(n)) throw new Error(`SplitStep requires a power-of-two grid, got ${n}`);
    this.n = n;
    this.dx = setup.dx;
    this.dt = setup.dt;
    this.hbar = setup.hbar ?? 1;
    this.mass = setup.mass ?? 1;
    this.v = Float64Array.from(setup.v);
    this.vCos = new Float64Array(n);
    this.vSin = new Float64Array(n);
    this.kCos = new Float64Array(n);
    this.kSin = new Float64Array(n);
    this.k = new Float64Array(n);
    this.p = new Float64Array(n);
    this.rebuild();
  }

  setPotential(v: Float64Array | number[]): void {
    this.v.set(v);
    this.rebuild();
  }

  private rebuild(): void {
    const { n, dx, dt, hbar, mass } = this;
    for (let j = 0; j < n; j++) {
      const half = (dt * this.v[j]) / (2 * hbar);
      this.vCos[j] = Math.cos(half);
      this.vSin[j] = Math.sin(half);
    }
    for (let b = 0; b < n; b++) {
      // FFT bin b ↔ angular wavenumber 2π b/(N dx), folded to the negative half.
      const kk = ((b <= n / 2 ? b : b - n) * 2 * Math.PI) / (n * dx);
      this.k[b] = kk;
      this.p[b] = hbar * kk;
      const phase = (hbar * kk * kk * dt) / (2 * mass);
      this.kCos[b] = Math.cos(phase);
      this.kSin[b] = Math.sin(phase);
    }
  }

  /** ψ ← exp(−iVΔt/2ℏ) ψ */
  private kickPotential(re: Float64Array, im: Float64Array): void {
    for (let j = 0; j < this.n; j++) {
      const c = this.vCos[j];
      const s = this.vSin[j];
      const xr = re[j];
      const xi = im[j];
      re[j] = xr * c + xi * s;
      im[j] = xi * c - xr * s;
    }
  }

  /** ψ ← exp(−iℏk²Δt/2m) ψ evaluated in reciprocal space. */
  private drift(re: Float64Array, im: Float64Array): void {
    fftTransform(re, im, false);
    for (let b = 0; b < this.n; b++) {
      const c = this.kCos[b];
      const s = this.kSin[b];
      const xr = re[b];
      const xi = im[b];
      re[b] = xr * c + xi * s;
      im[b] = xi * c - xr * s;
    }
    fftTransform(re, im, true);
  }

  /** One symmetric Strang step. */
  step(re: Float64Array, im: Float64Array): void {
    this.kickPotential(re, im);
    this.drift(re, im);
    this.kickPotential(re, im);
  }

  /**
   * Multiplicative Complex Absorbing Potential, ψ ← exp(−Δt W/ℏ)ψ with W ≥ 0.
   * A positive contraction: it can only drain norm from the sponge layers.
   * Returns the probability drained this step, so callers can bill
   * "norm + drained = norm₀" and still verify the Strang map is unitary.
   */
  applyCap(re: Float64Array, im: Float64Array, cap: Float64Array): number {
    const k = this.dt / this.hbar;
    let removed = 0;
    for (let j = 0; j < this.n; j++) {
      const w = cap[j];
      if (w <= 0) continue;
      const f = Math.exp(-k * w);
      const d = re[j] * re[j] + im[j] * im[j];
      removed += d * (1 - f * f) * this.dx;
      re[j] *= f;
      im[j] *= f;
    }
    return removed;
  }

  /** Advance `steps` Strang steps; returns the probability the sponge drained. */
  advance(re: Float64Array, im: Float64Array, steps: number, cap?: Float64Array | null): number {
    let removed = 0;
    for (let s = 0; s < steps; s++) {
      this.step(re, im);
      if (cap) removed += this.applyCap(re, im, cap);
    }
    return removed;
  }
}

/** Functional wrapper mirroring {@link crankNicolsonEvolve}, used by the tests. */
export function splitStepEvolve(
  re: Float64Array,
  im: Float64Array,
  v: Float64Array,
  dt: number,
  dx: number,
  steps: number,
  options: { hbar?: number; mass?: number; cap?: Float64Array | null } = {},
): [Float64Array, Float64Array] {
  const prop = new SplitStepPropagator({
    n: re.length,
    dx,
    dt,
    v,
    hbar: options.hbar,
    mass: options.mass,
  });
  prop.advance(re, im, steps, options.cap ?? null);
  return [re, im];
}

/* -------------------------- analytic transmission -------------------------- */

interface Cx {
  re: number;
  im: number;
}

interface Mat2 {
  a: Cx;
  b: Cx;
  c: Cx;
  d: Cx;
}

const ZERO: Cx = { re: 0, im: 0 };

function add(x: Cx, y: Cx): Cx {
  return { re: x.re + y.re, im: x.im + y.im };
}

function mul(x: Cx, y: Cx): Cx {
  return { re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re };
}

function scale(x: Cx, s: number): Cx {
  return { re: x.re * s, im: x.im * s };
}

function abs2(x: Cx): number {
  return x.re * x.re + x.im * x.im;
}

function identity2(): Mat2 {
  return { a: { re: 1, im: 0 }, b: ZERO, c: ZERO, d: { re: 1, im: 0 } };
}

function mul2(x: Mat2, y: Mat2): Mat2 {
  return {
    a: add(mul(x.a, y.a), mul(x.b, y.c)),
    b: add(mul(x.a, y.b), mul(x.b, y.d)),
    c: add(mul(x.c, y.a), mul(x.d, y.c)),
    d: add(mul(x.c, y.b), mul(x.d, y.d)),
  };
}

/**
 * Propagation matrix of one piecewise-constant layer of width `d` with (possibly
 * complex) wave vector q, acting on the vector (ψ, ψ′):
 *
 *   [[cos(qd), sin(qd)/q], [−q·sin(qd), cos(qd)]]
 *
 * Valid for q real (propagating) and q = iκ (evanescent) alike, since cos and
 * sin of an imaginary argument turn into cosh and sinh automatically.
 */
function layerMatrix(d: number, qRe: number, qIm: number): Mat2 {
  if (Math.abs(qRe) < 1e-12 && Math.abs(qIm) < 1e-12) {
    return { a: { re: 1, im: 0 }, b: { re: d, im: 0 }, c: ZERO, d: { re: 1, im: 0 } };
  }
  const zr = qRe * d;
  const zi = qIm * d;
  const cos: Cx = {
    re: Math.cos(zr) * Math.cosh(zi),
    im: -Math.sin(zr) * Math.sinh(zi),
  };
  const sin: Cx = {
    re: Math.sin(zr) * Math.cosh(zi),
    im: Math.cos(zr) * Math.sinh(zi),
  };
  const q2 = qRe * qRe + qIm * qIm;
  const sinOverQ: Cx = {
    re: (sin.re * qRe + sin.im * qIm) / q2,
    im: (sin.im * qRe - sin.re * qIm) / q2,
  };
  const minusQSsin: Cx = {
    re: -(qRe * sin.re - qIm * sin.im),
    im: -(qRe * sin.im + qIm * sin.re),
  };
  return { a: cos, b: sinOverQ, c: minusQSsin, d: cos };
}

/**
 * Complex wavenumber inside a region of constant potential: q = √(2m(E−V))/ℏ,
 * taking the branch with non-negative imaginary part (decaying evanescent wave).
 */
export function regionWaveVector(
  e: number,
  v: number,
  mass: number = 1,
  hbar: number = 1,
): [number, number] {
  const arg = (2 * mass * (e - v)) / (hbar * hbar);
  if (arg >= 0) return [Math.sqrt(arg), 0];
  return [0, Math.sqrt(-arg)];
}

/**
 * Transmission coefficient of a stack of piecewise-constant regions obtained by
 * multiplying 2×2 (ψ, ψ′) transfer matrices — exact for any profile built from
 * flat steps (single rectangle, double barrier, any multilayer) on both sides of
 * every barrier height.
 *
 * Matching (ψ, ψ′) across the stack gives, with incident amplitude 1,
 *
 *   A = M₁₁ − ik·M₀₁,   B = ik·M₀₀ − M₁₀,
 *   c = (A + B/(ik))/2,   t = (M₀₀A + M₀₁B)/c · e^{−ikL},   T = |t|²
 *
 * and the phase factor drops out of |t|. Leads on both sides sit at V = 0.
 */
export function transferMatrixTransmission(
  e: number,
  regions: { width: number; v: number }[],
  mass: number = 1,
  hbar: number = 1,
): number {
  if (e <= 0) return 0;
  const [kRe, kIm] = regionWaveVector(e, 0, mass, hbar);
  if (!(kRe > 0) || kIm !== 0) return 0;
  let m = identity2();
  for (const region of regions) {
    if (region.width <= 0) continue;
    const [qRe, qIm] = regionWaveVector(e, region.v, mass, hbar);
    m = mul2(m, layerMatrix(region.width, qRe, qIm));
  }
  const ikTimes = (x: Cx): Cx => ({ re: -kRe * x.im, im: kRe * x.re });
  const A = add(m.d, scale(ikTimes(m.b), -1)); // M11 − ik M01
  const B = add(ikTimes(m.a), { re: -m.c.re, im: -m.c.im }); // ik M00 − M10
  const num = add(mul(m.a, A), mul(m.b, B));
  // (A, B) is proportional to the physical (1+r, ik(1−r)) with c = (A + B/(ik))/2,
  // and 1/(ik) = −i/k. Hence t = 2·(M00A + M01B)/(A + B/(ik)) up to a phase.
  const den = add(A, { re: B.im / kRe, im: -B.re / kRe });
  const den2 = abs2(den);
  if (!(den2 > 0)) return 0;
  return Math.max(0, Math.min(1, (4 * abs2(num)) / den2));
}

/**
 * Exact rectangular-barrier transmission, the textbook closed form.
 *
 *   E < V₀ : T = [1 + V₀² sinh²(κa) / (4E(V₀−E))]⁻¹
 *   E > V₀ : T = [1 + V₀² sin²(k₂a) / (4E(E−V₀))]⁻¹
 *   E = V₀ : T = [1 + m V₀ a² / (2ℏ²)]⁻¹
 */
export function transmissionRectangular(
  e: number,
  v0: number,
  width: number,
  mass: number = 1,
  hbar: number = 1,
): number {
  if (e <= 0) return 0;
  if (v0 <= 0 || width <= 0) return 1;
  const diff = e - v0;
  if (Math.abs(diff) < 1e-9 * Math.max(1, v0)) {
    return 1 / (1 + (mass * v0 * width * width) / (2 * hbar * hbar));
  }
  if (diff < 0) {
    const kappa = Math.sqrt((2 * mass * -diff) / (hbar * hbar));
    const s = Math.sinh(kappa * width);
    return 1 / (1 + (v0 * v0 * s * s) / (4 * e * -diff));
  }
  const k2 = Math.sqrt((2 * mass * diff) / (hbar * hbar));
  const s = Math.sin(k2 * width);
  return 1 / (1 + (v0 * v0 * s * s) / (4 * e * diff));
}

/**
 * Exact double-barrier transmission (two identical rectangular barriers of height
 * V₀ and width `width` separated by a well of width `gap`). Ramsauer–Townsend
 * resonances reach T = 1 whenever k_well·gap = nπ.
 */
export function transmissionDouble(
  e: number,
  v0: number,
  width: number,
  gap: number,
  mass: number = 1,
  hbar: number = 1,
): number {
  return transferMatrixTransmission(
    e,
    [
      { width, v: v0 },
      { width: gap, v: 0 },
      { width, v: v0 },
    ],
    mass,
    hbar,
  );
}

/** Evanescent decay constant κ = √(2m(V₀−E))/ℏ (0 when propagating). */
export function evanescentKappa(e: number, v0: number, mass: number = 1, hbar: number = 1): number {
  const arg = (2 * mass * (v0 - e)) / (hbar * hbar);
  return arg > 0 ? Math.sqrt(arg) : 0;
}

/** WKB transmission through an arbitrary barrier profile sampled on a grid. */
export function transmissionWkb(
  e: number,
  v: Float64Array | number[],
  dx: number,
  mass: number = 1,
  hbar: number = 1,
): number {
  let integral = 0;
  for (let j = 0; j < v.length; j++) {
    const arg = (2 * mass * (v[j] - e)) / (hbar * hbar);
    if (arg > 0) integral += Math.sqrt(arg) * dx;
  }
  if (integral <= 0) return 1;
  const g = Math.min(700, integral);
  return Math.exp(-2 * g);
}
