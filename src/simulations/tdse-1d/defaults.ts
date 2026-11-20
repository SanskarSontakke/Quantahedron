import type { SimParams } from '@/simulations/types';

/**
 * 1D TDSE Sandbox — canonical state (dependency-free).
 * `customV` is the brush-drawn potential on a normalised 0..1 grid (empty when a
 * preset is in use); the Crank–Nicolson worker reads it verbatim.
 */
export const tdse1dDefaults: SimParams = {
  potential: 'double', // 'infinite' | 'finite' | 'double' | 'kronig' | 'custom'
  V0: 8, // Hartree-scaled well depth
  wellWidth: 0.34, // fraction of the domain
  barrierGap: 0.18,
  kronigPeriods: 6,
  latticeDepth: 6,
  asymmetry: 0,
  customV: [], // brush strokes, length = grid samples

  // Wavepacket
  x0: 0.5,
  sigma: 0.05,
  k0: 60,
  packetAmp: 1,

  // Numerics
  gridN: 512,
  dt: 0.0004,
  stepsPerFrame: 3,
  capWidth: 0.06,
  capStrength: 0.35,

  // View
  view: 'density', // 'density' | 'reim' | 'spectrum' | 'absorbing'
  /** Mirror of `view` written by the 1–4 keyboard map (see SimulationContainer). */
  render: 'density',
  showReal: true,
  showImag: true,
  showPotential: true,
  showEigen: true,
  colorPhase: true,
  logDensity: false,
  yScale: 1,
  eigenCount: 12,

  // Brush (only when potential === 'custom')
  brushSize: 0.05, // stroke radius, fraction of the domain
  brushErase: false, // paint holes instead of walls
};

export default tdse1dDefaults;
