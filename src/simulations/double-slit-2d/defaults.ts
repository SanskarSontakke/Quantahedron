import type { SimParams } from '@/simulations/types';

/**
 * 2D Double-Slit Interferometer — canonical state (dependency-free).
 * Geometry is in lattice units of the GPU grid; `screenHits` accumulates the
 * phosphor histogram so a permalink restores a built-up interference pattern.
 */
export const doubleSlitDefaults: SimParams = {
  slitWidth: 0.028,
  separation: 0.16,
  barrierThickness: 0.035,
  barrierX: 0.34,
  momentum: 210,
  packetY: 0.5,
  packetSigma: 0.06,

  gridRes: 512,
  dt: 0.00012,
  substeps: 2,

  singleElectron: true,
  emissionRate: 22,
  accumulate: true,
  screenBins: 220,
  screenHits: [],

  whichPath: false,
  whichPathSlit: 0, // 0 = left/upper slit, 1 = right/lower
  decoherence: 1,

  view: 'field', // 'field' | 'screen' | 'both'
  phaseColor: true,
  contrast: 1.15,
  showBarrier: true,

  /* --- added by the solver: everything below is written by the simulation --- */

  /** Multiplier on `substeps` → lattice steps per frame (beam transit speed). */
  timeScale: 2.5,
  /** Bumped by the detector tab's Clear button; wipes screen + field. */
  clearToken: 0,
  /** Render-mode mirror written by the stage keyboard (`view` follows it). */
  render: 'field',
  // Solver read-outs mirrored into params so telemetry + permalinks stay live.
  hits: 0,
  packets: 0,
  fieldNorm: 0,
  measuredV: 0,
  fringe: 0,
  engineLabel: '',
};

export default doubleSlitDefaults;
