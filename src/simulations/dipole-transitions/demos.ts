/**
 * Dipole Transitions — guided tours for the Demo Director.
 *
 * Keyframes are ordinary parameter patches: the director tweens the numbers and
 * flips the strings/booleans at the marked instant, and the canvas reacts to
 * `replay` (re-arm the shot) and `probeForbidden` (jump to a dark line) exactly
 * as a learner clicking the same control would.
 */

import type { DemoScript } from '@/simulations/types';

export const dipoleDemos: DemoScript[] = [
  {
    id: 'pi-pulse',
    label: 'π-Pulse',
    summary:
      'Tune onto the 1s → 2p₀ line, re-arm the shot and drive the pulse area ∫Ω_R dt to exactly π — then double the field, switch on spontaneous emission and detune to watch the inversion ceiling collapse.',
    durationSec: 34,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          render: 'both',
          iN: 1,
          iL: 0,
          iM: 0,
          fN: 2,
          fL: 1,
          fM: 0,
          nuclearZ: 1,
          laserRel: 1,
          intensity: 1.2,
          damping: 0,
          timeDilation: 0.02,
          showField: true,
          phaseColor: true,
          cloudOpacity: 1,
          integrator: 'rk4',
          probeForbidden: false,
          replay: true,
        },
        caption: 'Hydrogen in 1s, laser parked exactly on the 1s → 2p₀ line: Δ = 0, so complete inversion is on the table.',
      },
      {
        at: 7,
        params: { replay: false, intensity: 1.2 },
        caption: 'Shot re-armed — c = (1, 0), t = 0, pulse area back to zero. Now watch ∫Ω_R dt climb toward π.',
      },
      {
        at: 14,
        params: { intensity: 2.4 },
        caption: 'Double E₀ and Ω_R = |d_fi|E₀/ħ doubles with it: the Rabi period halves, exactly as measured.',
      },
      {
        at: 21,
        params: { intensity: 1.2, damping: 4 },
        caption: 'Switch on spontaneous emission, γ = 4×10⁸ s⁻¹ (τ = 2.5 ns): pumping and decay fight, and the flopping decays toward a steady state.',
      },
      {
        at: 27,
        params: { damping: 0, laserRel: 1.35 },
        caption: 'Detune to ω_L = 1.35·ω₁₂. The Bloch vector can no longer reach the south pole — it only cones, capped at Ω_R²/Ω².',
      },
      {
        at: 34,
        params: { laserRel: 1 },
        caption: 'Back on resonance: w = 1 − 2P₂ sweeps pole to pole every π of pulse area. That is the π pulse.',
      },
    ],
  },
  {
    id: 'forbidden-door',
    label: 'Forbidden Door',
    summary:
      'Walk a bright line into darkness without touching the field: set Δℓ = 0, then Δℓ = +2, then Δm = ±1, and see d_fi, Ω_R, ⟨d⟩ and the cloud slosh all vanish together — then open the door again.',
    durationSec: 36,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          render: 'both',
          iN: 1,
          iL: 0,
          iM: 0,
          fN: 2,
          fL: 1,
          fM: 0,
          nuclearZ: 1,
          laserRel: 1,
          intensity: 2,
          damping: 0,
          timeDilation: 0.05,
          showField: true,
          phaseColor: true,
          integrator: 'rk4',
          probeForbidden: false,
          replay: true,
        },
        caption: 'The brightest line in the hydrogen UV: 1s → 2p₀ with d_fi = 0.744936 e·a₀ = 128√2/243.',
      },
      {
        at: 6,
        params: { replay: false, fL: 0 },
        caption: 'Change one quantum number only: ℓ′ = 0, so Δℓ = 0. Both states now have even parity.',
      },
      {
        at: 12,
        params: { intensity: 20 },
        caption: 'Push the field to its maximum — 2×10⁷ V/m. Still P₂ = 0: d_fi = 0 means Ω_R = 0 for every E₀.',
      },
      {
        at: 18,
        params: { intensity: 2, iN: 2, iL: 1, iM: 0, fN: 4, fL: 3, fM: 0 },
        caption: 'Second dark door, Δℓ = +2: 2p₀ → 4f₀. (3f is not a state of hydrogen at all — n ≥ ℓ + 1 forces f ⇒ n ≥ 4.)',
      },
      {
        at: 24,
        params: { probeCase: 'ls-2s', probeForbidden: true },
        caption: 'The dark-line probe jumps you straight there and reports the numbers: |d_fi| = 0 by quadrature to ~10⁻¹⁶, Ω_R = 0, no dipole, no radiation.',
      },
      {
        at: 30,
        params: {
          probeForbidden: false,
          iN: 1,
          iL: 0,
          iM: 0,
          fN: 2,
          fL: 1,
          fM: 0,
          intensity: 3,
          replay: true,
        },
        caption: 'Re-open the door: 1s → 2p₀ again, and the density immediately starts sloshing along ẑ at ω₁₂.',
      },
      {
        at: 36,
        params: { replay: false },
        caption: 'Same laser, same field, different symmetry: the selection rule — not the energy match — decides whether light is absorbed.',
      },
    ],
  },
];

export default dipoleDemos;
