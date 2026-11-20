import type { SimParams } from '@/simulations/types';

/**
 * de Broglie Ring — canonical state (dependency-free).
 * `radiusAU` is the orbit radius in units of a₀, `nTarget` the ideal winding
 * number the ring is being pulled toward, and the scale-explorer block carries
 * mass in kg / speed in m·s⁻¹ so λ = h/(mv) can be compared to real apparatus.
 *
 * Added keys (all canonical, all URL-serialisable):
 *   wavelengthAU — the de Broglie wavelength in a₀; free knob once `wavelengthLock`
 *                  is off (while locked it is slaved to 2πr/nTarget).
 *   lockWidth    — half-width of the phase-capture band around each integer n.
 *   showGuides   — draws the Bohr-allowed radii r = nλ/2π.
 *   logMass / logSpeed / logSlit — decade positions of the Scale Explorer rig
 *                  (log10 of massKg, speedMS, slitNm). The inspector sliders are
 *                  linear in these, which is what makes them true log controls;
 *                  the SI keys stay the source of truth for the physics.
 */
export const deBroglieDefaults: SimParams = {
  tab: 'orbit', // 'orbit' | 'scale'
  radiusAU: 5.3,
  nTarget: 1,
  nDisplay: 1,
  wavelengthLock: true, // snap λ to 2πr/n
  showWave: true,
  showStanding: true,
  showInterference: true,
  amplitude: 1,
  thickness: 2.2,
  spinPhase: 0,
  sound: true, // three-partial chime the instant 2πr = nλ locks
  sweep: false,
  sweepSpeed: 0.25,

  // Scale Explorer
  massChoice: 'electron', // 'neutron' | 'electron' | 'electron100' | 'atom' | 'baseball' | 'custom'
  massKg: 9.1093837015e-31,
  speedMS: 1e6,
  slitNm: 1,

  resScale: 1,

  wavelengthAU: 33.3, // ≈ 2π·5.3 a₀ → n = 1 at the default radius
  lockWidth: 0.08,
  showGuides: true,
  logMass: -30.0405,
  logSpeed: 6,
  logSlit: 0,
};

export default deBroglieDefaults;
