/**
 * Physical constants used across Quantahedron.
 *
 * Internally the engine works in **atomic units** (ℏ = mₑ = e = 4πϵ₀ = 1)
 * because the hydrogenic wavefunctions are then polynomial-clean. Conversion
 * helpers are exported for anything that must be shown in SI / eV / nm.
 */

/** Hartree → eV */
export const HARTREE_EV = 27.211386245988;
/** Bohr radius a₀ in metres */
export const BOHR_RADIUS_M = 5.29177210903e-11;
/** ℏ in eV·s */
export const HBAR_EV_S = 6.582119569e-16;
/** ℏ in J·s */
export const HBAR_J_S = 1.054571817e-34;
/** Speed of light, m/s */
export const C_M_S = 299792458;
/** Planck constant, eV·s */
export const PLANCK_EV_S = 4.135667696e-15;
/** Electron mass, kg */
export const ELECTRON_KG = 9.1093837015e-31;
/** Elementary charge, C */
export const E_CHARGE_C = 1.602176634e-19;
/** Rydberg constant, 1/m */
export const RYDBERG_M = 1.0973731568160e7;
/** μ_B in eV/T (Bohr magneton) */
export const BOHR_MAGNETON_EV_PER_T = 5.788381806e-5;
/** 1 V/m expressed as atomic units of field (E_h/(e·a₀) ≈ 5.142206748e11 V/m) */
export const ATOMIC_FIELD_V_PER_M = 5.142206748e11;
/** Atomic unit of time in seconds */
export const ATOMIC_TIME_S = 2.4188843265857e-17;

/** Hydrogen ionization energy, eV (Z = 1, n = 1). */
export const IONIZATION_EV = 13.605693122994;

/** Maximum principal quantum number the UI unlocks (s p d f g h i). */
export const MAX_N = 7;

/** Subshell letters indexed by ℓ. */
export const SUBSHELL_LETTERS = ['s', 'p', 'd', 'f', 'g', 'h', 'i'] as const;

export interface Complex {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Complex => ({ re, im });
export const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im });
export const cMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});
export const cScale = (a: Complex, s: number): Complex => ({ re: a.re * s, im: a.im * s });
export const cConj = (a: Complex): Complex => ({ re: a.re, im: -a.im });
export const cAbs2 = (a: Complex): number => a.re * a.re + a.im * a.im;
export const cAbs = (a: Complex): number => Math.hypot(a.re, a.im);
export const cArg = (a: Complex): number => Math.atan2(a.im, a.re);

export function subshellLabel(l: number): string {
  return SUBSHELL_LETTERS[Math.min(l, SUBSHELL_LETTERS.length - 1)];
}

/** Dirac-ket friendly label such as "3d(z²)" or "2p,+1". */
export function stateLabel(n: number, l: number, m: number): string {
  return `${n}${subshellLabel(l)}${m === 0 ? '' : m > 0 ? `·m${m}` : `·m${m}`}`;
}

/** Transition wavelength in nm for hydrogen-like atoms (infinite nuclear mass). */
export function transitionWavelengthNm(nFrom: number, nTo: number, Z = 1): number {
  const lo = Math.min(nFrom, nTo);
  const hi = Math.max(nFrom, nTo);
  if (hi === lo) return Infinity;
  const invLambda = RYDBERG_M * Z * Z * (1 / (lo * lo) - 1 / (hi * hi));
  return 1e9 / invLambda;
}

/** Series name for a drop ending on `nLower`. */
export function seriesName(nLower: number): string {
  switch (nLower) {
    case 1:
      return 'Lyman';
    case 2:
      return 'Balmer';
    case 3:
      return 'Paschen';
    case 4:
      return 'Brackett';
    case 5:
      return 'Pfund';
    default:
      return 'Humphreys';
  }
}

/** Map a vacuum wavelength (nm) to an approximate sRGB triplet. */
export function wavelengthToRGB(nm: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm < 380) {
    // Not visible — render as deep violet so UV lines stay legible.
    return [0.45, 0.2, 0.75];
  }
  if (nm < 440) {
    r = -(nm - 440) / (440 - 380);
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / (490 - 440);
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = -(nm - 510) / (510 - 490);
  } else if (nm < 580) {
    r = (nm - 510) / (580 - 510);
    g = 1;
  } else if (nm < 645) {
    r = 1;
    b = -(nm - 645) / (645 - 580);
  } else if (nm <= 781) {
    r = 1;
  } else {
    return [0.6, 0.15, 0.15];
  }
  let factor = 1;
  if (nm > 700) factor = 0.3 + (0.7 * (780 - nm)) / 80;
  else if (nm < 420) factor = 0.3 + (0.7 * (nm - 380)) / 40;
  const gamma = 0.8;
  return [
    Math.pow(Math.max(0, r) * factor, gamma),
    Math.pow(Math.max(0, g) * factor, gamma),
    Math.pow(Math.max(0, b) * factor, gamma),
  ];
}
