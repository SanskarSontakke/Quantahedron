/**
 * de Broglie Ring — physics core (pure, no React).
 *
 * Two coupled pictures of the same fact, λ = h/p:
 *
 *  1. **Orbit view.** A carrier e^{inθ} is wrapped on a ring of radius r. It is a
 *     legitimate matter wave only if it is single-valued, i.e. if the round-trip
 *     phase 2πn = 4π²r/λ is a whole multiple of 2π. The winding number
 *     n = 2πr/λ is therefore continuous in r and only resonant at integers.
 *     Resonance is measured as a *round-trip buildup*: after K circuits the
 *     accumulated phasor is S_K = Σ_{k<K} e^{i2πnk}, so the normalised loop
 *     integral of the phase factor is
 *         Q(n) = |S_K| / K = |sin(πnK)| / (K·|sin(πn)|)  ∈ [0, 1],
 *     which equals 1 exactly at integer n and collapses towards 0 in between —
 *     the destructive cancellation de Broglie invoked to quantise Bohr orbits.
 *     Q doubles as the amplitude of the counter-circulating partner, so
 *         ψ(θ,t) = e^{-iϖ(t)}[e^{inθ} + Q·e^{-inθ}]
 *     morphs continuously from a travelling wave (Q→0, |ψ| flat) into a true
 *     standing wave (Q→1, |ψ|² = 4cos²nθ with pinned nodes).
 *
 *  2. **Scale Explorer.** Relativistic de Broglie wavelength λ = h/(γmv) for real
 *     beams, compared against a real aperture a: the first diffracting angle is
 *     θ₁ ≈ λ/a, which is what makes macroscopic diffraction unobservable.
 */

import { BOHR_RADIUS_M, C_M_S, ELECTRON_KG, HBAR_J_S } from '@/engine/physics/constants';
import type { SimParams } from '@/simulations/types';
import { pBool, pNum } from '@/store/useSimStore';

/** Planck constant h = 2πℏ (J·s), assembled from the shared ℏ so units agree. */
export const PLANCK_J_S = 2 * Math.PI * HBAR_J_S;

/** Two-body-free reference lengths used by the Scale Explorer comparisons. */
export const PROTON_RADIUS_M = 0.84e-15;
export const PLANCK_LENGTH_M = 1.616255e-35;
export const LATTICE_GRAPHITE_NM = 0.21;

const TAU = Math.PI * 2;

/* ------------------------------- orbit state ------------------------------ */

export interface RingState {
  /** Orbit radius in units of a₀. */
  rAU: number;
  /** de Broglie wavelength in units of a₀ (the value actually drawn). */
  lamAU: number;
  /** Circumference 2πr in a₀. */
  circAU: number;
  /** Continuous winding number 2πr/λ before phase capture. */
  nRaw: number;
  /** Winding number after injection locking onto the nearest integer. */
  n: number;
  /** Signed distance from the nearest integer winding number. */
  residual: number;
  /** Normalised round-trip buildup |S_K|/K ∈ [0,1] of the rendered n. */
  quality: number;
  /** Same quantity evaluated on the *unlocked* n — the raw interference. */
  qualityRaw: number;
  /** Amplitude of the counter-circulating (wrap-around) partner = quality. */
  rho: number;
  /** True while the ring is inside the phase-capture band of an integer. */
  locked: boolean;
  /** Nearest integer winding number. */
  nInt: number;
  /** Angular wavenumber in 1/a₀. */
  kAU: number;
  /** Closure phase mismatch e^{i2πn} − 1, as an angle + magnitude. */
  seamAngle: number;
  seamMagnitude: number;
  radiusNm: number;
  wavelengthNm: number;
  /** Number of circuits used by the buildup integral. */
  circuits: number;
}

export const CIRCUITS = 16;

/** Normalised round-trip phasor buildup — the resonance curve of the ring. */
export function buildup(n: number, circuits = CIRCUITS): number {
  const s = Math.sin(Math.PI * n);
  if (Math.abs(s) < 1e-12) return 1;
  const num = Math.abs(Math.sin(Math.PI * n * circuits));
  return Math.min(1, num / (circuits * Math.abs(s)));
}

/**
 * Injection locking (Adler capture). Inside ±width of an integer the orbit is
 * pulled onto exact resonance; the blend is smooth so a dragged radius glides
 * into each Bohr orbit instead of jumping.
 */
export function lockWinding(n: number, width: number): number {
  const nearest = Math.round(n);
  const d = n - nearest;
  const a = Math.abs(d);
  if (a >= width || width <= 0) return n;
  const u = a / width;
  // Smoothstep falloff of the capture, signed toward the integer.
  const pull = 1 - u * u * (3 - 2 * u);
  return nearest + d * (1 - pull);
}

export function ringState(p: SimParams): RingState {
  const rAU = clamp(pNum(p, 'radiusAU', 5.3), 0.05, 40);
  const nTarget = clamp(pNum(p, 'nTarget', 1), 0.25, 12);
  const lockedOn = pBool(p, 'wavelengthLock', true);
  const width = clamp(pNum(p, 'lockWidth', 0.08), 0, 0.4);

  // While λ is locked to the orbit the ring is always exactly resonant at
  // nTarget; unlocking freezes λ so that dragging r sweeps n = 2πr/λ.
  const lamLock = (TAU * rAU) / nTarget;
  const lamFree = clamp(pNum(p, 'wavelengthAU', 33.301), 0.5, 200);
  const lamAU = lockedOn ? lamLock : lamFree;

  const nRaw = (TAU * rAU) / lamAU;
  const n = pBool(p, 'sweep', false)
    ? clamp(pNum(p, 'nDisplay', nRaw), 0.05, 400)
    : lockWinding(nRaw, width);
  const nInt = Math.round(n);
  const residual = n - nInt;
  const quality = buildup(n);
  const qualityRaw = buildup(nRaw);
  const seam = ((nRaw % 1) + 1) % 1;

  return {
    rAU,
    lamAU,
    circAU: TAU * rAU,
    nRaw,
    n,
    residual,
    quality,
    qualityRaw,
    rho: quality,
    locked: Math.abs(residual) < Math.max(1e-4, width * 0.6),
    nInt,
    kAU: TAU / lamAU,
    seamAngle: TAU * seam,
    seamMagnitude: 2 * Math.abs(Math.sin(Math.PI * nRaw)),
    radiusNm: rAU * BOHR_RADIUS_M * 1e9,
    wavelengthNm: lamAU * BOHR_RADIUS_M * 1e9,
    circuits: CIRCUITS,
  };
}

/**
 * Screen mapping for the orbit: apparent radius grows sub-linearly so that even
 * a 20 a₀ orbit and a 0.5 a₀ orbit stay legible inside the same stage.
 */
export function radiusToPixels(rAU: number, fitPx: number): number {
  return (fitPx * rAU) / (2.2 + 0.78 * rAU);
}

export function pixelsToRadius(px: number, fitPx: number): number {
  const denom = fitPx - 0.78 * px;
  if (denom <= 1e-6) return 40;
  return clamp((2.2 * px) / denom, 0.5, 20);
}

/* ------------------------------ scale explorer ---------------------------- */

export interface MassPreset {
  id: string;
  label: string;
  massKg: number;
  speedMS: number;
  /** What the beam is actually used for, quoted in the rig. */
  note: string;
}

/** Rest masses from CODATA; the 100 keV entry carries its accelerating voltage. */
export const MASS_PRESETS: MassPreset[] = [
  {
    id: 'neutron',
    label: 'Thermal n',
    massKg: 1.67492749804e-27,
    speedMS: 2200,
    note: '2200 m·s⁻¹ (25.3 meV) — matched to lattice spacings, so crystals diffract neutrons.',
  },
  {
    id: 'electron',
    label: 'Free e⁻',
    massKg: ELECTRON_KG,
    speedMS: 1e6,
    note: '2.85 eV electron: λ = 0.727 nm, comparable to a molecular bond spacing.',
  },
  {
    id: 'electron100',
    label: '100 keV e⁻',
    massKg: ELECTRON_KG,
    speedMS: 1.6435248e8,
    note: 'TEM accelerating voltage 100 kV ⇒ β = 0.548, γ = 1.196, λ = 3.70 pm.',
  },
  {
    id: 'atom',
    label: 'C₆₀',
    massKg: 1.1955881279e-24,
    speedMS: 200,
    note: 'Buckyball at 200 m·s⁻¹ — λ = 2.8 pm, fringed in 1999 through a 100 nm grating; molecular interference now reaches 25 000 u.',
  },
  {
    id: 'baseball',
    label: 'Cricket ball',
    massKg: 0.16,
    speedMS: 30,
    note: '0.16 kg at 30 m·s⁻¹ — λ ≈ 1.4e-34 m, 19 orders of magnitude below a proton.',
  },
  {
    id: 'custom',
    label: 'Custom',
    massKg: ELECTRON_KG,
    speedMS: 1e6,
    note: 'Free choice of mass and speed.',
  },
];

export function presetById(id: string): MassPreset | null {
  return MASS_PRESETS.find((m) => m.id === id) ?? null;
}

export interface DeBroglieSI {
  massKg: number;
  speedMS: number;
  /** Lorentz factor. */
  gamma: number;
  beta: number;
  /** Relativistic momentum γmv, kg·m·s⁻¹. */
  pSI: number;
  /** λ = h/p in metres. */
  lambdaM: number;
  /** Kinetic energy (γ−1)mc² in eV. */
  kineticEv: number;
  /** Total energy mc² in eV. */
  restEv: number;
  /** True when the relativistic correction exceeds 1 %. */
  relativistic: boolean;
  /** λ computed non-relativistically, for the error bar. */
  lambdaNonRel: number;
  apertureM: number;
  /** λ / aperture — the only number that decides whether fringes appear. */
  ratio: number;
  /** Fraunhofer scale λ/a in radians (the small-angle θ₁ used to plot the envelope). */
  thetaRad: number;
  /** Exact single-slit first null: sinθ = λ/a, saturating at 90° once λ ≥ a. */
  firstNullRad: number;
  /** λ divided by a proton charge radius. */
  lambdaOverProton: number;
}

export function deBroglieSI(p: SimParams): DeBroglieSI {
  const massKg = clamp(pNum(p, 'massKg', ELECTRON_KG), 1e-40, 1e6);
  const speedMS = clamp(pNum(p, 'speedMS', 1e6), 1e-6, C_M_S * 0.999999);
  const slitNm = clamp(pNum(p, 'slitNm', 1), 1e-9, 1e9);
  const beta = speedMS / C_M_S;
  const gamma = 1 / Math.sqrt(Math.max(1e-12, 1 - beta * beta));
  const pSI = gamma * massKg * speedMS;
  const lambdaM = PLANCK_J_S / pSI;
  const pNonRel = massKg * speedMS;
  const ratio = lambdaM / (slitNm * 1e-9);
  return {
    massKg,
    speedMS,
    gamma,
    beta,
    pSI,
    lambdaM,
    // (γ−1) evaluated as γ²β²/(1+γ): the direct difference loses ~2 % to
    // cancellation once β gets below ~10⁻⁷, which a cricket ball is.
    kineticEv: ((gamma * gamma * beta * beta) / (1 + gamma)) * massKg * C_M_S * C_M_S / 1.602176634e-19,
    restEv: (massKg * C_M_S * C_M_S) / 1.602176634e-19,
    relativistic: gamma > 1.01,
    lambdaNonRel: PLANCK_J_S / pNonRel,
    apertureM: slitNm * 1e-9,
    ratio,
    thetaRad: ratio,
    firstNullRad: ratio >= 1 ? Math.PI / 2 : Math.asin(ratio),
    lambdaOverProton: lambdaM / PROTON_RADIUS_M,
  };
}

/** Human length units: fm / pm / nm / µm / mm / m, chosen by magnitude. */
export function formatLength(metres: number, digits = 3): string {
  if (!Number.isFinite(metres) || metres <= 0) return '—';
  const table: [number, string][] = [
    [1e-15, 'fm'],
    [1e-12, 'pm'],
    [1e-9, 'nm'],
    [1e-6, 'µm'],
    [1e-3, 'mm'],
    [1, 'm'],
    [1e3, 'km'],
  ];
  let scale = table[0][0];
  let unit = table[0][1];
  for (const row of table) {
    if (metres >= row[0]) {
      scale = row[0];
      unit = row[1];
    }
  }
  const v = metres / scale;
  const shown = v >= 1000 || v < 0.01 ? v.toExponential(2) : v.toFixed(digits);
  return `${shown} ${unit}`;
}

export function formatMomentum(pSI: number): string {
  if (!Number.isFinite(pSI) || pSI <= 0) return '—';
  const exp = Math.floor(Math.log10(pSI));
  const mant = pSI / Math.pow(10, exp);
  return `${mant.toFixed(2)}×10${superscript(exp)} kg·m·s⁻¹`;
}

export function formatEnergyEv(ev: number): string {
  if (!Number.isFinite(ev) || ev <= 0) return '—';
  // Above a petal-electronvolt the natural unit is the joule, not the GeV.
  if (ev > 1e15) return `${(ev * 1.602176634e-19).toExponential(3)} J`;
  if (ev < 1e-3) return `${(ev * 1e6).toFixed(2)} µeV`;
  if (ev < 1) return `${(ev * 1e3).toFixed(2)} meV`;
  if (ev < 1e3) return `${ev.toFixed(2)} eV`;
  if (ev < 1e6) return `${(ev / 1e3).toFixed(2)} keV`;
  if (ev < 1e9) return `${(ev / 1e6).toFixed(3)} MeV`;
  return `${(ev / 1e9).toFixed(3)} GeV`;
}

const SUPER = '⁰¹²³⁴⁵⁶⁷⁸⁹';
function superscript(n: number): string {
  const neg = n < 0;
  const digits = String(Math.abs(n))
    .split('')
    .map((d) => SUPER[Number(d)])
    .join('');
  return `${neg ? '⁻' : ''}${digits}`;
}

/**
 * Angles in this sim span 20 orders of magnitude, so the unit has to move with
 * the value: arcseconds for instrument-limited beams, degrees once the fringes
 * are wide enough to see with the eye.
 */
export function formatAngle(rad: number): string {
  if (!Number.isFinite(rad) || rad <= 0) return '0″';
  const deg = (rad * 180) / Math.PI;
  if (deg >= 89.9999) return '90°';
  if (deg >= 1) return `${deg < 10 ? deg.toFixed(2) : deg.toFixed(1)}°`;
  const arcsec = rad * 206265;
  if (arcsec >= 1) return `${arcsec.toPrecision(4)}″`;
  return `${arcsec.toExponential(2)}″`;
}

/**
 * The honest verdict the Scale Explorer has to state: diffraction needs
 * λ ≳ a, and no engineered aperture comes within 19 orders of magnitude of a
 * cricket ball's λ. Environmental scattering localises it far more strongly
 * than any slit could.
 */
export function diffractionVerdict(d: DeBroglieSI): {
  headline: string;
  detail: string;
  observable: boolean;
} {
  const decades = Math.log10(PROTON_RADIUS_M / d.lambdaM);
  const angle = formatAngle(d.firstNullRad);
  const observable = d.ratio > 1e-3;
  const headline = !observable
    ? `λ = ${formatLength(d.lambdaM)} is ${decades.toFixed(1)} decades below a proton radius.`
    : d.ratio >= 1
      ? `λ/a = ${sci(d.ratio)} ≥ 1 ⇒ the slit is a point source — the beam fans out over the whole half-plane.`
      : `λ/a = ${sci(d.ratio)} ⇒ first null at θ₁ = ${angle} — measurable.`;
  const detail = observable
    ? d.ratio >= 1
      ? `An aperture of ${formatLength(d.apertureM)} is smaller than the wavelength (λ/a = ${sci(d.ratio)}), so sinθ = λ/a has no solution — there is no dark fringe at all and the slit re-radiates as a point source. That is near-field diffraction, not a grating.`
      : `An aperture of ${formatLength(d.apertureM)} puts the first single-slit null at sinθ = λ/a = ${sci(d.ratio)}, i.e. θ₁ = ${angle}. Widen that slit and the pattern collapses: once λ/a drops below 10⁻³ the whole central maximum hides inside any real detector's resolution, while narrowing it only spreads the beam further.`
    : `To see a fringe this ball needs an aperture a ≈ λ ≈ ${formatLength(d.lambdaM)} — about ${sci(
        Math.pow(10, decades),
      )}× smaller than a proton, and ${sci(
        d.lambdaM / PLANCK_LENGTH_M,
      )}× larger than the Planck length. No grating exists, and a single scattered photon (λ ≈ 500 nm) already localises the ball far better than that slit ever could, so the interference is destroyed before it could form.`;
  return { headline, detail, observable };
}

export function sci(v: number, digits = 2): string {
  if (!Number.isFinite(v) || v === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(v)));
  if (exp >= -2 && exp <= 3) return v.toFixed(Math.max(0, digits - Math.max(0, exp)));
  const mant = v / Math.pow(10, exp);
  return `${mant.toFixed(digits)}e${exp}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Unit-preserving formatting used by the inspector's log sliders. */
export function massLabel(kg: number): string {
  if (kg < 1e-24) return `${(kg / 1e-27).toFixed(2)} ×10⁻²⁷ kg`;
  if (kg < 1e-3) return `${(kg * 1e3).toFixed(3)} g`;
  return `${kg.toFixed(3)} kg`;
}

export function speedLabel(ms: number): string {
  if (ms >= 1e6) return `${(ms / 1e6).toFixed(3)} ×10⁶ m/s`;
  if (ms >= 1e3) return `${(ms / 1e3).toFixed(3)} km/s`;
  return `${ms.toFixed(1)} m/s`;
}
