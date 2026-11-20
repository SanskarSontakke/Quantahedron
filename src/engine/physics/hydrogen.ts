/**
 * hydrogen.ts — exact analytical hydrogenic eigenfunctions.
 *
 *   ψ_{nℓm}(r,θ,φ) = R_{nℓ}(r) · Y_ℓ^m(θ,φ)
 *   R_{nℓ}(r) = √[(2Z/na₀)³ · (n−ℓ−1)! / (2n·(n+ℓ)!)] · e^{−ρ/2} · ρ^ℓ · L_{n−ℓ−1}^{2ℓ+1}(ρ)
 *   ρ = 2Zr/(n a₀)
 *
 * Everything runs in atomic units (a₀ = 1). Numerical notes mandated by the
 * PRD (§7, "Floating-Point Overflow in High-n Factorials"):
 *   • All normalization prefactors are assembled in **log space** via lgamma,
 *     so n = 7 (which needs (n+ℓ)! = 13!) never overflows or loses precision.
 *   • Laguerre and Associated Legendre terms use **three-term recurrences**
 *     rather than explicit factorial sums.
 *
 * Zero React dependencies — safe to import from Web Workers and the GPU bake pass.
 */

import type { Complex } from './constants';
import { HARTREE_EV, IONIZATION_EV, MAX_N, SUBSHELL_LETTERS } from './constants';

/* ------------------------------------------------------------------ */
/* Stable special functions                                             */
/* ------------------------------------------------------------------ */

const LANCOS_G = 7;
const LANCOS_C = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526234067, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Log-Gamma (Lanczos approximation), accurate to ~1e-13 for x > 0. */
export function lgamma(x: number): number {
  if (x < 0.5) {
    // Reflection: Γ(x)Γ(1−x) = π / sin(πx)
    return (
      Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x)
    );
  }
  const z = x - 1;
  let a = LANCOS_C[0];
  for (let i = 1; i < LANCOS_G + 2; i++) a += LANCOS_C[i] / (z + i);
  const t = z + LANCOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log(k!) for non-negative integers. */
export function logFactorial(k: number): number {
  return lgamma(k + 1);
}

/**
 * Generalized (associated) Laguerre polynomial L_p^{(k)}(x) evaluated with the
 * three-term recurrence — stable for the small orders used here (p ≤ 6).
 */
export function assocLaguerre(p: number, k: number, x: number): number {
  if (p === 0) return 1;
  if (p === 1) return 1 + k - x;
  let lPrev = 1;
  let lCurr = 1 + k - x;
  for (let n = 1; n < p; n++) {
    const lNext =
      ((2 * n + 1 + k - x) * lCurr - (n + k) * lPrev) / (n + 1);
    lPrev = lCurr;
    lCurr = lNext;
  }
  return lCurr;
}

/**
 * Associated Legendre P_ℓ^m(cosθ) **without** the Condon–Shortley phase sign
 * ambiguity: we include (−1)^m exactly as the standard physics convention, and
 * normalize separately. Computed with the upward recurrence in ℓ starting from
 * P_m^m, which is numerically well behaved for ℓ ≤ 6.
 */
export function assocLegendre(l: number, m: number, cosTheta: number): number {
  const mu = Math.abs(m);
  const x = Math.max(-1, Math.min(1, cosTheta));
  const somlex = Math.sqrt(Math.max(0, 1 - x * x));

  // P_mu^mu = (−1)^mu (2mu−1)!! (1−x²)^{mu/2}
  let pMM = 1;
  for (let i = 1; i <= mu; i++) pMM *= (2 * i - 1) * somlex;
  pMM *= mu % 2 === 0 ? 1 : -1; // Condon–Shortley phase

  if (l === mu) return pMM;

  const pMmu1 = x * (2 * mu + 1) * pMM; // P_{mu+1}^{mu}
  if (l === mu + 1) return pMmu1;

  let prev = pMM;
  let curr = pMmu1;
  for (let ll = mu + 2; ll <= l; ll++) {
    const next = (x * (2 * ll - 1) * curr - (ll + mu - 1) * prev) / (ll - mu);
    prev = curr;
    curr = next;
  }
  return curr;
}

/** Normalization constant of the complex spherical harmonic Y_ℓ^m. */
export function sphericalHarmonicNorm(l: number, m: number): number {
  const mu = Math.abs(m);
  // √[(2l+1)/(4π) · (l−m)!/(l+m)!]  — log space.
  const logVal =
    0.5 * (Math.log((2 * l + 1) / (4 * Math.PI)) + logFactorial(l - mu) - logFactorial(l + mu));
  return Math.exp(logVal);
}

/* ------------------------------------------------------------------ */
/* Radial + angular eigenfunctions                                      */
/* ------------------------------------------------------------------ */

/** Radial normalization N_{nℓ} (atomic units). */
export function radialNorm(n: number, l: number, Z: number): number {
  const rho0 = (2 * Z) / n;
  const logPref =
    1.5 * Math.log(rho0) +
    0.5 * (logFactorial(n - l - 1) - Math.log(2 * n) - logFactorial(n + l));
  return Math.exp(logPref);
}

/** R_{nℓ}(r) in atomic units, Z = hydrogen-like nuclear charge. */
export function radialWavefunction(n: number, l: number, m: number, r: number, Z: number): number {
  void m;
  const rho = (2 * Z * Math.max(r, 0)) / n;
  const N = radialNorm(n, l, Z);
  return N * Math.exp(-rho / 2) * Math.pow(rho, l) * assocLaguerre(n - l - 1, 2 * l + 1, rho);
}

/** Y_ℓ^m(θ, φ) — complex spherical harmonic. */
export function Ylm(l: number, m: number, theta: number, phi: number): Complex {
  const mu = Math.abs(m);
  const norm = sphericalHarmonicNorm(l, mu);
  const P = assocLegendre(l, mu, Math.cos(theta));
  const ang = mu === 0 ? 1 : 0; // guard, unused
  void ang;
  // Y_l^{+m} = N P_l^m e^{i m φ};  Y_l^{−m} = (−1)^m conj(Y_l^{+m})
  let re = norm * P * Math.cos(mu * phi);
  let im = norm * P * Math.sin(mu * phi);
  if (m < 0 && mu % 2 === 1) {
    re = -re;
    im = -im;
  }
  return { re, im };
}

/** ψ_{nℓm} at a point (atomic units). */
export function psiNLM(
  n: number,
  l: number,
  m: number,
  r: number,
  theta: number,
  phi: number,
  Z: number,
): Complex {
  const R = radialWavefunction(n, l, m, r, Z);
  const Y = Ylm(l, m, theta, phi);
  return { re: R * Y.re, im: R * Y.im };
}

/** ψ from Cartesian coordinates (atomic units, nucleus at origin). */
export function psiCartesian(
  n: number,
  l: number,
  m: number,
  x: number,
  y: number,
  z: number,
  Z: number,
): Complex {
  const r = Math.hypot(x, y, z);
  if (r < 1e-9) {
    const R0 = radialWavefunction(n, l, m, 0, Z);
    const Y = Ylm(l, m, 0, 0);
    return { re: R0 * Y.re, im: R0 * Y.im };
  }
  const theta = Math.acos(z / r);
  const phi = Math.atan2(y, x);
  return psiNLM(n, l, m, r, theta, phi, Z);
}

/* ------------------------------------------------------------------ */
/* Eigenstate bookkeeping                                              */
/* ------------------------------------------------------------------ */

export interface BasisState {
  n: number;
  l: number;
  m: number;
}

export interface Amplitude extends BasisState {
  /** |c| */
  amp: number;
  /** arg(c) in radians */
  phase: number;
}

/** Energy of a hydrogenic level in atomic units (Hartree). */
export function energyHa(n: number, Z: number): number {
  return (-Z * Z) / (2 * n * n);
}

/** Energy in eV. */
export function energyEv(n: number, Z: number): number {
  return energyHa(n, Z) * HARTREE_EV;
}

/** Orbital binding energy magnitude, eV (positive ionization depth). */
export function bindingEv(n: number, Z: number): number {
  return -energyEv(n, Z) + 0 * IONIZATION_EV;
}

/** Radial / angular node counts. */
export const radialNodes = (n: number, l: number) => n - l - 1;
export const angularNodes = (l: number) => l;

/** Validate a quantum-number triple, clamping into the legal range. */
export function sanitizeState(n: number, l: number, m: number): BasisState {
  const nn = Math.max(1, Math.min(MAX_N, Math.round(n)));
  const ll = Math.max(0, Math.min(nn - 1, Math.round(l)));
  const mm = Math.max(-ll, Math.min(ll, Math.round(m)));
  return { n: nn, l: ll, m: mm };
}

/* ------------------------------------------------------------------ */
/* Expectation values (Gauss–Laguerre / Simpson quadrature)            */
/* ------------------------------------------------------------------ */

/**
 * ⟨r^k⟩ for R_{nℓ} using Gauss–Laguerre-style adaptive Simpson quadrature.
 * Integrates ∫ r^{k+2} |R|² dr over [0, rMax]; the integrand is a polynomial ×
 * e^{−ρ}, so a few hundred panels is machine-accurate for our n ≤ 7.
 */
export function radialMoment(n: number, l: number, k: number, Z: number, rMax?: number): number {
  const rcut = rMax ?? (60 * n * n) / Math.max(Z, 1e-6);
  const panels = 2000;
  const h = rcut / panels;
  let sum = 0;
  for (let i = 0; i <= panels; i++) {
    const r = i * h;
    const R = radialWavefunction(n, l, 0, r, Z);
    const w = i === 0 || i === panels ? 1 : i % 2 === 1 ? 4 : 2;
    sum += w * Math.pow(r, k + 2) * R * R;
  }
  return (sum * h) / 3;
}

/** ⟨r⟩ in a₀. */
export function rExpectation(n: number, l: number, Z: number): number {
  return radialMoment(n, l, 1, Z);
}

/** Most probable radius (peak of 4πr²|R|²) in a₀. */
export function rMostProbable(n: number, l: number, Z: number): number {
  const rcut = (40 * n * n) / Math.max(Z, 1e-6);
  const steps = 4000;
  let best = 0;
  let bestV = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const r = (i / steps) * rcut;
    const R = radialWavefunction(n, l, 0, r, Z);
    const v = r * r * R * R;
    if (v > bestV) {
      bestV = v;
      best = r;
    }
  }
  return best;
}

/** Sample the radial distribution P(r) = 4π r² |R_{nℓ}(r)|² for plotting. */
export function radialDistribution(
  n: number,
  l: number,
  Z: number,
  samples = 240,
  rMax?: number,
): { r: number[]; p: number[]; max: number } {
  const rcut = rMax ?? Math.max(18, (9 * n * n) / Math.max(Z, 1e-6));
  const r: number[] = [];
  const p: number[] = [];
  let max = 1e-12;
  for (let i = 0; i <= samples; i++) {
    const rr = (i / samples) * rcut;
    const R = radialWavefunction(n, l, 0, rr, Z);
    const val = 4 * Math.PI * rr * rr * R * R;
    r.push(rr);
    p.push(val);
    if (val > max) max = val;
  }
  return { r, p, max };
}

/** Angular distribution |Y_ℓ^m(θ, 0)|² sampled over θ ∈ [0, π] (φ-independent for density). */
export function angularDistribution(
  l: number,
  m: number,
  samples = 180,
): { theta: number[]; a: number[]; max: number } {
  const theta: number[] = [];
  const a: number[] = [];
  let max = 1e-12;
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI;
    const Y = Ylm(l, m, t, 0);
    const v = Y.re * Y.re + Y.im * Y.im;
    theta.push(t);
    a.push(v);
    if (v > max) max = v;
  }
  return { theta, a, max };
}

/* ------------------------------------------------------------------ */
/* Real ("chemistry") orbital basis & hybridization                    */
/* ------------------------------------------------------------------ */

export type RealOrbitalId =
  | '1s'
  | '2p_z'
  | '2p_x'
  | '2p_y'
  | '3d_z2'
  | '3d_xz'
  | '3d_yz'
  | '3d_x2y2'
  | '3d_xy'
  | '4f_z3'
  | string;

export interface RealOrbital {
  id: string;
  latex: string;
  /** Expansion in complex eigenstates: coefficients multiplying Y_ℓ^m. */
  terms: { state: BasisState; re: number; im: number }[];
}

const invSqrt2 = 1 / Math.SQRT2;

/** Build the real-orbital expansion for a given n, ℓ label. */
export function realOrbital(n: number, l: number, kind: string): RealOrbital {
  const t = (m: number, re: number, im = 0) => ({ state: { n, l, m }, re, im });
  switch (`${SUBSHELL_LETTERS[l]}:${kind}`) {
    case 'p:z':
      return { id: `${n}p_z`, latex: `p_z`, terms: [t(0, 1)] };
    case 'p:x':
      // p_x = (Y_1^{-1} − Y_1^{+1})/√2
      return { id: `${n}p_x`, latex: `p_x`, terms: [t(-1, invSqrt2), t(1, -invSqrt2)] };
    case 'p:y':
      // p_y = i(Y_1^{-1} + Y_1^{+1})/√2
      return { id: `${n}p_y`, latex: `p_y`, terms: [t(-1, 0, invSqrt2), t(1, 0, invSqrt2)] };
    case 'd:z2':
      return { id: `${n}d_{z^2}`, latex: `d_{z^2}`, terms: [t(0, 1)] };
    case 'd:xz':
      return { id: `${n}d_{xz}`, latex: `d_{xz}`, terms: [t(-1, invSqrt2), t(1, -invSqrt2)] };
    case 'd:yz':
      return { id: `${n}d_{yz}`, latex: `d_{yz}`, terms: [t(-1, 0, invSqrt2), t(1, 0, invSqrt2)] };
    case 'd:x2y2':
      return {
        id: `${n}d_{x^2-y^2}`,
        latex: `d_{x^2-y^2}`,
        terms: [t(-2, invSqrt2), t(2, -invSqrt2)],
      };
    case 'd:xy':
      return {
        id: `${n}d_{xy}`,
        latex: `d_{xy}`,
        terms: [t(-2, 0, invSqrt2), t(2, 0, invSqrt2)],
      };
    case 'f:z3':
      return { id: `${n}f_{z^3}`, latex: `f_{z^3}`, terms: [t(0, 1)] };
    default:
      return { id: `${n}${SUBSHELL_LETTERS[l]}`, latex: `${n}${SUBSHELL_LETTERS[l]}`, terms: [t(0, 1)] };
  }
}

export interface HybridPreset {
  id: string;
  label: string;
  geometry: string;
  angleDeg: number;
  /** Contributions of 2s / 2p_z / 2p_x / 2p_y (unit-normalized). */
  lobes: { name: string; s: number; px: number; py: number; pz: number; dir: [number, number, number] }[];
}

/** sp, sp², sp³, sp³d, sp³d² hybridization presets (n = 2 manifold). */
export const HYBRID_PRESETS: HybridPreset[] = [
  (() => {
    const a = 1 / Math.SQRT2;
    return {
      id: 'sp',
      label: 'sp',
      geometry: 'Linear',
      angleDeg: 180,
      lobes: [
        { name: 'sp₁', s: a, px: a, py: 0, pz: 0, dir: [1, 0, 0] },
        { name: 'sp₂', s: a, px: -a, py: 0, pz: 0, dir: [-1, 0, 0] },
      ],
    };
  })(),
  (() => {
    const s = 1 / Math.sqrt(3);
    const p = Math.sqrt(2 / 3);
    return {
      id: 'sp2',
      label: 'sp²',
      geometry: 'Trigonal planar',
      angleDeg: 120,
      lobes: [0, 120, 240].map((deg) => {
        const th = (deg * Math.PI) / 180;
        return {
          name: `sp²·${deg}°`,
          s,
          px: p * Math.cos(th),
          py: p * Math.sin(th),
          pz: 0,
          dir: [Math.cos(th), Math.sin(th), 0] as [number, number, number],
        };
      }),
    };
  })(),
  (() => {
    const s = 0.5;
    const p = 0.5;
    const dirs: [number, number, number][] = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
    ].map((v) => {
      const n = Math.sqrt(3);
      return [v[0] / n, v[1] / n, v[2] / n];
    });
    return {
      id: 'sp3',
      label: 'sp³',
      geometry: 'Tetrahedral',
      angleDeg: 109.5,
      lobes: dirs.map((d, i) => ({
        name: `sp³·${i + 1}`,
        s,
        px: p * d[0],
        py: p * d[1],
        pz: p * d[2],
        dir: d,
      })),
    };
  })(),
  (() => {
    const s = 1 / Math.sqrt(6);
    const pz = Math.sqrt(3 / 6) * Math.SQRT2 * 0.5;
    const rest = Math.sqrt((1 - s * s) / 5 - 0.0000001);
    void pz;
    const dirs: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    return {
      id: 'sp3d',
      label: 'sp³d',
      geometry: 'Trigonal bipyramidal',
      angleDeg: 90,
      lobes: dirs.map((d, i) => ({
        name: `sp³d·${i + 1}`,
        s,
        px: rest * d[0],
        py: rest * d[1],
        pz: rest * d[2],
        dir: d,
      })),
    };
  })(),
  (() => {
    const s = 1 / Math.sqrt(7);
    const rest = Math.sqrt((1 - s * s) / 6);
    const dirs: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    return {
      id: 'sp3d2',
      label: 'sp³d²',
      geometry: 'Octahedral',
      angleDeg: 90,
      lobes: dirs.map((d, i) => ({
        name: `sp³d²·${i + 1}`,
        s,
        px: rest * d[0],
        py: rest * d[1],
        pz: rest * d[2],
        dir: d,
      })),
    };
  })(),
];

/**
 * Turn a hybrid preset into a list of complex-eigenstate amplitudes on the
 * n = 2 manifold (2s, 2p_x, 2p_y, 2p_z re-expanded into |n ℓ m⟩).
 */
export function hybridToAmplitudes(presetId: string, n = 2): Amplitude[] {
  const preset = HYBRID_PRESETS.find((p) => p.id === presetId);
  if (!preset) return [];
  const out: Amplitude[] = [];
  for (const lobe of preset.lobes) {
    // Each hybrid lobe is itself a superposition; we emit the *set* of
    // underlying eigenstates with their combined weight so the phasor matrix
    // shows exactly what is mixed.
    const push = (l: number, m: number, re: number, im = 0) => {
      const mag = Math.hypot(re, im);
      if (mag < 1e-6) return;
      out.push({
        n,
        l,
        m,
        amp: mag / Math.sqrt(preset.lobes.length),
        phase: Math.atan2(im, re),
      });
    };
    push(0, 0, lobe.s);
    // p_x, p_y, p_z → real combinations folded back onto m = ±1, 0
    push(1, 0, lobe.pz);
    push(1, -1, -lobe.px * invSqrt2, lobe.py * invSqrt2);
    push(1, 1, lobe.px * invSqrt2, lobe.py * invSqrt2);
  }
  return mergeAmplitudes(out);
}

/** Combine repeated |n ℓ m⟩ entries and drop negligible ones. */
export function mergeAmplitudes(list: Amplitude[]): Amplitude[] {
  const map = new Map<string, Complex>();
  for (const a of list) {
    const key = `${a.n},${a.l},${a.m}`;
    const z = { re: a.amp * Math.cos(a.phase), im: a.amp * Math.sin(a.phase) };
    const prev = map.get(key) ?? { re: 0, im: 0 };
    map.set(key, { re: prev.re + z.re, im: prev.im + z.im });
  }
  const out: Amplitude[] = [];
  for (const [key, z] of map) {
    const [n, l, m] = key.split(',').map(Number);
    const amp = Math.hypot(z.re, z.im);
    if (amp < 1e-4) continue;
    out.push({ n, l, m, amp, phase: Math.atan2(z.im, z.re) });
  }
  out.sort((a, b) => a.n - b.n || a.l - b.l || a.m - b.m);
  return out;
}

/** Normalize amplitudes in place (returns a new array) so Σ|c|² = 1. */
export function normalizeAmplitudes(list: Amplitude[]): Amplitude[] {
  const norm = Math.sqrt(list.reduce((s, a) => s + a.amp * a.amp, 0));
  if (norm < 1e-9) return list;
  return list.map((a) => ({ ...a, amp: a.amp / norm }));
}

/* ------------------------------------------------------------------ */
/* Superposition evaluation                                            */
/* ------------------------------------------------------------------ */

/**
 * Ψ(r, t) = Σ c_i R_{nℓ}(r) Y_ℓ^m e^{−iE_n t}
 * Time in atomic units; with ℏ = 1, E_n in Hartree.
 */
export function evaluateSuperposition(
  amps: Amplitude[],
  x: number,
  y: number,
  z: number,
  t: number,
  Z: number,
): Complex {
  const r = Math.hypot(x, y, z);
  let re = 0;
  let im = 0;
  if (r < 1e-9) return { re: 0, im: 0 };
  const theta = Math.acos(Math.max(-1, Math.min(1, z / r)));
  const phi = Math.atan2(y, x);
  for (const a of amps) {
    if (a.amp < 1e-6) continue;
    const psi = psiNLM(a.n, a.l, a.m, r, theta, phi, Z);
    const cRe = a.amp * Math.cos(a.phase);
    const cIm = a.amp * Math.sin(a.phase);
    const wRe = cRe * psi.re - cIm * psi.im;
    const wIm = cRe * psi.im + cIm * psi.re;
    const ang = -energyHa(a.n, Z) * t;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    re += wRe * ca - wIm * sa;
    im += wRe * sa + wIm * ca;
  }
  return { re, im };
}

/**
 * Probability current density **J** = (ℏ/mₑ) Im(ψ* ∇ψ) for a superposition,
 * evaluated with a central-difference gradient. In atomic units ℏ/mₑ = 1.
 */
export function probabilityCurrent(
  amps: Amplitude[],
  p: [number, number, number],
  t: number,
  Z: number,
): [number, number, number] {
  const h = 1e-3;
  const [x, y, z] = p;
  const dPsi = [
    {
      re:
        (evaluateSuperposition(amps, x + h, y, z, t, Z).re -
          evaluateSuperposition(amps, x - h, y, z, t, Z).re) /
        (2 * h),
      im:
        (evaluateSuperposition(amps, x + h, y, z, t, Z).im -
          evaluateSuperposition(amps, x - h, y, z, t, Z).im) /
        (2 * h),
    },
  ];
  // Recompute neighbours once each for y, z (kept explicit for clarity).
  const py = evaluateSuperposition(amps, x, y + h, z, t, Z);
  const ny = evaluateSuperposition(amps, x, y - h, z, t, Z);
  const pz = evaluateSuperposition(amps, x, y, z + h, t, Z);
  const nz = evaluateSuperposition(amps, x, y, z - h, t, Z);
  const psi = evaluateSuperposition(amps, x, y, z, t, Z);

  const gx = dPsi[0];
  const gy = { re: (py.re - ny.re) / (2 * h), im: (py.im - ny.im) / (2 * h) };
  const gz = { re: (pz.re - nz.re) / (2 * h), im: (pz.im - nz.im) / (2 * h) };

  const jx = psi.re * gx.im - psi.im * gx.re;
  const jy = psi.re * gy.im - psi.im * gy.re;
  const jz = psi.re * gz.im - psi.im * gz.re;
  return [jx, jy, jz];
}

/**
 * Draw one sample position from |Ψ|² by rejection sampling inside a sphere.
 * Used by the Measurement & Collapse engine.
 */
export function samplePosition(
  amps: Amplitude[],
  t: number,
  Z: number,
  rMax: number,
  rng: () => number = Math.random,
  maxTries = 4000,
): [number, number, number] | null {
  const ampsMax = normalizeAmplitudes(amps);
  // Peak density estimate via a coarse grid (cached by caller if hot).
  let peak = 0;
  for (let i = 0; i < 160; i++) {
    const r = rng() * rMax;
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(1 - ct * ct);
    const phi = rng() * Math.PI * 2;
    const v = evaluateSuperposition(
      ampsMax,
      r * st * Math.cos(phi),
      r * st * Math.sin(phi),
      r * ct,
      t,
      Z,
    );
    const d = v.re * v.re + v.im * v.im;
    if (d > peak) peak = d;
  }
  if (peak <= 0) return null;
  for (let k = 0; k < maxTries; k++) {
    const u = rng();
    const r = rMax * Math.cbrt(u);
    const ct = 2 * rng() - 1;
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const phi = rng() * Math.PI * 2;
    const x = r * st * Math.cos(phi);
    const y = r * st * Math.sin(phi);
    const z = r * ct;
    const v = evaluateSuperposition(ampsMax, x, y, z, t, Z);
    const d = v.re * v.re + v.im * v.im;
    if (rng() * peak < d) return [x, y, z];
  }
  return null;
}

/** Zeeman shift of a level, eV: ΔE = m ℓ ... for orbital: ΔE = m μ_B B. */
export function zeemanShiftEv(m: number, BTesla: number, muB: number): number {
  return m * muB * BTesla;
}

/** Linear Stark coupling between |n00⟩ and |n10⟩ for field Ez (atomic units). */
export function starkSplittingEv(dipoleAU: number, fieldAU: number): number {
  // ΔE = −⟨d⟩·E, converted with 1 Ha = 27.2114 eV
  return dipoleAU * fieldAU * HARTREE_EV;
}
