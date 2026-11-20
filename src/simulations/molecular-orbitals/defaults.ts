import type { SimParams } from '@/simulations/types';

/**
 * Molecular Orbitals & LCAO Bonding — canonical state (dependency-free).
 * `R` is the internuclear distance in a₀; `combo` selects ψ_A ± ψ_B and
 * `ao` the atomic basis being combined (1s, 2pσ, 2pπ). `zetaMode` decides
 * whether the AO exponent tracks the bare nuclear charge (ζ = Z, the crude
 * curve) or is re-optimised at every R (single-ζ variational, the good curve).
 */
export const molecularDefaults: SimParams = {
  R: 2,
  ao: '1s', // '1s' | '2pz' | '2px'
  combo: 'bonding', // 'bonding' | 'antibonding'
  Z: 1,
  zetaMode: 'variational', // 'variational' | 'bare'
  cloudCount: 20000,

  render: 'raymarch', // 'raymarch' | 'isosurface' | 'pointcloud'
  isoLevel: 0.35,
  exposure: 1.2,
  gamma: 2.2,
  monochrome: false,
  showNuclei: true,
  showNodePlane: true,

  // Potential energy curve
  showCurve: true,
  curveModel: 'morse', // 'morse' | 'exact1s'
  markEquilibrium: true,

  camAz: 0.5,
  camEl: 0.22,
  camDist: 18,
};

export default molecularDefaults;
