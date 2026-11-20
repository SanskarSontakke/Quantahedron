/**
 * Harmonic Oscillator — auto-demo scripts (§3.4).
 *
 * Both tours only ever name keys that exist in `defaults.ts`, so they can be
 * permalinked (`?sim=harmonic-oscillator&demo=coherent-orbit`) and scrubbed.
 * Eigenstate steps use `instant: true` so the occupied |n⟩ switches crisply
 * instead of tweening through half-integer quantum numbers.
 */

import type { DemoScript, SimParams } from '@/simulations/types';
import { MAX_LEVELS } from './physics';

/** Pure eigenstate |n⟩ written into the PhasorMatrix arrays. */
const on = (n: number): SimParams => ({
  hn: [n],
  hampAmp: [1],
  hampPhase: [0],
  levels: Math.min(MAX_LEVELS, n + 1),
});

/** Field of view that keeps |n⟩ comfortably inside the frame (A = √(2n+1)). */
const view = (n: number): number => Math.round(Math.max(4, Math.sqrt(2 * n + 1) + 2.4) * 100) / 100;

export const oscillatorDemos: DemoScript[] = [
  {
    id: 'correspondence-principle',
    label: 'Correspondence Principle',
    summary:
      'Climb the eigenstate ladder from |0⟩ to |16⟩ with the classical density overlaid: the quantum oscillations crowd together, pile up at the turning points, and the forbidden tail shrinks only as n^(-1/3) — it never quite vanishes.',
    durationSec: 62,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          ...on(0),
          dim: '1',
          coherent: false,
          omega: 1,
          view: 'density',
          showClassical: true,
          showTurningPoints: true,
          showEnvelope: true,
          phaseColor: true,
          contrast: 1.25,
          xMax: view(0),
          animate: true,
          showLadder: true,
          showPhaseSpace: true,
        },
        caption: '|0⟩: the ground state is a Gaussian of width Δx = 1/√ω = 1. It is widest exactly where the classical particle is fastest, so it is the *opposite* of the classical density.',
      },
      {
        at: 6,
        instant: true,
        params: { ...on(1), contrast: 1.2, xMax: view(1) },
        caption: 'n = 1: one node at the origin, two lobes, parity odd. ⟨x⟩ is still zero — every eigenstate is stationary, so nothing here moves.',
      },
      {
        at: 12,
        instant: true,
        params: { ...on(3), contrast: 1.15, xMax: view(3) },
        caption: 'n = 3: four lobes, three nodes. The outermost lobe already pokes past the turning point ±A = ±2.65 ℓ — into a region the classical particle can never reach.',
      },
      {
        at: 18,
        instant: true,
        params: { ...on(5), contrast: 1.05, xMax: view(5) },
        caption: 'n = 5: the amber classical curve begins to trace the envelope of |ψ|². Probability leaks past ±A = ±3.32 ℓ, where the classical particle simply stops.',
      },
      {
        at: 25,
        instant: true,
        params: { ...on(8), contrast: 0.95, xMax: view(8) },
        caption: 'n = 8: eight nodes, fringe spacing ∝ 1/k(x). The oscillations are becoming too fine to count by eye — a detector with finite resolution already sees the classical curve.',
      },
      {
        at: 32,
        instant: true,
        params: { ...on(11), contrast: 0.85, xMax: view(11) },
        caption: 'n = 11: |ψ|² averages onto P_cl(x) = 1/(π√(A²−x²)) inside the well. The forbidden tail is down to 5.8 % of the probability — shrinking only as n^(-1/3).',
      },
      {
        at: 39,
        instant: true,
        params: { view: 'reim', ...on(11), contrast: 1 },
        caption: 'Switch to Re ψ / Im ψ: an eigenstate has a *real* wavefunction, so Im ψ = 0 and the phase is pinned to 0 or π. Zero current — a standing wave, not a moving particle.',
      },
      {
        at: 45,
        instant: true,
        params: { view: 'density', ...on(14), contrast: 0.8, xMax: view(14) },
        caption: 'n = 14: the fringes crowd towards the turning points, exactly where the classical particle dawdles. Bohr’s correspondence principle, measured on screen.',
      },
      {
        at: 52,
        instant: true,
        params: { view: 'wiggle', ...on(16), contrast: 0.75, xMax: view(16) },
        caption: 'n = 16 in the Wigner channel: the positive blob sits on the classical energy shell p²/2 + ω²x²/2 = E, with faint interference ripples across x = 0.',
      },
      {
        at: 58,
        instant: true,
        params: { view: 'density', coherent: true, alphaRe: 2, alphaIm: 0, levels: 10, xMax: view(16), contrast: 1.3 },
        caption: 'And the state that actually moves like the classical oscillator is not an eigenstate at all — it is a superposition. Hand-off to the Coherent Orbit tour.',
      },
    ],
  },
  {
    id: 'coherent-orbit',
    label: 'Coherent Orbit',
    summary:
      'Build a Glauber state |α⟩ = |2⟩, watch the packet slosh between the well walls without spreading a pixel, then rotate α and lift the whole thing into 2D where it orbits the origin on a circle.',
    durationSec: 66,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          dim: '1',
          coherent: true,
          alphaRe: 0,
          alphaIm: 0,
          omega: 1,
          levels: 10,
          view: 'density',
          showClassical: false,
          showTurningPoints: true,
          showEnvelope: false,
          phaseColor: true,
          contrast: 1.4,
          xMax: 5,
          animate: true,
          showLadder: true,
          showPhaseSpace: true,
        },
        caption: 'α = 0 is just the ground state: a Gaussian sitting still at the bottom of the well with ΔxΔp = 0.500 ħ.',
      },
      {
        at: 6,
        params: { alphaRe: 2 },
        caption: 'Slide Re α up to 2. The Poisson weights peak at n = |α|² = 4 and ⟨E⟩ climbs to 4.5 ħω, yet the packet stays exactly one ground-state width wide.',
      },
      {
        at: 15,
        instant: true,
        params: { alphaRe: 2, showClassical: true, contrast: 1.2 },
        caption: 'Now it swings: ⟨x⟩(t) = √(2/ω)|α|cos(ωt) = 2.83 cos t. The dashed amber curve is what a classical particle of the same energy would do — the packet matches it.',
      },
      {
        at: 24,
        instant: true,
        params: { view: 'wiggle' },
        caption: 'Wigner channel: a single positive lump circles the origin at ω on the shell p²/2 + x²/2 = 4.5. No ripples — a coherent state is the closest thing phase space allows to a point.',
      },
      {
        at: 33,
        params: { alphaRe: 1.41, alphaIm: 1.41 },
        caption: 'Rotate α to 1.41 + 1.41i: |α| stays 2.00, but arg α = π/4 shifts the whole orbit in phase by a quarter period — the circle has merely been entered at a different point.',
      },
      {
        at: 42,
        instant: true,
        params: { view: 'reim', phaseColor: true, contrast: 1.5 },
        caption: 'Re ψ and Im ψ now visibly chase each other: ⟨p⟩ = √(2ω)|α|sin(ωt + arg α) is 90° out of step with ⟨x⟩, and the phase hue marches along x.',
      },
      {
        at: 49,
        instant: true,
        params: { dim: '2', alphaRe: 1.6, alphaIm: 0, view: 'density', showClassical: false, xMax: 5.5, contrast: 1.3 },
        caption: 'Into 2D: αₓ = α and α_y = −iα, so the packet centre traces (⟨x⟩,⟨y⟩) = √(2/ω)|α|(cos ωt, sin ωt) — a circular orbit of radius 2.26 ℓ with E = 2|α|² + 1 = 6.12 ħω.',
      },
      {
        at: 58,
        instant: true,
        params: { view: 'wiggle', contrast: 1.2 },
        caption: 'Current channel: the streamlets show Ψ*∇Ψ going round and round — a genuine, dissipation-free quantum circulation, the model for a superfluid vortex loop.',
      },
      {
        at: 66,
        instant: true,
        params: { dim: '1', view: 'density', alphaRe: 2, alphaIm: 0, contrast: 1.3 },
        caption: 'Back to 1D. ΔxΔp has never left 0.500 ħ: the coherent state is the most classical state quantum mechanics permits.',
      },
    ],
  },
];
