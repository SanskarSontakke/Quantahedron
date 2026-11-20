/**
 * lcao.ts — two-centre (linear combination of atomic orbitals) physics.
 *
 * Pure TypeScript, atomic units (ℏ = mₑ = e = 4πϵ₀ = 1, lengths in a₀, energies
 * in Hartree), zero React / DOM / WebGL references, so the same module feeds the
 * volumetric shader sampler, the potential-energy-curve plot and the KaTeX drawer.
 *
 * Model (Sim 9 "Molecular Orbitals & LCAO Bonding"):
 *
 *   Two nuclei of charge Z sit at z = ∓R/2, each carrying one hydrogenic AO of
 *   adjustable exponent ζ:
 *       1s  : φ(r) = N₁ e^{−ζr}                    N₁ = √(ζ³/π)
 *       2pz : φ(r) = N₂ z e^{−ζr/2}                N₂ = ζ^{5/2}/√(32π)
 *       2px : φ(r) = N₂ x e^{−ζr/2}
 *
 *   The molecular orbital is the parity-adapted combination
 *       ψ_± = N_± (φ_A ± φ_B),      N_± = 1/√(2(1 ± S(R)))
 *   with S(R) = ⟨φ_A|φ_B⟩ the two-centre **overlap integral**.
 *
 *   Because each AO is an exact eigenfunction of its own one-centre Hamiltonian,
 *   (−½∇² − ζ/r_own)φ = ε φ with ε = −ζ²/2 (1s) or −ζ²/8 (2p), the secular problem
 *   collapses onto three radial integrals:
 *       S   = ⟨A|B⟩
 *       J'  = ⟨A|1/r_B|A⟩                 (Coulomb)
 *       I   = ⟨A|1/r_A|B⟩ = ⟨A|1/r_B|B⟩   (resonance; equal by A↔B inversion)
 *       H_AA = ⟨T⟩_AA − Z⟨1/r_A⟩_AA − Z J'
 *       H_AB = ε S + (ζ − 2Z) I
 *   and the 2×2 secular determinant gives the textbook
 *       E_±(R) = (H_AA ± H_AB)/(1 ± S(R)),   U(R) = E_el(R) + Z²/R.
 *
 *   Closed forms for the 1s basis (s = ζR):
 *       S  = e^{−s}(1 + s + s²/3)
 *       J' = (1/R)[1 − e^{−2s}(1 + s)]
 *       I  = ζ e^{−s}(1 + s)
 *   which the general prolate-spheroidal Gauss–Legendre quadrature reproduces to
 *   ~1e-9 (verified in the development harness; §7 numerical-accuracy mandate).
 *
 * Coordinate machinery for the quadrature — prolate spheroidal (ξ, η, φ):
 *       r_A = R(ξ+η)/2,  r_B = R(ξ−η)/2,  z = Rξη/2,
 *       ρ   = (R/2)√((ξ²−1)(1−η²)),       dτ = (R³/8)(ξ²−η²) dξ dη dφ.
 */

import { BOHR_RADIUS_M, HARTREE_EV } from './constants';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Atomic basis combined: 1s, or a 2p along the bond axis (σ) / perpendicular (π). */
export type AOKind = '1s' | '2pz' | '2px';
export type ComboKind = 'bonding' | 'antibonding';
export type ZetaMode = 'bare' | 'variational';

export interface TwoCenterIntegrals {
  /** Overlap S(R) = ⟨A|B⟩. */
  S: number;
  /** Coulomb integral J'(R) = ⟨A|1/r_B|A⟩. */
  Jaa: number;
  /** Resonance integral I(R) = ⟨A|1/r_A|B⟩. */
  Iab: number;
  method: 'analytic' | 'quadrature';
}

export interface LcaoState {
  kind: AOKind;
  combo: ComboKind;
  /** +1 → ψ ∝ φ_A + φ_B, −1 → ψ ∝ φ_A − φ_B. */
  sign: number;
  R: number;
  Z: number;
  zeta: number;
  S: number;
  /** Normalisation N_± of the MO. */
  N: number;
  Haa: number;
  Hab: number;
  /** Electronic energy of the displayed MO (Hartree). */
  Eel: number;
  /** Electronic energy of the partner (opposite parity) MO. */
  EelPartner: number;
  /** Internuclear repulsion Z²/R. */
  Vnn: number;
  /** Born–Oppenheimer total energy U = E_el + Z²/R. */
  U: number;
  /** Energy decomposition of U. */
  T: number;
  Ven: number;
  /** Electron–electron repulsion: exactly 0 for the one-electron ion. */
  Vee: number;
  /** Separated-atom asymptote of the AO's own shell. */
  Elimit: number;
  /** Elimit − U at this R (positive ⇒ bound against dissociation). */
  depth: number;
}

export interface CurvePoint {
  R: number;
  U: number;
  Eel: number;
  Vnn: number;
  S: number;
}

export interface Equilibrium {
  /** Equilibrium separation R₀ (a₀); NaN when the curve is purely repulsive. */
  Re: number;
  /** Well depth Dₑ = asymptote − E(R₀), Hartree. */
  De: number;
  /** Total energy at the minimum. */
  E0: number;
  /** Curvature d²U/dR² at R₀ (Hartree/a₀²). */
  k: number;
  /** Harmonic vibrational quantum ℏω = √(k/μ), μ = m_p/2 for H₂⁺. */
  hw: number;
  /** Asymptote used as the dissociation reference. */
  asymptote: number;
  bound: boolean;
}

export interface MorseParams {
  De: number;
  Re: number;
  a: number;
}

/* ------------------------------------------------------------------ */
/* Gauss–Legendre quadrature (self-contained)                          */
/* ------------------------------------------------------------------ */

const GL_CACHE = new Map<number, { x: Float64Array; w: Float64Array }>();

/** Nodes and weights of n-point Gauss–Legendre on [−1, 1]. */
export function gaussLegendre(n: number): { x: Float64Array; w: Float64Array } {
  const hit = GL_CACHE.get(n);
  if (hit) return hit;
  const x = new Float64Array(n);
  const w = new Float64Array(n);
  const half = (t: number): { p: number; d: number } => {
    let p1 = 0;
    let p2 = 1;
    for (let k = 0; k < n; k++) {
      const p3 = p2;
      p2 = ((2 * k + 1) * t * p2 - k * p1) / (k + 1);
      p1 = p3;
    }
    // p2 = P_n(t), derivative P_n'(t) = n(P_{n−1} − t P_n)/(1 − t²)
    return { p: p2, d: (n * (p1 - t * p2)) / (1 - t * t) };
  };
  const m = Math.ceil(n / 2);
  for (let i = 0; i < m; i++) {
    let t = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    for (let iter = 0; iter < 40; iter++) {
      const { p, d } = half(t);
      const dt = -p / d;
      t += dt;
      if (Math.abs(dt) < 1e-15) break;
    }
    const { d } = half(t);
    const weight = 2 / ((1 - t * t) * d * d);
    x[i] = -t;
    x[n - 1 - i] = t;
    w[i] = weight;
    w[n - 1 - i] = weight;
  }
  const built = { x, w };
  GL_CACHE.set(n, built);
  return built;
}

/* ------------------------------------------------------------------ */
/* Atomic orbitals                                                     */
/* ------------------------------------------------------------------ */

/** Normalization prefactor so that ∫|φ|²dτ = 1 for the AO of type `kind`. */
export function aoPrefactor(kind: AOKind, zeta: number): number {
  const z = Math.max(1e-6, zeta);
  if (kind === '1s') return Math.sqrt((z * z * z) / Math.PI);
  return Math.pow(z, 2.5) / Math.sqrt(32 * Math.PI);
}

/**
 * AO value with its centre at the origin; the bond axis is global z.
 * Fully three-dimensional (the GLSL `aoVal` in `src/engine/shaders/molecular.ts`
 * implements the same expression), so 2pπ really does split into two lobes along x.
 */
export function aoValue(kind: AOKind, zeta: number, x: number, y: number, z: number): number {
  const r = Math.sqrt(x * x + y * y + z * z);
  const n = aoPrefactor(kind, zeta);
  if (kind === '1s') return n * Math.exp(-zeta * r);
  const shared = n * Math.exp((-zeta * r) / 2);
  return kind === '2pz' ? shared * z : shared * x;
}

/** Hartree energy of the separated atom the AO correlates to. */
export function atomicLimitHa(kind: AOKind, Z: number): number {
  const n = kind === '1s' ? 1 : 2;
  return -(Z * Z) / (2 * n * n);
}

/* ------------------------------------------------------------------ */
/* 1s closed forms                                                     */
/* ------------------------------------------------------------------ */

/** Analytic 1s–1s overlap S(R) = e^{−s}(1 + s + s²/3), s = ζR. */
export function overlap1s(R: number, zeta: number): number {
  const s = Math.max(0, zeta) * Math.max(0, R);
  return Math.exp(-s) * (1 + s + (s * s) / 3);
}

/** Analytic Coulomb integral J'(R) = ⟨1s_A|1/r_B|1s_A⟩. */
export function coulomb1s(R: number, zeta: number): number {
  const Rm = Math.max(R, 1e-9);
  const s = Math.max(0, zeta) * Rm;
  return (1 / Rm) * (1 - Math.exp(-2 * s) * (1 + s));
}

/** Analytic resonance integral I(R) = ⟨1s_A|1/r_A|1s_B⟩. */
export function exchange1s(R: number, zeta: number): number {
  const s = Math.max(0, zeta) * Math.max(0, R);
  return zeta * Math.exp(-s) * (1 + s);
}

/* ------------------------------------------------------------------ */
/* General two-centre integrals (prolate spheroidal quadrature)        */
/* ------------------------------------------------------------------ */

const N_XI = 72;
const N_ETA = 32;

interface AOShape {
  /** Azimuthal average: 1 for σ, 1/2 for π (⟨cos²φ⟩ = 1/2). */
  az: number;
  /** Radial/angular amplitude in *scaled* lengths (r̃ = ζr), prefactor removed. */
  ampA: (rA: number, zA: number, rho: number) => number;
  ampB: (rB: number, zB: number, rho: number) => number;
  /** ⟨1/r_own⟩ = ζ (1s) or ζ/4 (2p). */
  own: (zeta: number) => number;
  /** ⟨T⟩ = ζ²/2 (1s) or ζ²/8 (2p). */
  kinetic: (zeta: number) => number;
  /** Eigenvalue ε of (T − ζ/r_own) = −ζ²/2 or −ζ²/8. */
  eigen: (zeta: number) => number;
}

function aoShape(kind: AOKind): AOShape {
  if (kind === '1s') {
    return {
      az: 1,
      ampA: (rA) => Math.exp(-rA),
      ampB: (rB) => Math.exp(-rB),
      own: (z) => z,
      kinetic: (z) => (z * z) / 2,
      eigen: (z) => -(z * z) / 2,
    };
  }
  if (kind === '2pz') {
    return {
      az: 1,
      ampA: (_rA, zA) => zA * Math.exp(-_rA / 2),
      ampB: (_rB, zB) => zB * Math.exp(-_rB / 2),
      own: (z) => z / 4,
      kinetic: (z) => (z * z) / 8,
      eigen: (z) => -(z * z) / 8,
    };
  }
  return {
    az: 0.5,
    ampA: (rA, _zA, rho) => rho * Math.exp(-rA / 2),
    ampB: (rB, _zB, rho) => rho * Math.exp(-rB / 2),
    own: (z) => z / 4,
    kinetic: (z) => (z * z) / 8,
    eigen: (z) => -(z * z) / 8,
  };
}

/**
 * Overlap, Coulomb and resonance integrals for any AO kind.
 *
 * The quadrature runs in scaled coordinates (r̃ = ζr) so one node set serves every
 * exponent; the real-space volume element (R³/8) and the prefactors are restored
 * analytically at the end.
 */
export function twoCenterIntegrals(kind: AOKind, R: number, zeta: number): TwoCenterIntegrals {
  const Rm = Math.max(R, 1e-4);
  const z = Math.max(1e-4, zeta);
  if (kind === '1s') {
    return {
      S: overlap1s(Rm, z),
      Jaa: coulomb1s(Rm, z),
      Iab: exchange1s(Rm, z),
      method: 'analytic',
    };
  }

  const shape = aoShape(kind);
  const sr = z * Rm; // scaled internuclear distance R̃ = ζR
  // The integrand decays like e^{−ξ̃}; the 1/r̃ kernels need a box of tens of 1/ζ.
  const xiMax = 1 + Math.max(10, Math.min(300, 40 / Math.max(sr, 0.2) + 12));
  const { x: gx, w: gw } = gaussLegendre(N_XI);
  const { x: hx, w: hw } = gaussLegendre(N_ETA);

  let accS = 0;
  let accJ = 0;
  let accI = 0;

  for (let a = 0; a < N_XI; a++) {
    // u ∈ (0,1) → ξ̃ ∈ (1, xiMax), a smooth compactification of the semi-infinite tail.
    const u = (gx[a] + 1) / 2;
    const oneMinus = Math.max(1e-9, 1 - u);
    const span = xiMax - 1;
    const xi = 1 + (span * u) / oneMinus;
    const dxi = (span / (oneMinus * oneMinus)) * 0.5 * gw[a];
    for (let b = 0; b < N_ETA; b++) {
      const eta = hx[b];
      const jac = xi * xi - eta * eta;
      if (jac <= 0) continue;
      const rA = (sr * (xi + eta)) / 2;
      const rB = (sr * (xi - eta)) / 2;
      if (rA <= 1e-9 || rB <= 1e-9) continue;
      const zA = (sr * (xi * eta + 1)) / 2;
      const zB = (sr * (xi * eta - 1)) / 2;
      const rho = (sr / 2) * Math.sqrt(Math.max(0, (xi * xi - 1) * (1 - eta * eta)));
      const A = shape.ampA(rA, zA, rho);
      const B = shape.ampB(rB, zB, rho);
      const wsp = dxi * hw[b] * jac;
      accS += wsp * A * B;
      accJ += (wsp * A * A) / rB;
      accI += (wsp * A * B) / rA;
    }
  }

  // φ_A φ_B = pref²·(ampA·ampB)·ampUnits; dτ = (R³/8)·2π·az·∫∫jac dξ dη.
  // Only the 2p kinds reach here (1s uses the closed forms above): their amplitudes
  // carry one factor of the *scaled* length each (z̃ = ζz, ρ̃ = ζρ), so the product is
  // ζ² too large and must be divided back out.
  const pref = aoPrefactor(kind, z);
  const K = (((pref * pref * Rm * Rm * Rm) / 8) * 2 * Math.PI * shape.az) / (z * z);
  return {
    S: K * accS,
    Jaa: K * z * accJ, // 1/r_B(real) = ζ / r̃_B
    Iab: K * z * accI,
    method: 'quadrature',
  };
}

/* ------------------------------------------------------------------ */
/* Secular problem                                                     */
/* ------------------------------------------------------------------ */

/**
 * Which algebraic sign of (φ_A ± φ_B) is bonding depends on the AO phase
 * convention. With both 2p_z functions referred to the *same* global axes, the
 * in-phase 2pσ combination has a nodal plane between the nuclei (antibonding),
 * whereas 1sσ and the side-on 2p_xπ pair bond in phase.
 */
export function comboSign(kind: AOKind, combo: ComboKind): number {
  const bondingIsInPhase = kind !== '2pz';
  const inPhase = combo === 'bonding' ? bondingIsInPhase : !bondingIsInPhase;
  return inPhase ? 1 : -1;
}

function buildState(kind: AOKind, R: number, Z: number, zeta: number, sign: number): LcaoState {
  const integ = twoCenterIntegrals(kind, R, zeta);
  const shape = aoShape(kind);
  const S = Math.min(0.995, Math.max(-0.995, integ.S));

  const Haa = shape.kinetic(zeta) - Z * shape.own(zeta) - Z * integ.Jaa;
  const Hab = shape.eigen(zeta) * S + (zeta - 2 * Z) * integ.Iab;

  const denom = 1 + sign * S;
  const partner = 1 - sign * S;
  const Eel = (Haa + sign * Hab) / denom;
  const EelPartner = (Haa - sign * Hab) / partner;
  const Vnn = (Z * Z) / Math.max(R, 1e-4);

  const T = (shape.kinetic(zeta) + sign * (shape.eigen(zeta) * S + zeta * integ.Iab)) / denom;
  const Ven = (-Z * (shape.own(zeta) + integ.Jaa + 2 * sign * integ.Iab)) / denom;

  const Elimit = atomicLimitHa(kind, Z);
  return {
    kind,
    combo: sign === comboSign(kind, 'bonding') ? 'bonding' : 'antibonding',
    sign,
    R,
    Z,
    zeta,
    S,
    N: 1 / Math.sqrt(Math.max(1e-9, 2 * (1 + sign * S))),
    Haa,
    Hab,
    Eel,
    EelPartner,
    Vnn,
    U: Eel + Vnn,
    T,
    Ven,
    Vee: 0,
    Elimit,
    depth: Elimit - (Eel + Vnn),
  };
}

/** Solve the MO for a requested combination with an explicit exponent. */
export function lcaoState(
  kind: AOKind,
  R: number,
  Z: number,
  combo: ComboKind = 'bonding',
  zeta?: number,
): LcaoState {
  return buildState(kind, Math.max(0.2, R), Z, Math.max(0.2, zeta ?? Z), comboSign(kind, combo));
}

export interface LcaoOptions {
  combo?: ComboKind;
  /** 'bare' → ζ = Z (crude curve); 'variational' → best single-ζ at each R. */
  zetaMode?: ZetaMode;
  /** Force an exponent (overrides zetaMode). */
  zeta?: number;
}

/**
 * Best single-ζ exponent at fixed R: golden-section minimisation of U(R).
 * Optimising ζ is what turns the crude ζ = Z curve (R₀ ≈ 2.5 a₀, Dₑ ≈ 0.065 Ha)
 * into the textbook variational LCAO result (R₀ ≈ 2.0 a₀, Dₑ ≈ 0.09 Ha, versus
 * the exact Born–Oppenheimer 1.997 a₀ / 0.1026 Ha).
 */
export function optimizeExponent(
  kind: AOKind,
  R: number,
  Z: number,
  combo: ComboKind = 'bonding',
): number {
  const sign = comboSign(kind, combo);
  const evalAt = (z: number) => buildState(kind, R, Z, z, sign).U;
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = 0.4 * Z;
  let b = 2.6 * Z;
  let c = b - phi * (b - a);
  let d = a + phi * (b - a);
  let fc = evalAt(c);
  let fd = evalAt(d);
  for (let i = 0; i < 26 && b - a > 0.004 * Z; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - phi * (b - a);
      fc = evalAt(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + phi * (b - a);
      fd = evalAt(d);
    }
  }
  return (a + b) / 2;
}

const ZETA_CACHE = new Map<string, number>();

/** Exponent actually used for (kind, R, Z) under the requested policy — memoised. */
export function resolveExponent(
  kind: AOKind,
  R: number,
  Z: number,
  opts: LcaoOptions = {},
): number {
  if (opts.zeta && opts.zeta > 0) return opts.zeta;
  const mode = opts.zetaMode ?? 'variational';
  if (mode === 'bare') return Z;
  const combo = opts.combo ?? 'bonding';
  const key = `${kind}|${Math.round(R * 40) / 40}|${Math.round(Z * 100) / 100}|${combo}|${mode}`;
  const hit = ZETA_CACHE.get(key);
  if (hit !== undefined) return hit;
  const z = optimizeExponent(kind, Math.max(0.2, R), Z, combo);
  ZETA_CACHE.set(key, z);
  return z;
}

/** Full MO state honouring the exponent policy (the workhorse for UI + plots). */
export function moState(kind: AOKind, R: number, Z: number, opts: LcaoOptions = {}): LcaoState {
  const combo = opts.combo ?? 'bonding';
  const zeta = resolveExponent(kind, R, Z, { ...opts, combo });
  return buildState(kind, Math.max(0.2, R), Z, zeta, comboSign(kind, combo));
}

/* ------------------------------------------------------------------ */
/* Term symbols                                                        */
/* ------------------------------------------------------------------ */

export interface MOAssignment {
  kind: AOKind;
  combo: ComboKind;
  sign: number;
  symmetry: 'sigma' | 'pi';
  parity: 'g' | 'u';
  starred: boolean;
  /** Compact label such as `1sσg` or `2pπu`. */
  label: string;
  /** LaTeX fragment for the KaTeX drawer, e.g. `\sigma_{g}(1s)`. */
  tex: string;
  /** Hund–Mulliken state string, e.g. `1σg`. */
  state: string;
  /** Bond order contributed by a single electron in this MO. */
  bondOrderOne: number;
  /** Where the node sits, for the node-plane overlay and the drawer copy. */
  nodeGeometry: 'between-nuclei' | 'molecular-plane' | 'none';
}

export function moAssignment(kind: AOKind, combo: ComboKind): MOAssignment {
  const sign = comboSign(kind, combo);
  const symmetry: 'sigma' | 'pi' = kind === '2px' ? 'pi' : 'sigma';
  // φ_A ± φ_B parity: 1s is even under inversion through the midpoint, the 2p
  // functions (global axes) are odd, so '+' is g for 1s and u for 2p.
  const aoOdd = kind !== '1s';
  const parity: 'g' | 'u' = sign === 1 ? (aoOdd ? 'u' : 'g') : aoOdd ? 'g' : 'u';
  const starred = combo === 'antibonding';
  const shell = kind === '1s' ? '1s' : '2p';
  const subSym = symmetry === 'sigma' ? 'σ' : 'π';
  const nodeGeometry: MOAssignment['nodeGeometry'] =
    combo === 'antibonding'
      ? symmetry === 'sigma'
        ? 'between-nuclei'
        : 'between-nuclei'
      : kind === '2px'
        ? 'molecular-plane'
        : 'none';
  const stateIndex = kind === '1s' ? (combo === 'antibonding' ? 2 : 1) : combo === 'antibonding' ? 3 : 2;
  return {
    kind,
    combo,
    sign,
    symmetry,
    parity,
    starred,
    label: `${shell}${subSym}${parity}${starred ? '*' : ''}`,
    tex: `${shell === '1s' ? '1s' : '2p'}\\,${symmetry === 'sigma' ? '\\sigma' : '\\pi'}_{${parity}}${starred ? '^{*}' : ''}`,
    state: `${stateIndex}${subSym}${parity}`,
    bondOrderOne: starred ? -0.5 : 0.5,
    nodeGeometry,
  };
}

/* ------------------------------------------------------------------ */
/* Potential energy curves                                             */
/* ------------------------------------------------------------------ */

export interface CurveOptions extends LcaoOptions {
  samples?: number;
  rMin?: number;
  rMax?: number;
}

/** Sample the Born–Oppenheimer curve U(R) of the chosen MO. */
export function potentialCurve(kind: AOKind, Z: number, opts: CurveOptions = {}): CurvePoint[] {
  const combo = opts.combo ?? 'bonding';
  const n = Math.max(8, Math.round(opts.samples ?? 96));
  const rMin = opts.rMin ?? 0.4;
  const rMax = opts.rMax ?? 12;
  const out: CurvePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const R = rMin + ((rMax - rMin) * i) / n;
    const st = moState(kind, R, Z, { ...opts, combo });
    out.push({ R, U: st.U, Eel: st.Eel, Vnn: st.Vnn, S: st.S });
  }
  return out;
}

/** Minimum of a sampled curve with parabolic refinement; `bound` false if none. */
export function findEquilibrium(curve: CurvePoint[], asymptoteIn?: number): Equilibrium {
  const asymptote = asymptoteIn ?? curve[curve.length - 1]?.U ?? 0;
  if (curve.length < 5) {
    return { Re: NaN, De: 0, E0: NaN, k: 0, hw: 0, asymptote, bound: false };
  }
  let best = 1;
  for (let i = 2; i < curve.length - 1; i++) if (curve[i].U < curve[best].U) best = i;
  const c0 = curve[best - 1];
  const c1 = curve[best];
  const c2 = curve[Math.min(curve.length - 1, best + 1)];
  const h = c1.R - c0.R || 1;
  const curv = c0.U - 2 * c1.U + c2.U;
  const k = curv / (h * h);
  const shift = curv !== 0 ? (0.5 * h * (c0.U - c2.U)) / curv : 0;
  const Re = c1.R + Math.max(-h, Math.min(h, shift));
  const E0 = c1.U - (curv * shift * shift) / (2 * h * h);
  const De = asymptote - E0;
  const reducedMass = 918.769; // m_p/2 in a.u. — H₂⁺ vibration
  return {
    Re,
    De,
    E0,
    k,
    hw: k > 0 ? Math.sqrt(k / reducedMass) : 0,
    asymptote,
    bound: De > 1e-4 && Number.isFinite(Re),
  };
}

/** Equilibrium constants of the LCAO curve for the given basis/charge. */
export function lcaoEquilibrium(
  kind: AOKind,
  Z: number,
  opts: CurveOptions = {},
): Equilibrium {
  const limit = atomicLimitHa(kind, Z);
  const curve = potentialCurve(kind, Z, { ...opts, samples: opts.samples ?? 96 });
  const eq = findEquilibrium(curve, limit);
  // Keep the curve's own far-field value if it has not reached the asymptote.
  return eq.bound ? eq : { ...eq, De: Math.max(0, curve[curve.length - 1].U - eq.E0) };
}

/* ------------------------------------------------------------------ */
/* Morse potential                                                     */
/* ------------------------------------------------------------------ */

/** V(R) = Dₑ(1 − e^{−a(R−R₀)})² − Dₑ : well bottom at −Dₑ, 0 as R → ∞. */
export function morseEnergy(R: number, p: MorseParams): number {
  const e = Math.exp(-p.a * (R - p.Re));
  return p.De * (1 - e) * (1 - e) - p.De;
}

/** Total H₂⁺ energy on the Morse curve: −Z²/2 + V(R). */
export function morseTotal(R: number, p: MorseParams, Z = 1): number {
  return -((Z * Z) / 2) + morseEnergy(R, p);
}

/** Harmonic vibrational quantum ℏω = a√(2Dₑ/μ) in Hartree (μ = m_p/2 for H₂⁺). */
export function morseFrequencyHa(p: MorseParams, reducedMassAU = 918.769): number {
  return p.a * Math.sqrt((2 * Math.max(p.De, 0)) / reducedMassAU);
}

/**
 * Accurate H₂⁺ (1sσg) Morse constants in atomic units:
 *   R₀ = 1.9972 a₀, Dₑ = 0.10263 Ha (2.793 eV), ℏω = 0.01044 Ha.
 * `a` is inverted from the observed vibrational quantum so the curvature at the
 * minimum matches experiment rather than the minimal-basis LCAO.
 */
export function h2PlusMorse(): MorseParams {
  const De = 0.102634;
  const Re = 1.9972;
  const hw = 0.010437;
  const a = hw / Math.sqrt(2 * De / 918.769);
  return { De, Re, a };
}

/** Morse constants sampled from the exact H₂⁺ (Kolos–Wolniewicz-style) curve. */
export const H2PLUS_REFERENCE = {
  /** a₀ */
  Re: 1.9972,
  /** Hartree */
  De: 0.102634,
  /** Hartree, total energy at the minimum */
  E0: -0.602634,
  /** Hartree */
  hw: 0.010437,
} as const;

/** Fit Morse parameters to any sampled curve (used for the 2p / high-Z cases). */
export function fitMorse(curve: CurvePoint[], asymptote?: number): MorseParams | null {
  const eq = findEquilibrium(curve, asymptote);
  if (!eq.bound || !(eq.De > 0) || !(eq.k > 0)) return null;
  return { De: eq.De, Re: eq.Re, a: Math.sqrt(eq.k / (2 * eq.De)) };
}

/* ------------------------------------------------------------------ */
/* H₂ (two-electron) closed-shell estimate                             */
/* ------------------------------------------------------------------ */

export interface H2Estimate {
  U: number;
  /** One-electron energy ε_σ of the doubly occupied MO. */
  eps: number;
  /** σ–σ electron repulsion integral J_σσ (Hartree) — the ⟨V_ee⟩ term. */
  J: number;
  Vnn: number;
  bondOrder: number;
  /** Depth relative to two separated H-like atoms (−Z² Hartree). */
  De: number;
}

/**
 * Closed-shell H₂ estimate built from the same σ MO:
 *   E(H₂) ≈ 2 ε_σ(R) + J_σσ(R) + Z²/R,
 * J_σσ from a truncated multipole expansion of the axially symmetric MO density.
 * Single-configuration (no CI / correlation), which the math drawer states.
 */
export function h2Estimate(kind: AOKind, R: number, Z: number, opts: LcaoOptions = {}): H2Estimate {
  const combo = opts.combo ?? 'bonding';
  const st = moState(kind, R, Z, { ...opts, combo });
  const rho = moDensity(kind, st.zeta, R, st.sign);
  const J = coulombSelf(rho);
  const U = 2 * st.Eel + J + st.Vnn;
  return {
    U,
    eps: st.Eel,
    J,
    Vnn: st.Vnn,
    bondOrder: combo === 'bonding' ? 1 : 0,
    De: -Z * Z - U,
  };
}

/** Axially symmetric one-electron density ρ(r, μ) about the molecular midpoint. */
export interface AxisymmetricDensity {
  at: (r: number, mu: number) => number;
  /** ∫ρ dτ — 1 for a normalised MO (used by the accuracy harness). */
  charge: () => number;
}

export function moDensity(
  kind: AOKind,
  zeta: number,
  R: number,
  sign: number,
): AxisymmetricDensity {
  const halfR = R / 2;
  const norm = 1 / (2 * (1 + sign * twoCenterIntegrals(kind, R, zeta).S));
  const at = (r: number, mu: number): number => {
    const z = r * mu;
    const x = Math.sqrt(Math.max(0, r * r * (1 - mu * mu)));
    const a = aoValue(kind, zeta, x, 0, z + halfR);
    const b = aoValue(kind, zeta, x, 0, z - halfR);
    // For the π density the azimuthal average of cos²φ contributes a factor ½.
    const az = kind === '2px' ? 0.5 : 1;
    return norm * (a * a + b * b + 2 * sign * a * b) * az;
  };
  return { at, charge: () => integrateAxisymmetric(at) };
}

/** ∫ρ dτ = 2π∫r²dr∫ρ dμ (Simpson in r, trapezoid-accurate Gauss in μ). */
export function integrateAxisymmetric(at: (r: number, mu: number) => number, rMax = 60): number {
  const nr = 400;
  const nmu = 64;
  const { x: gx, w: gw } = gaussLegendre(nmu);
  const h = rMax / nr;
  let sum = 0;
  for (let i = 1; i <= nr; i++) {
    const r = i * h;
    let ang = 0;
    for (let j = 0; j < nmu; j++) ang += gw[j] * at(r, gx[j]);
    sum += r * r * ang;
  }
  return 2 * Math.PI * h * sum;
}

/**
 * Classical electron–electron repulsion J = ∫∫ρ(r)ρ(r′)/|r−r′| d³r d³r′ of an
 * axially symmetric density, via a Legendre multipole expansion truncated at
 * `maxL`. Writing ρ = Σ_l A_l(r)P_l(μ)-moments, the addition theorem collapses to
 *   J = 4π² Σ_l ∫∫ A_l(r)A_l(r′) (r_<^l / r_>^{l+1}) r² r′² dr dr′.
 * The 1/r_> kernel is *separable*, so instead of the O(nr²·L) double loop the two
 * radial integrals are built as running sums in the scaled variable u = r/rMax ∈ (0,1]:
 *   Φ_l(r_i) = h·rMax·[ u_i^{-(l+1)} Σ_{j≤i}A_j u_j^{l+2} + u_i^{l} Σ_{j>i}A_j u_j^{1-l} ]
 *   J = 4π²·h·rMax²·Σ_l Σ_i A_i Φ_l(r_i) u_i²          (h = rMax/nr),
 * which is O(nr·L) after the angular moments — the same quadrature, ~40× faster, so a
 * slider drag can afford maxL = 16. Benchmarked against the exact hydrogenic 1s² result
 * 5ζ/8 (0.15% with this grid) and against the separated-cloud limit; the L series
 * converges fast for compact bonds (≤0.02% for R ≤ 6 a₀ at maxL = 16).
 */
export function coulombSelf(rho: AxisymmetricDensity, maxL = 16): number {
  const nr = 220;
  const nmu = 48;
  const rMax = 34;
  const { x: gx, w: gw } = gaussLegendre(nmu);
  const h = rMax / nr;
  const nl = maxL + 1;

  // A_l(r) = ∫_{-1}^{1} ρ(r,μ) P_l(μ) dμ, stored l-major over the radial index.
  const A = new Float64Array(nl * nr);
  const P = new Float64Array(nl);
  for (let i = 0; i < nr; i++) {
    const r = (i + 1) * h;
    for (let j = 0; j < nmu; j++) {
      const mu = gx[j];
      const v = gw[j] * rho.at(r, mu);
      P[0] = 1;
      if (nl > 1) P[1] = mu;
      for (let l = 2; l < nl; l++) P[l] = ((2 * l - 1) * mu * P[l - 1] - (l - 1) * P[l - 2]) / l;
      for (let l = 0; l < nl; l++) A[l * nr + i] += v * P[l];
    }
  }

  const u = new Float64Array(nr);
  for (let i = 0; i < nr; i++) u[i] = (i + 1) / nr;

  const F = new Float64Array(nr);
  let sum = 0;
  for (let l = 0; l < nl; l++) {
    const row = l * nr;
    // forward cumulative sums Σ_{j≤i} A_j u_j^{l+2}
    let acc = 0;
    for (let i = 0; i < nr; i++) {
      acc += A[row + i] * u[i] ** (l + 2);
      F[i] = acc;
    }
    // reverse cumulative sums Σ_{j>i} A_j u_j^{1-l}, folded in on the way back down
    acc = 0;
    for (let i = nr - 1; i >= 0; i--) {
      const ui = u[i];
      const ai = A[row + i];
      sum += ai * ui * ui * (F[i] / ui ** (l + 1) + ui ** l * acc);
      acc += ai / ui ** (l - 1);
    }
  }
  // φ carries h·rMax and the outer radial quadrature h·rMax², so the prefactor is h²rMax³.
  return 4 * Math.PI * Math.PI * h * h * (rMax * rMax * rMax) * sum;
}

/* ------------------------------------------------------------------ */
/* Sampling helpers (point cloud / detector flashes)                   */
/* ------------------------------------------------------------------ */

/** Real-valued MO amplitude as a closure — overlap evaluated once, not per point. */
export function moAmplitude(
  kind: AOKind,
  zeta: number,
  R: number,
  sign: number,
): (x: number, y: number, z: number) => number {
  const halfR = R / 2;
  const S = twoCenterIntegrals(kind, R, zeta).S;
  const N = 1 / Math.sqrt(Math.max(1e-9, 2 * (1 + sign * S)));
  return (x, y, z) =>
    N * (aoValue(kind, zeta, x, y, z + halfR) + sign * aoValue(kind, zeta, x, y, z - halfR));
}

/** ψ of the MO at a Cartesian point (a.u., origin at the bond midpoint). */
export function moWavefunction(
  kind: AOKind,
  zeta: number,
  R: number,
  sign: number,
  x: number,
  y: number,
  z: number,
): number {
  return moAmplitude(kind, zeta, R, sign)(x, y, z);
}

/** mulberry32 — deterministic RNG so a permalink reproduces a point cloud exactly. */
export function makeRng(seed: number): () => number {
  let a = (seed >>> 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface CloudSample {
  positions: Float32Array;
  /** Signed MO amplitude per point — drives the two-lobe phase colouring. */
  values: Float32Array;
  count: number;
  rMax: number;
  /** Peak |ψ|² found while sampling (for the opacity ramp). */
  peak: number;
}

/**
 * Rejection-sample `count` detector positions from |ψ|² of the MO.
 *
 * A uniform ball of radius R/2 + 10/ζ reaches only ~2 % acceptance for a compact
 * orbital, which costs ~200 ms per regeneration — visible stutter whenever the demo
 * sweeps `R`. The proposal here is the *exact* separated-atom density: pick a nucleus at
 * random, draw the centre-relative radius from Gamma(2ℓ+3, 2ζ/n) (r² e^{−2ζr} for 1s,
 * r⁴ e^{−ζr} for 2p) and, for the 2p shells, a direction accepted with probability
 * cos²θ / sin²θcos²φ so the angular order matches too. Only the bonding cross term
 * 2φ_Aφ_B is left to the envelope constant, which a 4000-draw scan measures; acceptance
 * lands near 70 % (1s) and 25 % (2p). Never throws; returns whatever it collected
 * (possibly fewer points).
 */
export function samplePointCloud(
  kind: AOKind,
  zeta: number,
  R: number,
  sign: number,
  count: number,
  seed = 1,
): CloudSample {
  const wanted = Math.max(64, Math.min(Math.round(count), 120000));
  const psi = moAmplitude(kind, zeta, R, sign);
  const half = R / 2;
  const rMax = half + 10 / Math.max(zeta, 0.2);
  const positions = new Float32Array(wanted * 3);
  const values = new Float32Array(wanted);
  const rng = makeRng(seed);

  const shape = kind === '1s' ? 3 : 5; // 2ℓ+3
  const beta = Math.max(0.05, kind === '1s' ? 2 * zeta : zeta); // 2ζ/n
  // ρ_centre = C·e^{−βr}·1 (1s) or C·e^{−βr}·component² (2p), C chosen so each centre
  // integrates to 1 — identical to |φ_nl|² itself, hence the near-unit envelope.
  const C =
    shape === 3
      ? beta ** 3 / (8 * Math.PI)
      : beta ** 5 / (32 * Math.PI); // β³·1/(4πΓ(3))  vs  β⁵·3/(4πΓ(5))
  const lobeZ = kind === '2pz';

  let px = 0;
  let py = 0;
  let pz = 0;
  const step = (): void => {
    let s = 0;
    for (let k = 0; k < shape; k++) s += Math.log(Math.max(rng(), 1e-12));
    const r = -s / beta;
    // Isotropic direction, kept only where the p-lobe points (accept ∝ angular factor).
    let ct = 2 * rng() - 1;
    let phi = rng() * Math.PI * 2;
    if (shape === 5) {
      for (let guard = 0; guard < 40; guard++) {
        const ux = Math.sqrt(Math.max(0, 1 - ct * ct)) * Math.cos(phi);
        if (rng() * 1 < (lobeZ ? ct * ct : ux * ux)) break;
        ct = 2 * rng() - 1;
        phi = rng() * Math.PI * 2;
      }
    }
    const st = Math.sqrt(Math.max(0, 1 - ct * ct));
    const centre = rng() < 0.5 ? -half : half; // nucleus A sits at z = −R/2
    px = r * st * Math.cos(phi);
    py = r * st * Math.sin(phi);
    pz = r * ct + centre;
  };
  // Mixture of the two centre-relative hydrogenic densities.
  const prop = (): number => {
    const dA = Math.sqrt(px * px + py * py + (pz + half) * (pz + half));
    const dB = Math.sqrt(px * px + py * py + (pz - half) * (pz - half));
    if (shape === 3) return 0.5 * C * (Math.exp(-beta * dA) + Math.exp(-beta * dB));
    const zA = pz + half;
    const zB = pz - half;
    const compA = lobeZ ? zA : px;
    const compB = lobeZ ? zB : px;
    return (
      0.5 *
      C *
      (compA * compA * Math.exp(-beta * dA) + compB * compB * Math.exp(-beta * dB))
    );
  };

  let peak = 0;
  let env = 0;
  for (let i = 0; i < 4000; i++) {
    step();
    const v = psi(px, py, pz);
    const d = v * v;
    if (d > peak) peak = d;
    const q = prop();
    if (q > 1e-300) {
      const ratio = d / q;
      if (ratio > env) env = ratio;
    }
  }
  if (!(peak > 0) || !(env > 0)) return { positions, values, count: 0, rMax, peak: 0 };
  env *= 1.06; // the scan is finite; leave a little headroom against clipping

  let n = 0;
  const maxTries = wanted * 60;
  for (let tries = 0; n < wanted && tries < maxTries; tries++) {
    step();
    const v = psi(px, py, pz);
    const d = v * v;
    if (rng() * env * prop() < d) {
      positions[n * 3] = px;
      positions[n * 3 + 1] = py;
      positions[n * 3 + 2] = pz;
      values[n] = v;
      n++;
    }
  }
  return { positions, values, count: n, rMax, peak };
}

/* ------------------------------------------------------------------ */
/* Unit conversion helpers                                             */
/* ------------------------------------------------------------------ */

/** a₀ → pm. */
export const auToPm = (r: number): number => r * BOHR_RADIUS_M * 1e12;
/** Hartree → eV. */
export const haToEv = (e: number): number => e * HARTREE_EV;
/** Hartree → kJ·mol⁻¹. */
export const haToKJ = (e: number): number => e * HARTREE_EV * 96.48533212;
/** Hartree → cm⁻¹ (vibrational quanta). */
export const haToCm = (e: number): number => e * HARTREE_EV * 8065.544;

/** Bond order = (n_bonding − n_antibonding)/2. */
export function bondOrder(nBonding: number, nAntibonding: number): number {
  return (nBonding - nAntibonding) / 2;
}
