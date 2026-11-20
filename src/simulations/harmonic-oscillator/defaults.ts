import type { SimParams } from '@/simulations/types';

/**
 * Harmonic Oscillator & Coherent States — canonical state (dependency-free).
 * Eigenstate stacking uses parallel arrays (hn / hampl / hphase) exactly like
 * Orbitalis 3D so the shared PhasorMatrix component can drive it.
 */
export const oscillatorDefaults: SimParams = {
  // '1' | '2' — string-valued because the inspector renders it with a select,
  // which writes strings back into the store.
  dim: '1',
  omega: 1,
  xMax: 7,
  gridN: 512,

  // Superposition Σ cₙ|n⟩
  levels: 8,
  hn: [0],
  hampAmp: [1],
  hampPhase: [0],

  // Glauber coherent state |α⟩ (overrides the stack when enabled)
  coherent: false,
  alphaRe: 1.6,
  alphaIm: 0,

  view: 'density', // 'density' | 'reim' | 'phase' | 'wiggle'
  showClassical: true,
  showTurningPoints: true,
  showEnvelope: true,
  phaseColor: true,
  contrast: 1,

  // 2D mode
  nx2: 0,
  ny2: 0,
  /** Weight of the degenerate partner |ny,nx⟩ (0 = pure product state). */
  mix2D: 0,

  animate: true,

  /* --- keys added by the module ------------------------------------------
   * PhasorMatrix edits five parallel arrays, so the ℓ/m slots of the |n⟩
   * basis (always 0 here) need keys of their own; the two toggles dock the
   * energy ladder and the phase-space orbit in the stage.
   */
  hampL: [0],
  hampM: [0],
  showLadder: true,
  showPhaseSpace: true,
};

export default oscillatorDefaults;
