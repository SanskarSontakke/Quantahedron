import type { SimParams } from '@/simulations/types';

/**
 * Quantum Tunneling & Barrier Lab — canonical state (dependency-free).
 *
 * Energies are in the sim's Hartree-like unit with ℏ = 1 and a tunable mass;
 * `E0` is the packet's mean kinetic energy measured in the V = 0 leads, so the
 * central wavenumber is exactly k₀ = √(2·m·E₀). Lengths named `width`, `gap`,
 * `packetX`, `capWidth`, `stmHeight` are fractions of the 24 a.u. domain.
 */
export const tunnelingDefaults: SimParams = {
  barrier: 'rect', // 'rect' | 'tri' | 'double'
  V0: 12,
  width: 0.04, // barrier width a, fraction of the domain (0.96 a.u.)
  gap: 0.1, // double-barrier separation
  tilt: 0.5, // triangular ramp fraction

  E0: 7,
  sigmaK: 12, // Δk = sigmaK / domain  ⇒ σ_x = 1 a.u.
  packetX: 0.16,
  mass: 1,

  gridN: 1024,
  dt: 0.002,
  stepsPerFrame: 8,
  capWidth: 0.07,
  capStrength: 0.45,

  view: 'both', // 'wave' | 'transmission' | 'both'
  showAnalytical: true,
  showEvanescent: true,
  showPotential: true,
  showReIm: false,
  logDensity: false,
  logT: true,
  energyScan: 0, // 0 = probe at E0, otherwise override the probe energy
  stmMode: false,
  stmBias: 0.4,
  stmHeight: 0.05, // tip–sample set point, fraction of the domain
  stmAmp: 0.45, // adsorbate height, fraction of the set point
  stmContrast: 0.35, // barrier lowering over an atom
  colorPhase: true,
  /** Bumped by the on-canvas "launch" chip to re-fire the packet unchanged. */
  launchToken: 0,
};

export default tunnelingDefaults;
