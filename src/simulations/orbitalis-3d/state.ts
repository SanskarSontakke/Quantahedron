/**
 * Orbitalis 3D — state layer.
 *
 * Translates the flat store slice into the physics objects the renderer needs:
 * the active |n ℓ m⟩ basis (complex eigenstates, real chemistry orbitals or
 * hybridised lobes), per-state energies including the Zeeman shift and the
 * degenerate-subspace Stark mixing, and the scene extent.
 *
 * Nothing here touches WebGL or React, so the bake pass, the plots and the demo
 * director can all share it.
 */

import type { SimParams } from '@/simulations/types';
import {
  HYBRID_PRESETS,
  energyHa,
  hybridToAmplitudes,
  mergeAmplitudes,
  normalizeAmplitudes,
  realOrbital,
  sanitizeState,
  type Amplitude,
} from '@/engine/physics/hydrogen';
import { BOHR_MAGNETON_EV_PER_T, HARTREE_EV, subshellLabel } from '@/engine/physics/constants';
import { pArr, pNum, pStr } from '@/store/useSimStore';

export interface OrbitalState {
  amps: Amplitude[];
  Z: number;
  /** Atomic-unit energy per slot including field corrections (ℏ = 1). */
  omega: number[];
  /** Zeeman shift per slot, eV (for telemetry only). */
  zeemanEv: number[];
  /** Field-free energies, eV. */
  energyEv: number[];
  /** Linear Stark shift per slot, atomic units (for the visual frequency). */
  starkHa: number[];
  /** Orbital Zeeman shift m·μ_B·B per slot, atomic units. */
  zeemanHa: number[];
  /** Scene half-extent in a₀ — the volume the raymarcher integrates over. */
  rBox: number;
  /** Largest n present, used for rBox and the energy ladder. */
  nMax: number;
  /** Number of slots actually used (≤ 4 in the raymarcher). */
  count: number;
}

export const MAX_SLOTS = 4;

/** Read the superposition straight out of the parallel amplitude arrays. */
export function ampsFromParams(p: SimParams, basis?: string): Amplitude[] {
  const ns = pArr(p, 'ampsN');
  const ls = pArr(p, 'ampsL');
  const ms = pArr(p, 'ampsM');
  const as = pArr(p, 'ampsAmp');
  const ps = pArr(p, 'ampsPhase');
  const out: Amplitude[] = [];
  for (let i = 0; i < as.length; i++) {
    const amp = as[i] ?? 0;
    if (amp <= 1e-4) continue;
    const s = sanitizeState(ns[i] ?? 1, ls[i] ?? 0, ms[i] ?? 0);
    out.push({ ...s, amp, phase: ps[i] ?? 0 });
  }
  if (out.length === 0) out.push({ n: 1, l: 0, m: 0, amp: 1, phase: 0 });
  const kind = basis ?? pStr(p, 'basis', 'complex');
  // In the real ("chemistry") basis each ℓ>0 component is re-expressed through
  // its Cartesian partner — a genuine change of basis, not a visual trick.
  if (kind === 'real') return realBasisAmps(out.slice(0, MAX_SLOTS));
  return out.slice(0, MAX_SLOTS);
}

/** Σ_m |term| of the real-orbital expansion, keeping cross-orbital coherence. */
export function realBasisAmps(list: Amplitude[]): Amplitude[] {
  const expanded: Amplitude[] = [];
  for (const a of list) {
    // Only p (ℓ=1) and d (ℓ=2) Cartesian forms are modelled; f and higher stay
    // in the complex |ℓ m⟩ basis, which is what the engine expands exactly.
    const kind =
      a.l === 1 ? (a.m > 0 ? 'x' : 'y') : a.l === 2 ? (Math.abs(a.m) === 2 ? (a.m > 0 ? 'x2y2' : 'xy') : a.m > 0 ? 'xz' : 'yz') : null;
    if (a.m === 0 || !kind) {
      expanded.push(a);
      continue;
    }
    const orb = realOrbital(a.n, a.l, kind);
    for (const t of orb.terms) {
      const mag = Math.hypot(t.re, t.im);
      if (mag < 1e-6) continue;
      expanded.push({
        n: t.state.n,
        l: t.state.l,
        m: t.state.m,
        amp: a.amp * mag,
        phase: a.phase + Math.atan2(t.im, t.re),
      });
    }
  }
  return normalizeAmplitudes(mergeAmplitudes(expanded)).slice(0, MAX_SLOTS);
}

/** Real-orbital label → (ℓ, kind) pair used by hydrogen.ts `realOrbital`. */
const REAL_KINDS: Record<string, { l: number; kind: string }> = {
  s: { l: 0, kind: 's' },
  pz: { l: 1, kind: 'z' },
  px: { l: 1, kind: 'x' },
  py: { l: 1, kind: 'y' },
  dz2: { l: 2, kind: 'z2' },
  dxz: { l: 2, kind: 'xz' },
  dyz: { l: 2, kind: 'yz' },
  dx2y2: { l: 2, kind: 'x2y2' },
  dxy: { l: 2, kind: 'xy' },
  fz3: { l: 3, kind: 'z3' },
};

export interface OrbitalPreset {
  id: string;
  label: string;
  n: number;
  l: number;
  m: number;
  kind: keyof typeof REAL_KINDS;
  latex: string;
}

/** Curated quick-pick list shown in the inspector and used by the tours. */
export const ORBITAL_PRESETS: OrbitalPreset[] = [
  { id: '1s', label: '1s', n: 1, l: 0, m: 0, kind: 's', latex: '1s' },
  { id: '2s', label: '2s', n: 2, l: 0, m: 0, kind: 's', latex: '2s' },
  { id: '2p0', label: '2p₀', n: 2, l: 1, m: 0, kind: 'pz', latex: '2p_z' },
  { id: '2px', label: '2p_x', n: 2, l: 1, m: 1, kind: 'px', latex: '2p_x' },
  { id: '2py', label: '2p_y', n: 2, l: 1, m: 1, kind: 'py', latex: '2p_y' },
  { id: '3s', label: '3s', n: 3, l: 0, m: 0, kind: 's', latex: '3s' },
  { id: '3p0', label: '3p₀', n: 3, l: 1, m: 0, kind: 'pz', latex: '3p_z' },
  { id: '3dz2', label: '3d_z²', n: 3, l: 2, m: 0, kind: 'dz2', latex: '3d_{z^2}' },
  { id: '3dxy', label: '3d_xy', n: 3, l: 2, m: 2, kind: 'dxy', latex: '3d_{xy}' },
  { id: '3dx2y2', label: '3d_x²⁻ʸ²', n: 3, l: 2, m: 2, kind: 'dx2y2', latex: '3d_{x^2-y^2}' },
  { id: '4fz3', label: '4f_z³', n: 4, l: 3, m: 0, kind: 'fz3', latex: '4f_{z^3}' },
  { id: '4fxyz', label: '4f_xyz', n: 4, l: 3, m: 1, kind: 'fz3', latex: '4f_{xyz}' },
];

/** Expand a preset through the requested basis (complex |nℓm⟩ vs real p/d/f). */
export function presetToAmps(preset: OrbitalPreset, basis: string): Amplitude[] {
  if (basis === 'complex' || preset.l === 0) {
    return [{ n: preset.n, l: preset.l, m: preset.m, amp: 1, phase: 0 }];
  }
  const kind = REAL_KINDS[preset.kind] ?? { l: preset.l, kind: 's' };
  const orb = realOrbital(preset.n, kind.l, kind.kind);
  return orb.terms
    .filter((t) => Math.hypot(t.re, t.im) > 1e-6)
    .map((t) => ({
      n: t.state.n,
      l: t.state.l,
      m: t.state.m,
      amp: Math.hypot(t.re, t.im),
      phase: Math.atan2(t.im, t.re),
    }));
}

/** Hybrid preset id → eigenstate amplitudes (n = 2 manifold). */
export function hybridAmps(id: string): Amplitude[] {
  if (!id || id === 'none') return [];
  const found = HYBRID_PRESETS.find((h) => h.id === id);
  if (!found) return [];
  return hybridToAmplitudes(found.id, 2);
}

/**
 * Scene extent. Hydrogenic clouds scale as n²/Z, so the box is chosen from the
 * largest n present; clamped so a 7i orbital still renders at useful resolution.
 */
export function sceneExtent(nMax: number, Z: number): number {
  const extent = (3.6 * nMax * nMax) / Math.max(Z, 0.5);
  return Math.min(150, Math.max(4, extent));
}

/**
 * Build the full render state.
 *
 * Zeeman: with ℏ = 1 the shift of |nℓm⟩ in a B field is m·μ_B·B, added to the
 * orbital frequency so precession phases separate exactly as the physics says.
 * Stark (linear, degenerate n = 2 manifold): the 2s–2p₀ pair is rotated by the
 * mixing angle tan 2θ = 3Z̃F/ΔE₂, which is the textbook degenerate-perturbation
 * result; the rotated pair also picks up the ±3F/2 first-order splitting.
 */
export function buildOrbitalState(p: SimParams): OrbitalState {
  const Z = Math.max(0.4, pNum(p, 'Z', 1));
  const B = pNum(p, 'zeemanB', 0); // Tesla
  const F = pNum(p, 'starkE', 0) * 1e9 / 5.142206748e11; // 1e9 V/m → a.u.
  let amps = ampsFromParams(p);

  const basis = pStr(p, 'basis', 'complex');
  if (basis === 'hybrid') {
    const h = hybridAmps(pStr(p, 'hybrid', 'sp3'));
    if (h.length) amps = normalizeAmplitudes(mergeAmplitudes(h)).slice(0, MAX_SLOTS);
  }

  const bAu = (B * BOHR_MAGNETON_EV_PER_T) / HARTREE_EV; // μ_B·B in Hartree

  const omega: number[] = [];
  const zeemanEv: number[] = [];
  const zeemanHa: number[] = [];
  const starkHa: number[] = [];
  const energyEv: number[] = [];

  for (const a of amps) {
    const bare = energyHa(a.n, Z);
    let eHa = bare;
    const shiftHa = a.m * bAu;

    // Linear Stark effect inside the degenerate n = 2 manifold: 2p₀ is pushed up,
    // 2s down by 3Z̃F/2 — the textbook degenerate-perturbation eigenvalues.
    if (Math.abs(F) > 1e-12 && a.n === 2 && a.m === 0) {
      eHa += a.l === 1 ? 1.5 * F * Z : -1.5 * F * Z;
    }

    omega.push(eHa + shiftHa);
    energyEv.push(eHa * HARTREE_EV);
    starkHa.push(eHa - bare);
    zeemanHa.push(shiftHa);
    zeemanEv.push(shiftHa * HARTREE_EV);
  }

  const nMax = amps.reduce((m, a) => Math.max(m, a.n), 1);

  return {
    amps,
    Z,
    omega,
    energyEv,
    zeemanEv,
    zeemanHa,
    starkHa,
    nMax,
    count: Math.min(amps.length, MAX_SLOTS),
    rBox: sceneExtent(nMax, Z),
  };
}

/* -------------------------------------------------------------------------- */
/* Visual time scale                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One atomic unit of time is 2.42e-17 s, so the true Coulomb frequencies
 * (|E₂−E₃| ≈ 1.9e-2 a.u.) beat ~20 Hz for a static image — a blur or a freeze.
 * The renderer therefore evolves a *rescaled* phase clock: the Coulomb gaps are
 * magnified down and the (tiny) field splittings up, preserving the RATIOS inside
 * each effect so the precession and beat structure stays qualitatively correct.
 * Every numeric read-out in the drawer quotes the true, unscaled period.
 */
export const COULOMB_VIS_GAIN = 2.0e-3;
export const FIELD_VIS_GAIN = 2.2e4;

/** Mean-subtracted display frequencies for the shader (global phase is invisible). */
export function displayOmega(state: OrbitalState): number[] {
  const n = state.amps.length;
  if (!n) return [];
  const scaled = state.amps.map((a, i) => {
    const coulomb = energyHa(a.n, state.Z) * COULOMB_VIS_GAIN;
    const field = ((state.starkHa[i] ?? 0) + (state.zeemanHa[i] ?? 0)) * FIELD_VIS_GAIN;
    return coulomb + field;
  });
  const mean = scaled.reduce((x, y) => x + y, 0) / n;
  return scaled.map((v) => v - mean);
}

/** Beat period between the two most populated slots, in display seconds. */
export function beatPeriodSec(state: ArrayLike<number>, omegaVis: number[]): number | null {
  if (state.length < 2) return null;
  let bestGap = 0;
  let bestPair: [number, number] | null = null;
  const amps = Array.from(state as ArrayLike<number>);
  for (let i = 0; i < amps.length; i++) {
    for (let j = i + 1; j < amps.length; j++) {
      const weight = Math.min(amps[i], amps[j]);
      const dw = Math.abs(omegaVis[i] - omegaVis[j]);
      if (dw > 1e-9 && weight > Math.abs(bestGap)) {
        bestGap = weight;
        bestPair = [i, j];
      }
    }
  }
  if (!bestPair) return null;
  const dw = Math.abs(omegaVis[bestPair[0]] - omegaVis[bestPair[1]]);
  return dw > 1e-9 ? (2 * Math.PI) / dw : null;
}

/** Dirac-ket string for the telemetry pill, e.g. √½|1,0,0⟩ + √½|2,1,0⟩. */
export function ketString(amps: Amplitude[]): string {
  const parts = amps.map((a) => {
    const amp2 = a.amp * a.amp;
    const pref = Math.abs(amp2 - 1) < 1e-3 ? '' : `${sqrtFraction(amp2)}·`;
    const ph =
      Math.abs(a.phase) < 1e-3 || amp2 < 1e-6
        ? ''
        : `e^{i${(a.phase / Math.PI).toFixed(2)}\\pi}`;
    return `${pref}${ph}\\,|${a.n},${a.l},${a.m}⟩`;
  });
  return parts.join(' + ').replace(/\+ e/g, '+ e');
}

function sqrtFraction(v: number): string {
  if (Math.abs(v - 0.5) < 1e-3) return '\\tfrac{1}{\\sqrt{2}}';
  if (Math.abs(v - 1 / 3) < 1e-3) return '\\tfrac{1}{\\sqrt{3}}';
  if (Math.abs(v - 0.25) < 1e-3) return '\\tfrac{1}{2}';
  if (Math.abs(v - 0.75) < 1e-3) return '\\tfrac{\\sqrt3}{2}';
  return v.toFixed(2);
}

/** Compact |nℓm⟩ label with the subshell letter, e.g. 3d(z²). */
export function shortLabel(a: Amplitude): string {
  return `${a.n}${subshellLabel(a.l)}${a.m === 0 ? '' : a.m > 0 ? `·m${a.m}` : `·m${a.m}`}`;
}

/** Expectation values shown in the telemetry pill. */
export function expectations(state: OrbitalState): {
  eAvg: number;
  L2: number;
  Lz: number;
} {
  let eAvg = 0;
  let L2 = 0;
  let Lz = 0;
  let norm = 0;
  for (const a of state.amps) {
    const w = a.amp * a.amp;
    norm += w;
    eAvg += w * (state.energyEv[state.amps.indexOf(a)] ?? 0);
    L2 += w * a.l * (a.l + 1);
    Lz += w * a.m;
  }
  if (norm <= 0) norm = 1;
  return { eAvg: eAvg / norm, L2: Math.sqrt(L2 / norm), Lz: Lz / norm };
}
