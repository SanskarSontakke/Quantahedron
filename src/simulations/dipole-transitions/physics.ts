/**
 * physics.ts — turns the flat parameter map into every number the module shows.
 *
 * One function, three consumers (Canvas loop, telemetry pill, math drawer), so a
 * displayed value can never disagree with the value the integrator uses.
 * All angular frequencies are rad·s⁻¹, energies eV, lengths e·a₀, time ns.
 */

import { sanitizeState } from '@/engine/physics/hydrogen';
import {
  HARTREE_EV,
  HBAR_EV_S,
  seriesName,
  stateLabel,
  subshellLabel,
  transitionWavelengthNm,
} from '@/engine/physics/constants';
import type { SimParams } from '@/simulations/types';
import { pBool, pNum, pStr } from '@/store/useSimStore';
import { FIELD_TO_RABI, fieldAmplitude, intensityWCm2 } from './atom';
import { dipoleZ, type DipoleElement } from './dipole';

export interface AtomNumbers {
  i: { n: number; l: number; m: number };
  f: { n: number; l: number; m: number };
  iLabel: string;
  fLabel: string;
  Z: number;
  /** Dipole element ⟨f|ẑ|i⟩ and the selection-rule bookkeeping. */
  element: DipoleElement;
  dFi: number;
  absD: number;
  allowed: boolean;
  /** Level energies, eV (negative binding energies). */
  eI: number;
  eF: number;
  deltaE: number;
  /** ω₁₂ = ΔE/ħ, rad·s⁻¹. */
  omega0: number;
  /** Laser angular frequency ω_L = laserRel·ω₁₂. */
  laser: number;
  /** Δ = ω_L − ω₁₂. */
  detuning: number;
  /** Fractional detuning (laserRel − 1). */
  relDetune: number;
  wavelengthNm: number;
  /** Laser frequency in Hz (ν = ω/2π). */
  laserHz: number;
  laserNm: number;
  /** E₀ in V/m and the plane-wave intensity in W/cm². */
  eField: number;
  intensityWCm2: number;
  /** Ω_R = |d_fi|·E₀/ħ, rad·s⁻¹. */
  rabi: number;
  /** Ω = √(Ω_R² + Δ²). */
  omegaGen: number;
  /** γ, s⁻¹, from the `damping` slider (units of 10⁸ s⁻¹). */
  gamma: number;
  lifetimeNs: number;
  /** On-resonance π-pulse length, ns. */
  tPiNs: number;
  /** Physical ns simulated per wall second (`timeDilation`). */
  nsPerSecond: number;
  /** Generalised-Rabi period, ns. */
  periodNs: number;
  /** Slow-motion factor of the animation clock. */
  slowMotion: number;
  /** RWA validity: Ω_R / ω₁₂. */
  rwaRatio: number;
  series: string;
  /** Coupling that actually drives the ODE (zero when forbidden). */
  driveRabi: number;
  showField: boolean;
  phaseColor: boolean;
  cloudOpacity: number;
  probeForbidden: boolean;
  integrator: 'rk4' | 'exact';
}

/** Radial extent (a₀) that contains the outer lobe of the larger state. */
export function cloudExtent(n: number, Z: number): number {
  return Math.max(8, (5.5 * n * n) / Math.max(Z, 1));
}

export function computeAtom(p: SimParams): AtomNumbers {
  const Z = Math.max(1, Math.min(4, Math.round(pNum(p, 'nuclearZ', 1))));
  const i = sanitizeState(pNum(p, 'iN', 1), pNum(p, 'iL', 0), pNum(p, 'iM', 0));
  const f = sanitizeState(pNum(p, 'fN', 2), pNum(p, 'fL', 1), pNum(p, 'fM', 0));

  const element = dipoleZ(i.n, i.l, i.m, f.n, f.l, f.m, Z);
  const eI = energyHaEv(i.n, Z);
  const eF = energyHaEv(f.n, Z);
  const deltaE = eF - eI;
  const omega0 = (deltaE / HBAR_EV_S) || 0;
  const relDetune = pNum(p, 'laserRel', 1) - 1;
  const laser = omega0 * pNum(p, 'laserRel', 1);
  const detuning = laser - omega0;
  const eField = fieldAmplitude(pNum(p, 'intensity', 1));
  const rabi = element.abs * eField * FIELD_TO_RABI;
  const gamma = Math.max(0, pNum(p, 'damping', 0)) * 1e8;
  const allowed = element.allowed;

  return {
    i,
    f,
    iLabel: stateLabel(i.n, i.l, i.m),
    fLabel: stateLabel(f.n, f.l, f.m),
    Z,
    element,
    dFi: element.d,
    absD: element.abs,
    allowed,
    eI,
    eF,
    deltaE,
    omega0,
    laser,
    detuning,
    relDetune,
    wavelengthNm: transitionWavelengthNm(i.n, f.n, Z),
    laserHz: laser / (2 * Math.PI),
    laserNm: laser > 0 ? (2 * Math.PI * 299792458) / laser / 1e-9 : Infinity,
    eField,
    intensityWCm2: intensityWCm2(eField),
    rabi,
    omegaGen: Math.hypot(rabi, detuning),
    gamma,
    lifetimeNs: gamma > 0 ? 1e9 / gamma : Infinity,
    tPiNs: rabi > 0 ? (Math.PI / rabi) * 1e9 : Infinity,
    nsPerSecond: Math.max(1e-4, pNum(p, 'timeDilation', 0.02)),
    periodNs: (2 * Math.PI) / Math.max(1e-9, Math.hypot(rabi, detuning)) * 1e9,
    slowMotion: omega0 / (2 * Math.PI * OPTICAL_HZ),
    rwaRatio: rabi / Math.max(1e-9, omega0),
    series: i.n === f.n ? 'degenerate (same n)' : seriesName(Math.min(i.n, f.n)),
    driveRabi: allowed ? rabi * Math.sign(element.d || 1) : 0,
    showField: pBool(p, 'showField', true),
    phaseColor: pBool(p, 'phaseColor', true),
    cloudOpacity: Math.max(0.05, Math.min(1, pNum(p, 'cloudOpacity', 1))),
    probeForbidden: pBool(p, 'probeForbidden', false),
    integrator: pStr(p, 'integrator', 'rk4') === 'exact' ? 'exact' : 'rk4',
  };
}

/** Energy of level n for charge Z, in eV (−13.6 Z²/n²). */
export function energyHaEv(n: number, Z: number): number {
  return ((-Z * Z) / (2 * n * n)) * HARTREE_EV;
}

/** Binding energy magnitude in eV, for the read-out row. */
export const bindingEv = (n: number, Z: number): number => Math.abs(energyHaEv(n, Z));

/**
 * The optical cycle is replayed at this many Hz on screen. Everything that
 * oscillates at ω₁₂ (cloud slosh, field waveform, dipole trace) shares this one
 * strobe clock, so the visuals stay mutually consistent; the envelope dynamics
 * run on the separately dilated physical clock.
 */
export const OPTICAL_HZ = 0.42;

/** Subshell letter for a label such as "2p". */
export const orbitalLabel = (n: number, l: number): string => `${n}${subshellLabel(l)}`;

/** Identity string for a transition — used to detect when to reset the ODE. */
export function transitionKey(a: AtomNumbers): string {
  return `${a.i.n}${a.i.l}${a.i.m}-${a.f.n}${a.f.l}${a.f.m}-Z${a.Z}`;
}
