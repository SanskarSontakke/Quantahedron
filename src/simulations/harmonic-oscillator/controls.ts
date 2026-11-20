/**
 * Harmonic Oscillator — inspector control spec.
 *
 * Three tabs of knobs: the quantum state itself (dimensionality, which |n⟩ are
 * occupied, whether we are in a Glauber state), the rendering of ψ, and the
 * physical + numerical parameters of the oscillator (ω, sampling density).
 * Every key listed here exists in `defaults.ts`, so permalinks round-trip.
 */

import type { ControlSpec, SimParams } from '@/simulations/types';
import { pBool, pNum, pStr } from '@/store/useSimStore';
import { MAX_LEVELS, coherentDepth, dimOf, moments, stateCoeffs, turningAmplitude } from './physics';

/** 2D stage mode. */
export const is2D = (p: SimParams): boolean => dimOf(p) === 2;

export const oscillatorControls: ControlSpec[] = [
  {
    kind: 'select',
    key: 'dim',
    label: 'Dimensionality',
    group: 'state',
    options: [
      { value: '1', label: '1D  ψ(x)' },
      { value: '2', label: '2D  Ψ(x,y)' },
    ],
    help: 'The 2D well is isotropic, so |nx,ny⟩ and |ny,nx⟩ are degenerate — that is what lets mix2D build genuinely two-dimensional patterns.',
  },
  {
    kind: 'slider',
    key: 'levels',
    label: 'Basis size',
    group: 'state',
    min: 1,
    max: MAX_LEVELS,
    step: 1,
    unit: '|n⟩',
    help: 'How many |n⟩ the phasor dock offers (|0⟩ … |levels−1⟩, never fewer than 10). A coherent state silently borrows extra terms when |α| needs them.',
    format: (v) => `${Math.round(v)}`,
  },
  {
    kind: 'toggle',
    key: 'coherent',
    label: 'Glauber state |α⟩',
    group: 'state',
    help: 'Replaces the hand-built superposition with cₙ = e^{−|α|²/2}αⁿ/√(n!) — the quantum state whose packet never spreads.',
  },
  {
    kind: 'slider',
    key: 'alphaRe',
    label: 'Re α',
    group: 'state',
    min: -4,
    max: 4,
    step: 0.01,
    visibleIf: (p) => pBool(p, 'coherent', false),
    help: 'In 2D this is the x-axis amplitude αₓ.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'slider',
    key: 'alphaIm',
    label: 'Im α',
    group: 'state',
    min: -4,
    max: 4,
    step: 0.01,
    visibleIf: (p) => pBool(p, 'coherent', false),
    help: 'In 2D this becomes the y-axis amplitude α_y = −i·α, so |α| ≠ 0 orbits the origin on a circle.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'toggle',
    key: 'animate',
    label: 'Time evolution',
    group: 'state',
    help: 'Applies the exact propagator cₙ → cₙe^{−i(n+½)ωt}. Off = freeze at t = 0.',
  },

  {
    kind: 'select',
    key: 'view',
    label: 'Channel',
    group: 'visuals',
    options: [
      { value: 'density', label: '|ψ|²' },
      { value: 'reim', label: 'Re ψ / Im ψ' },
      { value: 'phase', label: 'phase ribbon' },
      { value: 'wiggle', label: 'Wigner / current' },
    ],
    help: 'Wigner plots the quasi-density W(x,p) over phase space; in 2D the same channel draws the probability current instead.',
  },
  {
    kind: 'toggle',
    key: 'showClassical',
    label: 'Classical density',
    group: 'visuals',
    visibleIf: (p) => !is2D(p),
    help: 'P_cl(x) = 1/(π√(A²−x²)) for a particle with the same E — it piles up at the turning points and is strictly zero beyond them.',
  },
  {
    kind: 'toggle',
    key: 'showTurningPoints',
    label: 'Turning points ±A',
    group: 'visuals',
    visibleIf: (p) => !is2D(p),
  },
  {
    kind: 'toggle',
    key: 'showEnvelope',
    label: 'Classical allowed band',
    group: 'visuals',
    visibleIf: (p) => !is2D(p),
    help: 'Shades |x| > A, where the quantum tail ( tunnelling into the forbidden region ) is the only thing left.',
  },
  {
    kind: 'toggle',
    key: 'phaseColor',
    label: 'Phase-hued density',
    group: 'visuals',
    help: 'arg ψ → hue, |ψ|² → brightness (twilight wheel). Off = plain emerald intensity.',
  },
  {
    kind: 'slider',
    key: 'contrast',
    label: 'Exposure',
    group: 'visuals',
    min: 0.3,
    max: 3,
    step: 0.01,
    help: 'Gamma-corrected brightness gain; useful for reading the small lobes of high-n states.',
    format: (v) => `×${v.toFixed(2)}`,
  },
  {
    kind: 'slider',
    key: 'xMax',
    label: 'Window ±x',
    group: 'visuals',
    min: 2,
    max: 14,
    step: 0.05,
    unit: 'ℓ',
    help: 'Field of view in ℓ = √(ħ/mω). n = 20 needs about ±7.',
    format: (v) => v.toFixed(2),
  },

  {
    kind: 'toggle',
    key: 'showLadder',
    label: 'Energy ladder',
    group: 'plots',
    help: 'Docked plot: Eₙ = (n+½)ħω with the occupied rungs highlighted.',
  },
  {
    kind: 'toggle',
    key: 'showPhaseSpace',
    label: 'Phase-space orbit',
    group: 'plots',
    help: 'Docked plot of (⟨x⟩,⟨p⟩); a coherent state traces a circle of radius |α| at exactly ω.',
  },
  {
    kind: 'slider',
    key: 'nx2',
    label: 'nₓ',
    group: 'plots',
    min: 0,
    max: MAX_LEVELS - 1,
    step: 1,
    visibleIf: (p) => is2D(p) && !pBool(p, 'coherent', false),
    format: (v) => `${Math.round(v)}`,
  },
  {
    kind: 'slider',
    key: 'ny2',
    label: 'n_y',
    group: 'plots',
    min: 0,
    max: MAX_LEVELS - 1,
    step: 1,
    visibleIf: (p) => is2D(p) && !pBool(p, 'coherent', false),
    format: (v) => `${Math.round(v)}`,
  },
  {
    kind: 'slider',
    key: 'mix2D',
    label: 'Degenerate mix',
    group: 'plots',
    min: 0,
    max: 1,
    step: 0.01,
    visibleIf: (p) => is2D(p) && !pBool(p, 'coherent', false),
    help: 'Ψ = cos(θ)|nₓ,n_y⟩ + sin(θ)|n_y,nₓ⟩ with θ = π·mix/2. Both branches share one energy, so the result is still a true eigenstate.',
    format: (v) => `θ = ${((v * Math.PI) / 2).toFixed(2)}`,
  },

  {
    kind: 'slider',
    key: 'omega',
    label: 'Frequency ω',
    group: 'fields',
    min: 0.25,
    max: 4,
    step: 0.01,
    unit: 'ħω',
    help: 'In ħ = m = 1 units ω is also the curvature of V(x) = ½ω²x²; the ground state width is 1/√ω.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'slider',
    key: 'gridN',
    label: 'Sample density',
    group: 'fields',
    min: 128,
    max: 2048,
    step: 32,
    unit: 'pts',
    help: 'Points used to sample ψ across the window — raise it when n and ω both get large.',
    format: (v) => `${Math.round(v)}`,
  },
];

/** One-line summary of what is on screen, for cards and OG previews. */
export function describeOscillator(p: SimParams): string {
  const omega = pNum(p, 'omega', 1);
  const c = stateCoeffs(p);
  const m = moments(c, omega);
  const A = turningAmplitude(m.energy, omega);
  if (is2D(p)) {
    return `2D ${pBool(p, 'coherent', false) ? `coherent |α| = ${c.absA.toFixed(2)}` : `|${Math.round(pNum(p, 'nx2', 0))},${Math.round(pNum(p, 'ny2', 0))}⟩`} at ω = ${omega.toFixed(2)}, E = ${m.units.toFixed(2)} ħω`;
  }
  const label = c.coherent
    ? `|α = ${c.absA.toFixed(2)}e^{i${Math.atan2(c.alphaIm, c.alphaRe).toFixed(2)}}⟩`
    : `${c.ns.length}-term stack (⟨n⟩ = ${m.nbar.toFixed(2)})`;
  return `${label}: ΔxΔp = ${m.product.toFixed(3)} ħ, turning points ±${A.toFixed(2)} ℓ`;
}

/** Depth actually rendered — shared with the stage so the HUD can warn about truncation. */
export function renderDepth(p: SimParams): number {
  const levels = Math.max(1, Math.min(MAX_LEVELS, Math.round(pNum(p, 'levels', 8))));
  const absA = Math.hypot(pNum(p, 'alphaRe', 1.6), pNum(p, 'alphaIm', 0));
  return pBool(p, 'coherent', false) ? coherentDepth(absA, levels) : levels;
}

/** View channel, typed. */
export type OscView = 'density' | 'reim' | 'phase' | 'wiggle';
export const oscView = (p: SimParams): OscView => {
  const v = pStr(p, 'view', 'density');
  return v === 'reim' || v === 'phase' || v === 'wiggle' ? v : 'density';
};
