import type { SimParams } from '@/simulations/types';

/**
 * Heisenberg Uncertainty & Fourier Wavepacket Forge — canonical state
 * (dependency-free). `drawnWave` stores freehand samples in the −1..1 range;
 * an empty array means "use the analytic envelope".
 */
export const uncertaintyDefaults: SimParams = {
  envelope: 'gauss', // 'gauss' | 'square' | 'lorentz' | 'custom'
  width: 0.6, // σ_x in lattice units
  chirp: 0, // quadratic phase ⇒ momentum spread without narrowing ψ
  center: 0,
  tilt: 0, // linear phase ⇒ mean momentum

  drawnWave: [],
  brushSize: 12,

  gridN: 512,
  xMax: 12,
  evolve: true,
  evolveTime: 0,
  dt: 0.0008,

  showPhase: true,
  showGauge: true,
  logMagnitude: false,
  phaseColor: true,

  // Layout + integration knobs owned by this module.
  view: 'both', // 'both' | 'position' | 'momentum'
  substeps: 3, // spectral propagator calls per frame at nominal speed
  drawClear: 0, // bump to wipe the freehand buffer everywhere

  // Read-outs mirrored back by ForgeCanvas (4 Hz) so pills + permalinks stay live.
  sigmaX: 0,
  sigmaP: 0,
  product: 0,
  meanX: 0,
  meanP: 0,
  energy: 0,
  waveNorm: 0,
  analyticProduct: 0,
  sigma0: 0,
};

export default uncertaintyDefaults;
