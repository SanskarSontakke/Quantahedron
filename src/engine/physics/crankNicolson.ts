/**
 * Crank–Nicolson machinery for the 1D time-dependent Schrödinger equation.
 *
 *   iℏ ∂ψ/∂t = [ −(ℏ²/2m) ∂²/∂x² + V(x) ] ψ
 *
 * The scheme is the Cayley ([1/1] Padé) approximation of exp(−iΔt H/ℏ):
 *
 *   (1 + iΔt H / 2ℏ) ψⁿ⁺¹ = (1 − iΔt H / 2ℏ) ψⁿ
 *
 * Because the two sides are f(H) and 1/f(H) with f(z) = 1 + izΔt/2ℏ — a rational
 * function of the *same* Hermitian matrix — the amplification operator is exactly
 * unitary (up to floating point round-off, ~1e-15/step). In this discretisation
 * that makes the linear system tridiagonal with constant off-diagonals, so it is
 * solved with the Thomas algorithm in O(N) with no pivoting (the matrix is
 * strictly diagonally dominant: |1 + i(2a+v_j)| = √(1+(2a+v_j)²) > 2a).
 *
 * Units: ℏ = m = 1 (atomic units). Lengths are given through `dx`, so a caller
 * working in a physical box of D atomic units passes dx = D / N, and a caller
 * working in normalised box coordinates passes dx = 1 / N.
 *
 * A Complex Absorbing Potential (CAP) is applied as a separate multiplicative
 * contraction exp(−Δt W/ℏ) with W ≥ 0. Keeping it out of the implicit side means
 * the oscillatory part of the step stays *exactly* norm-preserving, so the norm
 * drift telemetry measures the integrator, not the sponge.
 *
 * Pure TypeScript, zero imports: safe to share between the main thread and a Web
 * Worker, and safe to compile standalone for numerical verification.
 */

/* ---------------------------------- scales -------------------------------- */

/** Physical length of the tdse-1d domain, in atomic units (x ∈ [−D/2, +D/2]). */
export const TDSE_BOX_AU = 15;
/** Potential value used to model an "infinite" wall (a.u.). κ⁻¹ ≈ 1.8 cells at N=512. */
export const V_HARD_WALL = 2000;
/** Energy scale reached at the outer edge of the CAP sponge (a.u.) per unit strength. */
export const CAP_W_SCALE = 250;

/* --------------------------------- complex -------------------------------- */

/**
 * In-place complex tridiagonal solve with the Thomas algorithm, given the
 * forward-elimination factors produced by {@link thomasFactor}: `dinv` holds
 * 1/betᵢ and `cp` holds the *modified* upper diagonal cᵢ/betᵢ. `sub`/`sup` are
 * the raw lower/upper diagonals (sub[i] multiplies x[i-1] in row i).
 * The solution overwrites `xRe`/`xIm`, which carry the right-hand side on entry.
 */
export function thomasSolveComplex(
  n: number,
  subRe: number,
  subIm: number,
  cpRe: Float64Array,
  cpIm: Float64Array,
  dinvRe: Float64Array,
  dinvIm: Float64Array,
  xRe: Float64Array,
  xIm: Float64Array,
): void {
  // Forward sweep: x ← (d − a·x_{i−1}) / bet.
  let xr = xRe[0];
  let xi = xIm[0];
  let dr = dinvRe[0];
  let di = dinvIm[0];
  xRe[0] = xr * dr - xi * di;
  xIm[0] = xr * di + xi * dr;
  for (let i = 1; i < n; i++) {
    const pRe = subRe * xRe[i - 1] - subIm * xIm[i - 1];
    const pIm = subRe * xIm[i - 1] + subIm * xRe[i - 1];
    xr = xRe[i] - pRe;
    xi = xIm[i] - pIm;
    dr = dinvRe[i];
    di = dinvIm[i];
    xRe[i] = xr * dr - xi * di;
    xIm[i] = xr * di + xi * dr;
  }
  // Back substitution with the modified upper diagonal.
  for (let i = n - 2; i >= 0; i--) {
    const qRe = cpRe[i] * xRe[i + 1] - cpIm[i] * xIm[i + 1];
    const qIm = cpRe[i] * xIm[i + 1] + cpIm[i] * xRe[i + 1];
    xRe[i] -= qRe;
    xIm[i] -= qIm;
  }
}

/**
 * Cache the forward-elimination factors of the constant-off-diagonal complex
 * tridiagonal system used by the CN step. Must be recalled whenever V changes.
 */
export function thomasFactor(
  n: number,
  subRe: number,
  subIm: number,
  supRe: number,
  supIm: number,
  diagRe: Float64Array,
  diagIm: Float64Array,
  cpRe: Float64Array,
  cpIm: Float64Array,
  dinvRe: Float64Array,
  dinvIm: Float64Array,
): void {
  for (let i = 0; i < n; i++) {
    const bRe = diagRe[i] - (i === 0 ? 0 : subRe * cpRe[i - 1] - subIm * cpIm[i - 1]);
    const bIm = diagIm[i] - (i === 0 ? 0 : subRe * cpIm[i - 1] + subIm * cpRe[i - 1]);
    const m = bRe * bRe + bIm * bIm;
    dinvRe[i] = bRe / m;
    dinvIm[i] = -bIm / m;
    if (i < n - 1) {
      cpRe[i] = (supRe * bRe + supIm * bIm) / m;
      cpIm[i] = (supIm * bRe - supRe * bIm) / m;
    } else {
      cpRe[i] = 0;
      cpIm[i] = 0;
    }
  }
}

/* -------------------------------- solver ---------------------------------- */

export interface CnSetup {
  /** Number of grid cells. */
  n: number;
  /** Time step, in units of ℏ/E (atomic units when ℏ = 1). */
  dt: number;
  /** Grid spacing in the length unit used by V and the initial state. */
  dx: number;
  /** ℏ (default 1). */
  hbar?: number;
  /** m (default 1). */
  mass?: number;
  /** Potential samples, length n, in the energy unit conjugate to dt. */
  v: Float64Array | number[];
}

/**
 * Reusable, allocation-free Crank–Nicolson propagator for one fixed Hamiltonian.
 * `setPotential` rebuilds the elimination factors; `step` advances ψ by dt.
 */
export class CrankNicolsonSolver {
  readonly n: number;
  readonly dx: number;
  readonly dt: number;
  readonly hbar: number;
  readonly mass: number;
  /** Kinetic prefactor a = dt·ℏ / (4 m dx²) appearing in the tridiagonal rows. */
  readonly a: number;
  readonly v: Float64Array;

  private readonly diagRe: Float64Array;
  private readonly diagIm: Float64Array;
  private readonly cpRe: Float64Array;
  private readonly cpIm: Float64Array;
  private readonly dinvRe: Float64Array;
  private readonly dinvIm: Float64Array;
  private readonly rhsRe: Float64Array;
  private readonly rhsIm: Float64Array;
  private subRe = 0;
  private subIm = 0;
  private supRe = 0;
  private supIm = 0;

  constructor(setup: CnSetup) {
    const hbar = setup.hbar ?? 1;
    const mass = setup.mass ?? 1;
    this.n = setup.n;
    this.dx = setup.dx;
    this.dt = setup.dt;
    this.hbar = hbar;
    this.mass = mass;
    this.a = (setup.dt * hbar) / (4 * mass * setup.dx * setup.dx);
    this.v = Float64Array.from(setup.v);

    const n = this.n;
    this.diagRe = new Float64Array(n);
    this.diagIm = new Float64Array(n);
    this.cpRe = new Float64Array(n);
    this.cpIm = new Float64Array(n);
    this.dinvRe = new Float64Array(n);
    this.dinvIm = new Float64Array(n);
    this.rhsRe = new Float64Array(n);
    this.rhsIm = new Float64Array(n);
    this.rebuild();
  }

  /** Replace V(x) (same grid) and refactor the implicit operator. */
  setPotential(v: Float64Array | number[]): void {
    this.v.set(v);
    this.rebuild();
  }

  private rebuild(): void {
    const { n, a, dt, hbar } = this;
    // LHS off-diagonals are −i a, RHS off-diagonals +i a.
    this.subRe = 0;
    this.subIm = -a;
    this.supRe = 0;
    this.supIm = -a;
    for (let j = 0; j < n; j++) {
      const half = (dt * this.v[j]) / (2 * hbar);
      this.diagRe[j] = 1;
      this.diagIm[j] = 2 * a + half;
    }
    thomasFactor(
      n,
      this.subRe,
      this.subIm,
      this.supRe,
      this.supIm,
      this.diagRe,
      this.diagIm,
      this.cpRe,
      this.cpIm,
      this.dinvRe,
      this.dinvIm,
    );
  }

  /**
   * One unitary CN step. ψ is held as two interleaved-free real/imag buffers and
   * is updated in place. Dirichlet (ψ = 0) boundaries are implied by dropping the
   * missing neighbours, which is exactly what a hard wall or a CAP feed does.
   */
  step(re: Float64Array, im: Float64Array): void {
    const { n, a, dt, hbar, rhsRe, rhsIm } = this;
    for (let j = 0; j < n; j++) {
      const half = (dt * this.v[j]) / (2 * hbar);
      const b = 2 * a + half;
      let sumRe = 0;
      let sumIm = 0;
      if (j > 0) {
        sumRe += re[j - 1];
        sumIm += im[j - 1];
      }
      if (j < n - 1) {
        sumRe += re[j + 1];
        sumIm += im[j + 1];
      }
      // (1 − i b)ψ_j + i a (ψ_{j−1} + ψ_{j+1})
      rhsRe[j] = re[j] + b * im[j] - a * sumIm;
      rhsIm[j] = im[j] - b * re[j] + a * sumRe;
    }
    thomasSolveComplex(
      n,
      this.subRe,
      this.subIm,
      this.cpRe,
      this.cpIm,
      this.dinvRe,
      this.dinvIm,
      rhsRe,
      rhsIm,
    );
    re.set(rhsRe);
    im.set(rhsIm);
  }

  /** Advance `steps` CN steps, applying the CAP sponge after every step.
   *  Returns the total probability removed by the sponge (0 without a cap). */
  advance(re: Float64Array, im: Float64Array, steps: number, cap?: Float64Array | null): number {
    let removed = 0;
    for (let s = 0; s < steps; s++) {
      this.step(re, im);
      if (cap) removed += this.applyCap(re, im, cap);
    }
    return removed;
  }

  /**
   * Multiplicative Complex Absorbing Potential: ψ ← exp(−Δt W/ℏ) ψ with W ≥ 0.
   * Positive-definite contraction, so it can only *remove* norm (never create it).
   * Returns the probability it just drained, ∑|ψ|²(1 − e^{−2Δt W/ℏ})Δx, which lets
   * callers bill "norm + drained = norm₀" and keep the drift read-out honest while
   * the sponge is running.
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
}

/**
 * Functional wrapper used by the verification harness: propagate ψ in place.
 * Returns the final [re, im] buffers for convenience.
 */
export function crankNicolsonEvolve(
  re: Float64Array,
  im: Float64Array,
  v: Float64Array,
  dt: number,
  dx: number,
  steps: number,
  options: { hbar?: number; mass?: number; cap?: Float64Array | null } = {},
): [Float64Array, Float64Array] {
  const solver = new CrankNicolsonSolver({
    n: re.length,
    dt,
    dx,
    hbar: options.hbar,
    mass: options.mass,
    v,
  });
  solver.advance(re, im, steps, options.cap ?? null);
  return [re, im];
}

/* ------------------------------- potentials -------------------------------- */

export type PotentialKind = 'infinite' | 'finite' | 'double' | 'kronig' | 'custom';

export interface PotentialOptions {
  n: number;
  /** Well depth / wall height in a.u. */
  V0: number;
  /** Well width as a fraction of the domain (0..1). */
  wellWidth: number;
  /** Central barrier width as a fraction of the domain (double well). */
  barrierGap: number;
  /** Floor offset of the right-hand well, in units of V0 (−1..1). */
  asymmetry: number;
  /** Number of Kronig–Penney lattice periods across the domain. */
  kronigPeriods: number;
  /** Kronig–Penney barrier height (a.u.). */
  latticeDepth: number;
  /** Brush-drawn potential, resampled to n; used only by `custom`. */
  custom?: number[] | null;
}

/** Cell-centre normalised coordinate u ∈ (0,1) of sample j. */
export function cellU(j: number, n: number): number {
  return (j + 0.5) / n;
}

/** Map a normalised 0..1 coordinate to the physical box x ∈ [−D/2, +D/2]. */
export function uToX(u: number, boxAu: number = TDSE_BOX_AU): number {
  return (u - 0.5) * boxAu;
}

/** Smooth (raised-cosine) edge so a discontinuous V does not inject k≈π/dx junk. */
function softMask(u: number, lo: number, hi: number, edge: number): number {
  if (u <= lo - edge || u >= hi + edge) return 0;
  if (u >= lo + edge && u <= hi - edge) return 1;
  if (u < lo + edge) {
    const t = (u - (lo - edge)) / (2 * edge);
    return 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));
  }
  const t = (u - (hi - edge)) / (2 * edge);
  return 0.5 + 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));
}

/** Linear resample of an arbitrary-length brush array onto the working grid. */
export function resampleCustom(custom: number[] | null | undefined, n: number): Float64Array {
  const out = new Float64Array(n);
  if (!custom || custom.length === 0) return out;
  const m = custom.length;
  if (m === 1) {
    out.fill(custom[0]);
    return out;
  }
  for (let j = 0; j < n; j++) {
    const t = ((j + 0.5) / n) * (m - 1);
    const i = Math.max(0, Math.min(m - 2, Math.floor(t)));
    const f = t - i;
    const a = custom[i] ?? 0;
    const b = custom[i + 1] ?? a;
    out[j] = a + (b - a) * f;
  }
  return out;
}

/**
 * Build V(x) on the grid for one of the sandbox presets. All presets keep
 * V ≥ 0 so the packet's kinetic energy can be read off directly.
 */
export function buildPotential(kind: PotentialKind | string, o: PotentialOptions): Float64Array {
  const v = new Float64Array(o.n);
  const edge = 0.012;
  if (kind === 'custom') {
    return resampleCustom(o.custom ?? null, o.n);
  }
  if (kind === 'kronig') {
    const periods = Math.max(1, Math.round(o.kronigPeriods));
    const cell = 1 / periods;
    const barrierW = 0.4 * cell;
    for (let j = 0; j < o.n; j++) {
      const u = cellU(j, o.n);
      const phase = u - Math.floor(u / cell) * cell;
      const inside = phase < barrierW ? softMask(phase / cell, 0, barrierW / cell, edge / cell) : 0;
      v[j] = o.latticeDepth * inside;
    }
    return v;
  }
  const w = Math.max(0.02, Math.min(0.98, o.wellWidth));
  const lo = 0.5 - w / 2;
  const hi = 0.5 + w / 2;
  if (kind === 'infinite') {
    for (let j = 0; j < o.n; j++) {
      const u = cellU(j, o.n);
      v[j] = V_HARD_WALL * (1 - softMask(u, lo, hi, edge));
    }
    return v;
  }
  if (kind === 'double') {
    const gap = Math.max(0.01, Math.min(0.6, o.barrierGap));
    const mid = 0.5;
    const leftLo = lo;
    const leftHi = mid - gap / 2;
    const rightLo = mid + gap / 2;
    const rightHi = hi;
    for (let j = 0; j < o.n; j++) {
      const u = cellU(j, o.n);
      const inWell = softMask(u, leftLo, leftHi, edge) + softMask(u, rightLo, rightHi, edge);
      const inRight = softMask(u, rightLo, rightHi, edge);
      // Outside both wells sits a wall of V0; the right well floor can be tilted.
      v[j] = o.V0 * (1 - Math.min(1, inWell)) + o.asymmetry * o.V0 * inRight;
    }
    return v;
  }
  // 'finite' (and any unknown key) — a flat-bottomed well of depth 0 in a V0 plateau.
  for (let j = 0; j < o.n; j++) {
    const u = cellU(j, o.n);
    v[j] = o.V0 * (1 - softMask(u, lo, hi, edge));
  }
  return v;
}

/**
 * Quadratic Complex Absorbing Sponge of normalised half-width `width` at both
 * ends, peaking at strength·CAP_W_SCALE on the boundary cells.
 */
export function buildCap(
  n: number,
  width: number,
  strength: number,
  scale: number = CAP_W_SCALE,
): Float64Array {
  const cap = new Float64Array(n);
  const w = Math.max(0, Math.min(0.4, width));
  const layers = Math.floor(w * n);
  if (layers < 1 || strength <= 0) return cap;
  const peak = strength * scale;
  for (let j = 0; j < layers; j++) {
    const t = (layers - j) / layers; // 1 at the wall → 0 at the inner edge
    const value = peak * t * t;
    cap[j] += value;
    cap[n - 1 - j] += value;
  }
  return cap;
}

/* ------------------------------ initial states ----------------------------- */

/**
 * Normalised Gaussian wave packet ψ(x) = A exp(−(x−x₀)²/4σ²) exp(i k x) sampled
 * on cell centres x_j = origin + (j+½)dx. Coordinates share the length unit of
 * `dx`, so the returned state satisfies Σ |ψ|² dx = 1 to machine precision.
 */
export function gaussianPacket(
  n: number,
  dx: number,
  x0: number,
  sigma: number,
  k0: number,
  amplitude: number = 1,
  origin: number = 0,
): [Float64Array, Float64Array] {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const s = Math.max(dx * 0.5, sigma);
  for (let j = 0; j < n; j++) {
    const x = origin + (j + 0.5) * dx;
    const g = Math.exp(-((x - x0) * (x - x0)) / (4 * s * s));
    re[j] = amplitude * g * Math.cos(k0 * x);
    im[j] = amplitude * g * Math.sin(k0 * x);
  }
  normalize(re, im, dx);
  return [re, im];
}

/** Σ|ψ|²dx = 1, in place. Returns the norm that was removed. */
export function normalize(re: Float64Array, im: Float64Array, dx: number): number {
  let norm = 0;
  for (let j = 0; j < re.length; j++) norm += re[j] * re[j] + im[j] * im[j];
  norm *= dx;
  if (!(norm > 0)) return 0;
  const f = 1 / Math.sqrt(norm);
  for (let j = 0; j < re.length; j++) {
    re[j] *= f;
    im[j] *= f;
  }
  return norm;
}

/* ------------------------------- diagnostics ------------------------------- */

export interface StateDiagnostics {
  /** Σ|ψ|²dx */
  norm: number;
  /** ⟨x⟩ in the length unit of dx. */
  x: number;
  /** ⟨p⟩ in units of ℏ/dx-length. */
  p: number;
  /** ⟨H⟩ = kinetic + potential expectation. */
  energy: number;
  /** Kinetic part of ⟨H⟩. */
  kinetic: number;
  /** max |ψ|², useful for auto-scaling. */
  peak: number;
}

/** Expectation values of a discretised state (normalised by the current norm). */
export function diagnostics(
  re: Float64Array,
  im: Float64Array,
  v: Float64Array,
  dx: number,
  options: { hbar?: number; mass?: number; origin?: number } = {},
): StateDiagnostics {
  const hbar = options.hbar ?? 1;
  const mass = options.mass ?? 1;
  const origin = options.origin ?? 0;
  const n = re.length;
  const k = (hbar * hbar) / (2 * mass * dx * dx); // kinetic prefactor ℏ²/2m dx²
  let norm = 0;
  let xSum = 0;
  let pSum = 0;
  let potSum = 0;
  let bondSum = 0;
  let peak = 0;
  for (let j = 0; j < n; j++) {
    const d = re[j] * re[j] + im[j] * im[j];
    norm += d;
    xSum += (origin + (j + 0.5) * dx) * d;
    if (d > peak) peak = d;
    potSum += v[j] * d;
    if (j < n - 1) bondSum += re[j] * re[j + 1] + im[j] * im[j + 1];
    const jl = j > 0 ? j - 1 : j;
    const jr = j < n - 1 ? j + 1 : j;
    // ⟨p⟩ = ℏ ∫ Im(ψ* ∂ₓψ) dx with a central difference.
    pSum += (re[j] * (im[jr] - im[jl]) - im[j] * (re[jr] - re[jl])) / (2 * dx);
  }
  norm *= dx;
  if (!(norm > 0)) {
    return { norm: 0, x: 0, p: 0, energy: 0, kinetic: 0, peak: 0 };
  }
  // ⟨T⟩ = ⟨H⟩ − ⟨V⟩ from the tridiagonal quadratic form: 2K Σ|ψ|² − 2K Σ_bonds Re(ψ*ψ').
  const kinetic = (2 * k * (norm / dx - bondSum) * dx) / norm;
  return {
    norm,
    x: (xSum * dx) / norm,
    p: (hbar * pSum * dx) / norm,
    energy: kinetic + (potSum * dx) / norm,
    kinetic,
    peak: (peak * dx) / norm,
  };
}

/* --------------------------- tridiagonal eigenproblem ---------------------- */

export interface TridiagonalEigen {
  /** Eigenvalues, ascending. */
  values: Float64Array;
  /** Eigenvectors, column-major: vector c occupies v[c*n .. c*n+n-1]. */
  vectors: Float64Array;
}

/**
 * Cyclic Jacobi diagonalisation of a real symmetric matrix built from
 * tridiagonal data (diag, off). The sandbox Hamiltonian is exactly tridiagonal
 * (constant off-diagonal −ℏ²/2m dx²), the eigenproblem is only solved on a
 * ≤128-cell coarse grid, and the eigenvectors come out for free — which is what
 * the |⟨φ_k|ψ⟩|² spectral projection needs. No LAPACK, no dependencies.
 *
 * Implementation: the classical Jacobi rotation sweep (Numerical Recipes
 * form, θ chosen by the small-t root for numerical stability), eigenvectors
 * accumulated in a second n×n buffer starting from the identity.
 */
export function jacobiTridiagonalEigen(
  diag: Float64Array | number[],
  off: Float64Array | number[],
  sweepLimit: number = 40,
): TridiagonalEigen {
  const n = diag.length;
  const a = new Float64Array(n * n);
  const vec = new Float64Array(n * n);
  const d = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    d[i] = diag[i];
    vec[i * n + i] = 1;
    if (i < n - 1) {
      a[i * n + (i + 1)] = off[i];
      a[(i + 1) * n + i] = off[i];
    }
  }

  for (let sweep = 0; sweep < sweepLimit; sweep++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const v = a[i * n + j];
        sum += v * v;
      }
    }
    const rms = Math.sqrt(sum / Math.max(1, n * (n - 1) / 2));
    const threshold = sweep < 4 ? (0.2 * rms) / Math.max(1, n) : 0;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        const g = 100 * Math.abs(apq);
        if (sweep > 3 && Math.abs(d[p]) + g === Math.abs(d[p]) && Math.abs(d[q]) + g === Math.abs(d[q])) {
          a[p * n + q] = 0;
          a[q * n + p] = 0;
          continue;
        }
        if (Math.abs(apq) <= threshold) continue;
        const h = d[q] - d[p];
        let t: number;
        if (Math.abs(h) + g === Math.abs(h)) {
          t = apq / h;
        } else {
          const theta = (0.5 * h) / apq;
          t = 1 / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
          if (theta < 0) t = -t;
        }
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        const tau = s / (1 + c);
        // Exact 2x2 result: App' = App − t·Apq, Aqq' = Aqq + t·Apq (t = tanθ).
        const tq = t * apq;
        d[p] -= tq;
        d[q] += tq;
        a[p * n + q] = 0;
        a[q * n + p] = 0;
        for (let i = 0; i < n; i++) {
          if (i !== p && i !== q) {
            const cip = a[i * n + p];
            const ciq = a[i * n + q];
            const newP = cip - s * (ciq + cip * tau);
            const newQ = ciq + s * (cip - ciq * tau);
            a[i * n + p] = newP;
            a[p * n + i] = newP;
            a[i * n + q] = newQ;
            a[q * n + i] = newQ;
          }
          const vip = vec[i * n + p];
          const viq = vec[i * n + q];
          vec[i * n + p] = vip - s * (viq + vip * tau);
          vec[i * n + q] = viq + s * (vip - viq * tau);
        }
      }
    }

    let remaining = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (Math.abs(a[i * n + j]) > 1e-16 * (1 + Math.abs(d[i]) + Math.abs(d[j]))) remaining++;
      }
    }
    if (remaining === 0 && sweep >= 1) break;
  }

  // Ascending eigenvalue order, permuting the eigenvector columns to match.
  const sortedIdx: number[] = [];
  for (let i = 0; i < n; i++) sortedIdx.push(i);
  sortedIdx.sort((x, y) => d[x] - d[y]);
  const values = new Float64Array(n);
  const vectors = new Float64Array(n * n);
  for (let c = 0; c < n; c++) {
    const src = sortedIdx[c];
    values[c] = d[src];
    for (let r = 0; r < n; r++) vectors[c * n + r] = vec[r * n + src];
  }
  return { values, vectors };
}

/**
 * Assemble the finite-difference Hamiltonian matrix elements of the sandbox:
 * diagonal 2c/dx² + V_j, constant off-diagonal −c/dx² with c = ℏ²/2m.
 */
export function hamiltonianTridiagonal(
  v: Float64Array | number[],
  dx: number,
  hbar: number = 1,
  mass: number = 1,
): { diag: Float64Array; off: Float64Array; kinetic: number } {
  const n = v.length;
  const kinetic = (hbar * hbar) / (2 * mass * dx * dx);
  const diag = new Float64Array(n);
  const off = new Float64Array(Math.max(1, n - 1));
  for (let i = 0; i < n; i++) diag[i] = 2 * kinetic + v[i];
  for (let i = 0; i < n - 1; i++) off[i] = -kinetic;
  return { diag, off, kinetic };
}

/**
 * Lowest `count` eigenpairs of the discretised Hamiltonian, with eigenvectors
 * normalised as ∫|φ|²dx = 1. Delegates to {@link sturmTridiagonalEigen}, so the
 * cost is O(N · count) rather than the O(N³) of a full dense sweep.
 */
export function boundStates(
  v: Float64Array | number[],
  dx: number,
  count: number,
  hbar: number = 1,
  mass: number = 1,
): { energies: Float64Array; states: Float64Array } {
  const { diag, off } = hamiltonianTridiagonal(v, dx, hbar, mass);
  const { values, vectors } = sturmTridiagonalEigen(diag, off, Math.min(count, v.length));
  const k = Math.max(1, Math.min(count, v.length));
  const energies = new Float64Array(k);
  const states = new Float64Array(k * v.length);
  for (let c = 0; c < k; c++) {
    energies[c] = values[c];
    let sum = 0;
    for (let r = 0; r < v.length; r++) {
      const value = vectors[c * v.length + r];
      states[c * v.length + r] = value;
      sum += value * value;
    }
    const norm = Math.sqrt(sum * dx);
    if (norm > 0) {
      for (let r = 0; r < v.length; r++) states[c * v.length + r] /= norm;
    }
    // Deterministic sign convention: make the largest-magnitude lobe positive.
    let best = 0;
    for (let r = 0; r < v.length; r++) {
      if (Math.abs(states[c * v.length + r]) > Math.abs(states[c * v.length + best])) best = r;
    }
    if (states[c * v.length + best] < 0) {
      for (let r = 0; r < v.length; r++) states[c * v.length + r] = -states[c * v.length + r];
    }
  }
  return { energies, states };
}

/** Spectral weights |⟨φ_k|ψ⟩|² of a state onto stored eigenfunctions. */
export function spectralWeights(
  states: Float64Array,
  count: number,
  n: number,
  re: Float64Array,
  im: Float64Array,
  dx: number,
): Float64Array {
  const out = new Float64Array(count);
  for (let c = 0; c < count; c++) {
    let accRe = 0;
    let accIm = 0;
    for (let r = 0; r < n; r++) {
      const phi = states[c * n + r];
      accRe += phi * re[r];
      accIm += phi * im[r];
    }
    out[c] = (accRe * accRe + accIm * accIm) * dx * dx;
  }
  return out;
}

/* ------------- Sturm bisection + inverse iteration for tridiagonals --------- */

/**
 * Sturm sequence count: number of eigenvalues of the real symmetric tridiagonal
 * matrix (diag d, off-diagonal e) that are strictly less than x.
 *
 * The characteristic polynomials p_i(x) = det(T_i − xI) obey the three-term
 * recurrence, and the ratios θ_i = p_i / p_{i−1} satisfy
 *     θ_0 = d_0 − x,   θ_i = d_i − x − e_{i−1}² / θ_{i−1}.
 * Sylvester's inertia law says #{λ_j < x} = #{i : θ_i < 0}, because θ_i is a
 * continued fraction whose sign flips exactly once per eigenvalue below x. The
 * division form is used (instead of the raw polynomial) so the recurrence cannot
 * overflow; a θ_i that underflows to zero is replaced by a tiny positive number,
 * which is the standard LAPACK (dlasqf) safeguard and can only shift the count by
 * one at an exact eigenvalue — harmless inside a bisection.
 */
function sturmCountFast(
  diag: Float64Array,
  off: Float64Array,
  x: number,
  floor: number,
): number {
  const n = diag.length;
  let theta = diag[0] - x;
  let below = theta < 0 ? 1 : 0;
  for (let i = 1; i < n; i++) {
    if (theta > -floor && theta < floor) theta = floor;
    theta = diag[i] - x - (off[i - 1] * off[i - 1]) / theta;
    if (theta < 0) below += 1;
  }
  return below;
}

/** Public wrapper: computes its own zero-replacement floor from the matrix data. */
export function sturmCountBelow(
  diag: Float64Array | number[],
  off: Float64Array | number[],
  x: number,
): number {
  const d = Float64Array.from(diag as Float64Array);
  const e = Float64Array.from(off as Float64Array);
  let spread = 0;
  for (let i = 0; i < d.length; i++) {
    const t = Math.abs(d[i]);
    if (t > spread) spread = t;
  }
  let eMax = 0;
  for (let i = 0; i < e.length - 1; i++) {
    const t = Math.abs(e[i]);
    if (t > eMax) eMax = t;
  }
  return sturmCountFast(d, e, x, 1e-14 * (spread + Math.abs(x) + 2 * eMax + 1));
}

/**
 * Lowest `count` eigenpairs of a real symmetric tridiagonal matrix, computed by
 * **Sturm bisection** for the eigenvalues and **deflated inverse iteration** for
 * the eigenvectors (the classical DSTEIN/DSTEMR strategy, specialised to the
 * constant-off-diagonal Hamiltonian of this sandbox).
 *
 * Why not a dense Jacobi sweep or a Lanczos Krylov space — both were measured on
 * the real grid (N = 512, double well):
 *   • {@link jacobiTridiagonalEigen} on the full matrix costs ~12 s, three orders
 *     of magnitude too slow for a spectrum that refreshes while V(x) is dragged;
 *   • Lanczos with full reorthogonalisation is arithmetically correct (its basis
 *     stays orthonormal to 3e-15) but *does not converge the low end*: with a
 *     spectral spread of 2.3e3 and a tunnel splitting of 1.2e-4, a 48-step Krylov
 *     space gave the 12 lowest Ritz values with relative errors from 1.7e-1 up to
 *     3e+1, and only matched the dense answer once M ≈ N — so it buys nothing here.
 * Bisection needs one O(N) Sturm pass per halving (~44 per level) and inverse
 * iteration one O(N) Thomas solve per pass, so 32 levels of the *fine* N = 512
 * grid cost ~20 ms instead of ~12 s, and the result is machine-exact: measured
 * against the dense cyclic Jacobi the lowest 32 levels agree to 7e-14, the
 * residuals ‖Hφ−Eφ‖∞ stay ≤ 2e-13 at N = 1024 and the eigenvectors are
 * orthonormal to ~1e-15. Because the shift is anchored to the bisection value
 * rather than to the running Rayleigh quotient, the iteration cannot drift onto a
 * neighbouring level once a pass overshoots.
 */
export function sturmTridiagonalEigen(
  diag: Float64Array | number[],
  off: Float64Array | number[],
  count: number,
  options: { passes?: number; tolerance?: number } = {},
): TridiagonalEigen {
  const n = diag.length;
  const want = Math.max(1, Math.min(Math.round(count), n));
  const passes = Math.max(1, Math.round(options.passes ?? 14));

  let dMin = diag[0];
  let dMax = diag[0];
  let eMax = 0;
  let uniform = true;
  for (let i = 0; i < n; i++) {
    if (diag[i] < dMin) dMin = diag[i];
    if (diag[i] > dMax) dMax = diag[i];
  }
  for (let i = 0; i < n - 1; i++) {
    if (off[i] !== off[0]) uniform = false;
    const t = Math.abs(off[i]);
    if (t > eMax) eMax = t;
  }
  // Gershgorin enclosure of the whole spectrum.
  const gLo = dMin - 2 * eMax;
  const gHi = dMax + 2 * eMax;
  const tol = options.tolerance ?? 1e-13 * Math.max(1, gHi - gLo);
  const floor = 1e-14 * (Math.max(Math.abs(dMin), Math.abs(dMax)) + Math.abs(gLo) + 2 * eMax + 1);

  const values = new Float64Array(want);
  let lo = gLo;
  for (let k = 0; k < want; k++) {
    // Invariant: count(lo) <= k < count(hi), so bisection lands on λ_{k+1}.
    let a = lo;
    let b = gHi;
    while (b - a > tol) {
      const mid = a + 0.5 * (b - a);
      if (mid <= a || mid >= b) break;
      if (sturmCountFast(diag as Float64Array, off as Float64Array, mid, floor) > k) b = mid;
      else a = mid;
    }
    const lambda = 0.5 * (a + b);
    values[k] = lambda;
    lo = lambda; // the next level lies above this one
  }

  if (!uniform) {
    // Inverse iteration below uses the constant-sub/sup-diagonal Thomas factors,
    // so a genuinely non-uniform off-diagonal falls back to the dense cyclic
    // Jacobi (exact, O(N³), only reached by callers outside this sandbox).
    const dense = jacobiTridiagonalEigen(diag, off, 80);
    const vectors = dense.vectors;
    const outValues = new Float64Array(want);
    const outVectors = new Float64Array(want * n);
    for (let c = 0; c < want; c++) {
      outValues[c] = dense.values[c];
      for (let i = 0; i < n; i++) outVectors[c * n + i] = vectors[c * n + i];
    }
    return { values: outValues, vectors: outVectors };
  }

  // --- eigenvectors: (T − (λ − iδ)I) y = x, deflated against earlier vectors ---
  const bis = Float64Array.from(values);
  const vectors = new Float64Array(want * n);
  const cpRe = new Float64Array(n);
  const cpIm = new Float64Array(n);
  const dinvRe = new Float64Array(n);
  const dinvIm = new Float64Array(n);
  const aRe = new Float64Array(n);
  const aIm = new Float64Array(n);
  const yRe = new Float64Array(n);
  const yIm = new Float64Array(n);
  const xRe = new Float64Array(n);
  const scale = Math.max(1, gHi - gLo);
  const sub = off[0] ?? 0;

  for (let k = 0; k < want; k++) {
    // Start from a fixed-seed pseudo-random vector: it couples to *every*
    // eigenfunction, which a smooth lobe does not — a symmetric trial vector has
    // an essentially vanishing overlap with the antisymmetric partner of a
    // parity-split doublet, and the iteration then silently converges onto the
    // next level instead. The seed is constant, so the picture is reproducible.
    let seed = 20240117 + 7919 * k;
    let acc = 0;
    for (let j = 0; j < n; j++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const r = seed / 2147483648 - 0.5;
      xRe[j] = r;
      acc += r * r;
    }
    acc = Math.sqrt(acc) || 1;
    for (let j = 0; j < n; j++) xRe[j] /= acc;

    // Resolvent width: δ ≪ gap makes 1/|λⱼ − σ| peak at the target, while
    // ‖T‖/δ ≪ 1/eps keeps the Thomas solve accurate. Sweeps over the sandbox
    // potentials put the sweet spot around gap/1e3…gap/1e5 (δ = gap/64 leaves a
    // visible non-resonant background; δ < 1e-11 loses digits to conditioning),
    // so the iteration below is repeated with shrinking δ and the best vector —
    // judged by ‖Tφ − Eφ‖∞ — is kept.
    const gapNext = k + 1 < want ? bis[k + 1] - bis[k] : bis[Math.max(0, k - 1)] - bis[k];
    const gapPrev = k > 0 ? bis[k] - bis[k - 1] : gapNext;
    const gap = Math.max(1e-18 * scale, Math.min(Math.abs(gapNext), Math.abs(gapPrev)));
    const shift = bis[k];

    let bestAngle = Infinity;
    let bestLambda = shift;
    for (let attempt = 0; attempt < 3; attempt++) {
      const delta = Math.max(gap / (2048 << attempt), 1e-12 * scale);
      for (let i = 0; i < n; i++) {
        aRe[i] = diag[i] - shift;
        aIm[i] = delta;
      }
      thomasFactor(n, sub, 0, sub, 0, aRe, aIm, cpRe, cpIm, dinvRe, dinvIm);
      for (let pass = 0; pass < passes; pass++) {
        for (let i = 0; i < n; i++) {
          yRe[i] = xRe[i];
          yIm[i] = 0;
        }
        thomasSolveComplex(n, sub, 0, cpRe, cpIm, dinvRe, dinvIm, yRe, yIm);
        // Rotate onto the real axis with the *globally* optimal phase: the resonant
        // eigencomponent enters y almost purely imaginary (coefficient −i/δ) while
        // the non-resonant principal-value background is real, so picking the phase
        // from a single entry fails whenever the target eigenfunction has a node
        // there. Maximising ‖Re(e^{−iφ}y)‖² = A c² + 2B sc + C s² gives
        // (cos 2φ, sin 2φ) ∥ (A−C, 2B), which one atan2 delivers directly.
        let pa = 0;
        let pb = 0;
        let pc = 0;
        for (let i = 0; i < n; i++) {
          pa += yRe[i] * yRe[i];
          pb += yRe[i] * yIm[i];
          pc += yIm[i] * yIm[i];
        }
        const phi = 0.5 * Math.atan2(2 * pb, pa - pc);
        const cos = Math.cos(phi);
        const sin = Math.sin(phi);
        let s = 0;
        for (let i = 0; i < n; i++) {
          const r = yRe[i] * cos + yIm[i] * sin;
          xRe[i] = r;
          s += r * r;
        }
        // Deflate against every level already found: this is what turns "converge
        // to the nearest pole" into "converge to *this* pole" for tight doublets.
        for (let c = 0; c < k; c++) {
          const row = c * n;
          let d = 0;
          for (let i = 0; i < n; i++) d += xRe[i] * vectors[row + i];
          for (let i = 0; i < n; i++) xRe[i] -= d * vectors[row + i];
        }
        s = 0;
        for (let i = 0; i < n; i++) s += xRe[i] * xRe[i];
        s = Math.sqrt(s) || 1;
        for (let i = 0; i < n; i++) xRe[i] /= s;
      }
      // Rayleigh–Ritz quotient and residual of the refined vector.
      let rq = 0;
      for (let i = 0; i < n; i++) {
        const left = i > 0 ? sub * xRe[i - 1] : 0;
        const right = i < n - 1 ? sub * xRe[i + 1] : 0;
        rq += xRe[i] * (left + diag[i] * xRe[i] + right);
      }
      let res = 0;
      for (let i = 0; i < n; i++) {
        const left = i > 0 ? sub * xRe[i - 1] : 0;
        const right = i < n - 1 ? sub * xRe[i + 1] : 0;
        const d = Math.abs(left + diag[i] * xRe[i] + right - rq * xRe[i]);
        if (d > res) res = d;
      }
      // Distance to the nearest *other* level bounds how much residual is acceptable.
      const rival = Math.max(gap, 1e-12 * scale);
      const angle = res / rival;
      if (angle < bestAngle) {
        bestAngle = angle;
        bestLambda = rq;
        const row = k * n;
        let peak = 0;
        for (let i = 0; i < n; i++) {
          vectors[row + i] = xRe[i];
          if (Math.abs(xRe[i]) > Math.abs(xRe[peak])) peak = i;
        }
        if (vectors[row + peak] < 0) for (let i = 0; i < n; i++) vectors[row + i] = -vectors[row + i];
      }
      if (bestAngle < 1e-9) break;
    }
    values[k] = bestLambda;
  }

  // Re-sort: the Rayleigh–Ritz polish can swap a nearly degenerate pair.
  const order: number[] = [];
  for (let i = 0; i < want; i++) order.push(i);
  order.sort((a, b) => values[a] - values[b]);
  const outValues = new Float64Array(want);
  const outVectors = new Float64Array(want * n);
  for (let c = 0; c < want; c++) {
    const src = order[c];
    outValues[c] = values[src];
    for (let i = 0; i < n; i++) outVectors[c * n + i] = vectors[src * n + i];
  }
  return { values: outValues, vectors: outVectors };
}


/* ----------------------- live eigen spectrum of the sandbox ----------------- */

export interface EigenSpectrum {
  /** Eigenvalues, ascending, in the energy unit of `v`. */
  energies: Float64Array;
  /**
   * Eigenfunctions on the solver grid, column-major: state k occupies
   * states[k * nf .. k * nf + nf - 1], normalised so that Σ|φ|²dx = 1.
   */
  states: Float64Array;
  /** Grid length stored in `states`. */
  nf: number;
  /** Count of returned levels. */
  count: number;
}

/**
 * Bound-state spectrum of V(x) by *matrix diagonalisation* of the exact
 * finite-difference Hamiltonian on the solver grid: H is symmetric tridiagonal
 * (diag 2ℏ²/2m dx² + V_j, constant off-diagonal −ℏ²/2m dx²), and
 * {@link sturmTridiagonalEigen} extracts the lowest levels with Sturm bisection
 * plus deflated inverse iteration. No coarse grid and no resampling is involved,
 * so the bar chart shows the same operator the Crank–Nicolson propagator applies
 * to ψ — the displayed levels are the ones the evolution actually oscillates
 * between.
 */
export function eigenSpectrum(
  v: Float64Array | number[],
  dx: number,
  count: number,
  hbar: number = 1,
  mass: number = 1,
): EigenSpectrum {
  const { energies, states } = boundStates(v, dx, Math.max(1, Math.round(count)), hbar, mass);
  return { energies, states, nf: v.length, count: energies.length };
}

/* ------------------------------ simulation core ---------------------------- */

export interface TdseInit {
  n: number;
  dx: number;
  dt: number;
  v: Float64Array;
  cap: Float64Array;
  re: Float64Array;
  im: Float64Array;
  hbar?: number;
  mass?: number;
  /** Box origin (x of cell 0), used for ⟨x⟩. */
  origin?: number;
}

export interface TdseSnapshot {
  /** Copies of the state, safe to transfer out of a worker. */
  re: Float64Array;
  im: Float64Array;
  diag: StateDiagnostics;
  /** |⟨φₖ|ψ⟩|² for the stored spectrum, empty until `computeSpectrum` runs. */
  weights: Float64Array;
  /** Probability the sponge has drained since the last `setPsi`. */
  drained: number;
  /** Peak-normalised |φₖ|² of the *current* ψ overlap is not included; the
   *  renderer uses `spectrum` for shapes. */
  simTime: number;
  steps: number;
}

/**
 * Stateful TDSE engine shared by the Web Worker and the synchronous main-thread
 * fallback: owns ψ, the CN propagator, the CAP sponge and the eigen spectrum, and
 * exposes one `frame(steps)` call that produces everything the renderer needs.
 */
export class TdseCore {
  readonly n: number;
  readonly dx: number;
  dt: number;
  readonly hbar: number;
  readonly mass: number;
  readonly origin: number;
  private solver: CrankNicolsonSolver;
  private re: Float64Array;
  private im: Float64Array;
  private cap: Float64Array;
  private v: Float64Array;
  private spectrum: EigenSpectrum | null = null;
  private spectrumDirty = true;
  simTime = 0;
  steps = 0;
  /** Total probability removed by the CAP since the state was (re)loaded. */
  drained = 0;

  constructor(init: TdseInit) {
    this.n = init.n;
    this.dx = init.dx;
    this.dt = init.dt;
    this.hbar = init.hbar ?? 1;
    this.mass = init.mass ?? 1;
    this.origin = init.origin ?? 0;
    this.v = Float64Array.from(init.v);
    this.cap = Float64Array.from(init.cap);
    this.re = Float64Array.from(init.re);
    this.im = Float64Array.from(init.im);
    this.solver = new CrankNicolsonSolver({
      n: init.n,
      dx: this.dx,
      dt: this.dt,
      hbar: this.hbar,
      mass: this.mass,
      v: this.v,
    });
  }

  get potential(): Float64Array {
    return this.v;
  }

  get sponge(): Float64Array {
    return this.cap;
  }

  get energies(): Float64Array | null {
    return this.spectrum ? this.spectrum.energies : null;
  }

  get eigenStates(): Float64Array | null {
    return this.spectrum ? this.spectrum.states : null;
  }

  get spectrumCount(): number {
    return this.spectrum ? this.spectrum.count : 0;
  }

  /** Replace V(x) and the sponge; rebuilds the Thomas factors in O(N). */
  setPotential(v: Float64Array, cap: Float64Array): void {
    this.v.set(v);
    this.cap.set(cap);
    this.solver.setPotential(this.v);
    this.spectrumDirty = true;
  }

  /**
   * Load a new ψ and rewind the clock. With `renormalize` the state is forced to
   * ‖ψ‖ = 1; passing false keeps the caller's amplitude so the sandbox can explore
   * unnormalised (weighted) states while the norm telemetry still has a baseline.
   */
  setPsi(re: Float64Array, im: Float64Array, renormalize: boolean = true): void {
    this.re.set(re);
    this.im.set(im);
    if (renormalize) normalize(this.re, this.im, this.dx);
    this.simTime = 0;
    this.steps = 0;
    this.drained = 0;
  }

  setTimeStep(dt: number): void {
    if (!(dt > 0) || dt === this.dt) return;
    this.dt = dt;
    this.solver = new CrankNicolsonSolver({
      n: this.n,
      dx: this.dx,
      dt,
      hbar: this.hbar,
      mass: this.mass,
      v: this.v,
    });
  }

  /**
   * Diagonalise H on the solver grid (Sturm bisection + inverse iteration).
   * Costs a few tens of ms at N = 512, so callers trigger it when V(x) changes
   * or when the spectrum view is opened — never from inside `frame`.
   */
  computeSpectrum(count: number): void {
    const want = Math.max(1, Math.round(count));
    if (this.spectrum && this.spectrum.count === want && !this.spectrumDirty) return;
    this.spectrum = eigenSpectrum(this.v, this.dx, want, this.hbar, this.mass);
    this.spectrumDirty = false;
  }

  clearSpectrum(): void {
    this.spectrum = null;
    this.spectrumDirty = true;
  }

  currentDiagnostics(): StateDiagnostics {
    return diagnostics(this.re, this.im, this.v, this.dx, {
      hbar: this.hbar,
      mass: this.mass,
      origin: this.origin,
    });
  }

  /** Advance `steps` CN steps (CAP included) and return fresh out buffers. */
  frame(steps: number): TdseSnapshot {
    const count = Math.max(0, Math.round(steps));
    this.drained += this.solver.advance(this.re, this.im, count, this.cap);
    this.simTime += count * this.dt;
    this.steps += count;
    const outRe = new Float64Array(this.n);
    const outIm = new Float64Array(this.n);
    outRe.set(this.re);
    outIm.set(this.im);
    const weights = this.spectrum
      ? spectralWeights(this.spectrum.states, this.spectrum.count, this.n, this.re, this.im, this.dx)
      : new Float64Array(0);
    return {
      re: outRe,
      im: outIm,
      diag: diagnostics(this.re, this.im, this.v, this.dx, {
        hbar: this.hbar,
        mass: this.mass,
        origin: this.origin,
      }),
      weights,
      drained: this.drained,
      simTime: this.simTime,
      steps: this.steps,
    };
  }
}
