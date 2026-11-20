/**
 * dipole.ts — electric-dipole matrix elements ⟨n′ℓ′m′| ẑ |nℓm⟩ for hydrogen.
 *
 *   d_fi = ⟨f| z |i⟩ = ∫₀^∞ R_{n′ℓ′} R_{nℓ} r³ dr  ×  ∫ Y_{ℓ′}^{m′*} cosϑ Y_ℓ^m dΩ
 *
 * The angular factor is evaluated twice — once from the closed-form
 * 3j/recursion result (which *is* the selection rule) and once by brute-force
 * quadrature of the Ylm integral using `Ylm` from the shared hydrogen engine.
 * The two must agree, and both must vanish for Δℓ ≠ ±1 or Δm ≠ 0, which is how
 * the simulation *demonstrates* the E1 selection rules instead of asserting them.
 *
 * Units: lengths in Bohr radii a₀, so d comes out in e·a₀ with the electron
 * charge factored out (atomic units, e = 1).
 */

import {
  assocLegendre,
  radialWavefunction,
  sphericalHarmonicNorm,
} from '@/engine/physics/hydrogen';
import type { Complex } from '@/engine/physics/constants';

/**
 * Correct complex spherical harmonic Y_ℓ^m.
 *
 * `Ylm` in engine/physics/hydrogen.ts builds m < 0 as (−1)^|m| conj(Y^{|m|}) but
 * keeps the *positive* exponent in φ (it flips the sign of the whole value rather
 * than the phase), so Y_ℓ^{−m} winds the wrong way there. Nothing else in the
 * shared engine notices because densities are |Y|²-invariant; a selection-rule
 * demo where Δm = ±1 must vanish cannot, so the quadrature below uses this local
 * version. Positive m reproduces the shared function exactly.
 */
export function yLm(l: number, m: number, theta: number, phi: number): Complex {
  const mu = Math.abs(m);
  const norm = sphericalHarmonicNorm(l, mu);
  const P = assocLegendre(l, mu, Math.cos(theta));
  const s = m < 0 && mu % 2 === 1 ? -1 : 1;
  const a = s * norm * P;
  const ang = m * phi;
  return { re: a * Math.cos(ang), im: a * Math.sin(ang) };
}

export interface AngularElement {
  /** Closed-form ⟨ℓ′m′|cosϑ|ℓm⟩ from the ℓ ladder (exact, includes the sign). */
  closed: number;
  /** Same integral by 24-point Gauss–Legendre × 32-point trapezoid quadrature. */
  numeric: number;
  /** |numeric − closed| — the internal consistency check. */
  error: number;
  deltaL: number;
  deltaM: number;
  /** ℓ′ = ℓ ± 1 and m′ = m (the ẑ / π-polarised E1 rule). */
  angularAllowed: boolean;
}

/**
 * Closed-form angular factor for z = r cosϑ (π polarisation):
 *
 *   ⟨ℓ+1,m|cosϑ|ℓ,m⟩ = √[((ℓ+m+1)(ℓ−m+1)) / ((2ℓ+3)(2ℓ+1))]
 *   ⟨ℓ−1,m|cosϑ|ℓ,m⟩ = √[((ℓ+m)(ℓ−m))   / ((2ℓ−1)(2ℓ+1))]
 *   everything else   = 0
 */
export function angularZClosed(l1: number, m1: number, l2: number, m2: number): number {
  if (m1 !== m2) return 0;
  if (l2 === l1 + 1) {
    const num = (l1 + m1 + 1) * (l1 - m1 + 1);
    if (num <= 0) return 0;
    return Math.sqrt(num / ((2 * l1 + 3) * (2 * l1 + 1)));
  }
  if (l2 === l1 - 1) {
    const num = (l1 + m1) * (l1 - m1);
    if (num <= 0) return 0;
    return Math.sqrt(num / ((2 * l1 - 1) * (2 * l1 + 1)));
  }
  return 0;
}

/* Gauss–Legendre nodes/weights on [−1,1] for n = 24 (fixed, computed once). */
const GL_N = 24;
const GL_NODES = (() => {
  const x: number[] = new Array(GL_N);
  const w: number[] = new Array(GL_N);
  for (let i = 0; i < GL_N; i++) {
    // Initial Chebyshev-ish guess, refined by Newton iterations on P_n.
    let t = Math.cos((Math.PI * (i + 0.75)) / (GL_N + 0.5));
    for (let k = 0; k < 40; k++) {
      let p0 = 1;
      let p1 = t;
      for (let n = 1; n < GL_N; n++) {
        const p2 = ((2 * n + 1) * t * p1 - n * p0) / (n + 1);
        p0 = p1;
        p1 = p2;
      }
      const dp = (GL_N * (t * p1 - p0)) / (t * t - 1);
      const dt = -p1 / dp;
      t += dt;
      if (Math.abs(dt) < 1e-16) break;
    }
    let p0 = 1;
    let p1 = t;
    for (let n = 1; n < GL_N; n++) {
      const p2 = ((2 * n + 1) * t * p1 - n * p0) / (n + 1);
      p0 = p1;
      p1 = p2;
    }
    const dp = (GL_N * (t * p1 - p0)) / (t * t - 1);
    x[i] = t;
    w[i] = 2 / ((1 - t * t) * dp * dp);
  }
  return { x, w };
})();

const PHI_N = 32;

/**
 * ∫ Y_{l2}^{m2*}(θ,φ) cosθ Y_{l1}^{m1}(θ,φ) dΩ evaluated numerically.
 * The cosθ samples are the quadrature nodes themselves, so this is
 * ∫_{-1}^{1} P(cosθ) d(cosθ) — no singularity, spectrally convergent.
 */
export function angularZNumeric(l1: number, m1: number, l2: number, m2: number): number {
  let re = 0;
  const dphi = (Math.PI * 2) / PHI_N;
  for (let i = 0; i < GL_N; i++) {
    const mu = GL_NODES.x[i];
    const wi = GL_NODES.w[i];
    const theta = Math.acos(Math.max(-1, Math.min(1, mu)));
    for (let j = 0; j < PHI_N; j++) {
      const phi = j * dphi;
      const a = yLm(l1, m1, theta, phi);
      const b = yLm(l2, m2, theta, phi);
      // Re( Y2* · cosθ · Y1 ) — the imaginary part integrates to zero.
      const prodRe = b.re * a.re + b.im * a.im;
      re += wi * dphi * mu * prodRe;
    }
  }
  return re;
}

export function angularElement(l1: number, m1: number, l2: number, m2: number): AngularElement {
  const closed = angularZClosed(l1, m1, l2, m2);
  const numeric = angularZNumeric(l1, m1, l2, m2);
  const deltaL = l2 - l1;
  return {
    closed,
    numeric,
    error: Math.abs(numeric - closed),
    deltaL,
    deltaM: m2 - m1,
    angularAllowed: Math.abs(deltaL) === 1 && m1 === m2,
  };
}

/**
 * ∫₀^∞ R_{n2 ℓ2}(r) R_{n1 ℓ1}(r) r³ dr by composite Simpson quadrature.
 * The integrand is (polynomial in r) × e^{−r(1/n1+1/n2)}, so a uniform grid out
 * to ~24 (n1+n2)²/2 a₀ with 12 000 panels is accurate to ~1e-10.
 */
export function radialDipoleIntegral(n1: number, l1: number, n2: number, l2: number, Z = 1): number {
  const nMax = Math.max(n1, n2);
  const rMax = Math.max(24, 12 * nMax * nMax);
  const panels = 12000;
  const h = rMax / panels;
  let sum = 0;
  for (let i = 0; i <= panels; i++) {
    const r = i * h;
    const w = i === 0 || i === panels ? 1 : i % 2 === 1 ? 4 : 2;
    const R1 = radialWavefunction(n1, l1, 0, r, Z);
    const R2 = radialWavefunction(n2, l2, 0, r, Z);
    sum += w * R1 * R2 * r * r * r;
  }
  return (sum * h) / 3;
}

export interface DipoleElement {
  /** ⟨f|z|i⟩ in e·a₀ (signed). */
  d: number;
  abs: number;
  radial: number;
  angular: AngularElement;
  /** E1 allowed for a z-polarised (π) drive: Δℓ = ±1 and Δm = 0. */
  allowed: boolean;
  /** Human verdict shown in telemetry. */
  verdict: string;
  /** Why it is forbidden, when it is. */
  reason: string;
}

const cache = new Map<string, DipoleElement>();

/** Full E1 matrix element ⟨n2 ℓ2 m2| z |n1 ℓ1 m1⟩ (cached — each is ~1e4 flops). */
export function dipoleZ(
  n1: number,
  l1: number,
  m1: number,
  n2: number,
  l2: number,
  m2: number,
  Z = 1,
): DipoleElement {
  const key = `${n1},${l1},${m1}|${n2},${l2},${m2}|${Z}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const angular = angularElement(l1, m1, l2, m2);
  const radial = radialDipoleIntegral(n1, l1, n2, l2, Z);
  const d = radial * angular.closed;
  const abs = Math.abs(d);

  let reason = 'allowed';
  if (Math.abs(angular.deltaL) !== 1) {
    reason =
      angular.deltaL === 0
        ? 'Δℓ = 0 — parity forbids ⟨f|r̂|i⟩ (same parity states)'
        : `|Δℓ| = ${Math.abs(angular.deltaL)} ≠ 1 — the angular integral vanishes`;
  } else if (angular.deltaM !== 0) {
    reason = `Δm = ${angular.deltaM} ≠ 0 — a ẑ-polarised (π) photon carries no angular momentum about ẑ`;
  }

  const el: DipoleElement = {
    d,
    abs,
    radial,
    angular,
    allowed: abs > 1e-8,
    verdict: abs > 1e-8 ? 'E1 allowed' : 'E1 forbidden',
    reason,
  };
  cache.set(key, el);
  return el;
}

/** Selection-rule table entry for the math drawer / probe panel. */
export interface RuleCase {
  id: string;
  label: string;
  tex: string;
  states: { i: [number, number, number]; f: [number, number, number] };
  note: string;
}

/**
 * Preset probes. `2p → 4f` is the physical realisation of the textbook
 * "2p → f" case: 3f is not a hydrogenic state (n ≥ ℓ + 1 forces f ⇒ n ≥ 4).
 */
export const RULE_CASES: RuleCase[] = [
  {
    id: 'ls-2p',
    label: '1s → 2p₀  (Lyman-α)',
    tex: '\\langle 2p_0|\\hat z|1s\\rangle = \\tfrac{128\\sqrt2}{243}\\,a_0',
    states: { i: [1, 0, 0], f: [2, 1, 0] },
    note: 'Δℓ = +1, Δm = 0 — the strongest line in the hydrogen UV spectrum.',
  },
  {
    id: 'ls-2s',
    label: '1s → 2s  (Δℓ = 0)',
    tex: '\\langle 2s|\\hat z|1s\\rangle = 0',
    states: { i: [1, 0, 0], f: [2, 0, 0] },
    note: 'Both states are even under r̂ → −r̂, so z (odd) cannot connect them: the two-photon 2s level is metastable.',
  },
  {
    id: '2p-4f',
    label: '2p₀ → 4f₀  (Δℓ = +2)',
    tex: '\\langle 4f|\\hat z|2p\\rangle = 0',
    states: { i: [2, 1, 0], f: [4, 3, 0] },
    note: '3f does not exist (n ≥ ℓ+1), so 4f is the nearest f state. |Δℓ| = 2 kills the angular integral.',
  },
  {
    id: 'ls-2p-m1',
    label: '1s → 2p₁  (Δm = +1)',
    tex: '\\langle 2p_{+1}|\\hat z|1s\\rangle = 0',
    states: { i: [1, 0, 0], f: [2, 1, 1] },
    note: 'Δℓ = 1 is fine but a linearly polarised ẑ field transfers m = 0; Δm = ±1 needs σ± light.',
  },
  {
    id: '2p-3d',
    label: '2p₀ → 3d₀',
    tex: '\\langle 3d_0|\\hat z|2p_0\\rangle \\ne 0',
    states: { i: [2, 1, 0], f: [3, 2, 0] },
    note: 'Allowed Balmer-α cascade step; the radial integral is dominated by the large 3d orbit.',
  },
  {
    id: '2s-3p',
    label: '2s → 3p₀',
    tex: '\\langle 3p_0|\\hat z|2s\\rangle \\ne 0',
    states: { i: [2, 0, 0], f: [3, 1, 0] },
    note: 'Allowed, and the radial element is huge (≈ 6 e·a₀) because both states are diffuse.',
  },
];

/**
 * Pre-compute ψ_{nℓm}(y, z) on the x = 0 plane into two Float32Arrays so the
 * cloud renderer only has to combine static profiles per frame.
 * Row 0 is +z (top of the canvas), column 0 is −y. Built from the shared
 * `radialWavefunction` times `yLm` above, so m ≠ 0 states wind the correct way.
 */
export function planeState(
  n: number,
  l: number,
  m: number,
  size: number,
  extent: number,
  Z: number,
  outRe: Float32Array,
  outIm: Float32Array,
): void {
  for (let j = 0; j < size; j++) {
    const z = extent * (1 - (2 * j + 1) / size);
    const row = j * size;
    for (let i = 0; i < size; i++) {
      const y = extent * ((2 * i + 1) / size - 1);
      const r = Math.hypot(y, z);
      const theta = r < 1e-9 ? 0 : Math.acos(Math.max(-1, Math.min(1, z / r)));
      // x ≡ 0 on this plane, so φ = ±π/2 (the sign of y picks the half-plane).
      const phi = y === 0 ? 0 : y > 0 ? Math.PI / 2 : -Math.PI / 2;
      const R = radialWavefunction(n, l, m, r, Z);
      const Y = yLm(l, m, theta, phi);
      outRe[row + i] = R * Y.re;
      outIm[row + i] = R * Y.im;
    }
  }
}

/** ⟨z⟩ of a coherent two-level superposition, in units of e·a₀. */
export function dipoleExpectation(
  ci: { re: number; im: number },
  cf: { re: number; im: number },
  dFi: number,
): number {
  // ⟨d⟩ = d_ii|c_i|² + d_ff|c_f|² + 2 Re(c_i* c_f) d_fi ; diagonals vanish by parity.
  const crossRe = ci.re * cf.re + ci.im * cf.im;
  return 2 * crossRe * dFi;
}
