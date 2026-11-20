/**
 * Dipole Transitions — inspector control spec.
 *
 * Three groups: the atom (which two hydrogenic levels the laser is allowed to
 * talk about), the drive (frequency, amplitude, decay, time scale) and the
 * viewport. `sanitizeState` clamps ℓ and m against n, so the quantum-number
 * sliders can be swept freely — the labels and the telemetry always report the
 * state that is actually being integrated.
 */

import { stateLabel } from '@/engine/physics/constants';
import { pNum } from '@/store/useSimStore';
import type { ControlSpec, SimParams } from '@/simulations/types';

export const dipoleControls: ControlSpec[] = [
  /* ------------------------------- the atom ------------------------------- */
  {
    kind: 'slider',
    key: 'iN',
    label: 'Initial n′',
    group: 'state',
    min: 1,
    max: 7,
    step: 1,
    help: 'Principal quantum number of the lower state |i⟩ = |nℓm⟩. Clamped to 1…7 (the hydrogenic engine truncates at MAX_N).',
    format: (v) => String(Math.round(v)),
  },
  {
    kind: 'slider',
    key: 'iL',
    label: 'Initial ℓ',
    group: 'state',
    min: 0,
    max: 6,
    step: 1,
    help: 'Orbital angular momentum of |i⟩. Clamped to n′ − 1.',
    format: (v) => String(Math.round(v)),
  },
  {
    kind: 'slider',
    key: 'iM',
    label: 'Initial m',
    group: 'state',
    min: -6,
    max: 6,
    step: 1,
    help: 'Projection of |i⟩ on the field axis ẑ. A π (ẑ-polarised) photon carries m = 0, so only m_f = m_i is coupled.',
    format: (v) => String(Math.round(v)),
  },
  {
    kind: 'slider',
    key: 'fN',
    label: 'Final n″',
    group: 'state',
    min: 1,
    max: 7,
    step: 1,
    help: 'Principal quantum number of |f⟩.',
    format: (v) => String(Math.round(v)),
  },
  {
    kind: 'slider',
    key: 'fL',
    label: 'Final ℓ′',
    group: 'state',
    min: 0,
    max: 6,
    step: 1,
    help: 'Orbital angular momentum of |f⟩. Δℓ = ±1 is the E1 rule — try Δℓ = 0 or ±2 and watch d_fi collapse to zero.',
    format: (v) => String(Math.round(v)),
  },
  {
    kind: 'slider',
    key: 'fM',
    label: 'Final m′',
    group: 'state',
    min: -6,
    max: 6,
    step: 1,
    help: 'Projection of |f⟩. m′ ≠ m makes the element vanish for this linear polarisation.',
    format: (v) => String(Math.round(v)),
  },
  {
    kind: 'slider',
    key: 'nuclearZ',
    label: 'Nuclear charge Z',
    group: 'state',
    min: 1,
    max: 4,
    step: 1,
    help: 'Hydrogenic ion. Orbitals shrink as 1/Z, the line blue-shifts as Z² and d_fi scales as 1/Z.',
    format: (v) => String(Math.round(v)),
  },

  /* ------------------------------- the drive ------------------------------ */
  {
    kind: 'slider',
    key: 'laserRel',
    label: 'Laser ω_L / ω₁₂',
    group: 'state',
    min: 0.2,
    max: 2,
    step: 0.001,
    help: 'Detuning knob. 1.000 = resonance (Δ = 0, full inversion possible); away from 1 the ceiling drops to Ω_R²/Ω² and the flopping speeds up to Ω = √(Ω_R² + Δ²).',
    format: (v) => v.toFixed(3),
  },
  {
    kind: 'slider',
    key: 'intensity',
    label: 'Field E₀',
    group: 'state',
    min: 0.0002,
    max: 20,
    step: 0.0001,
    unit: '×10⁶ V/m',
    log: true,
    help: 'Amplitude of E(t) = E₀cos(ω_L t)ẑ. Ω_R = |d_fi|E₀/ħ, so the Rabi rate is exactly proportional to this slider.',
    format: (v) => (v < 0.01 ? v.toExponential(2) : v.toFixed(3)),
  },
  {
    kind: 'slider',
    key: 'damping',
    label: 'Decay γ',
    group: 'state',
    min: 0,
    max: 20,
    step: 0.01,
    unit: '×10⁸ s⁻¹',
    help: 'Phenomenological upper-state decay 1/τ drawn as incoherent emission. γ = 6.27 (τ = 1.6 ns) is the real 2p → 1s rate.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'slider',
    key: 'timeDilation',
    label: 'Time scale',
    group: 'state',
    min: 0.002,
    max: 500,
    step: 0.001,
    unit: 'ns / s',
    log: true,
    help: 'Physical nanoseconds integrated per wall-clock second. The optical cycle itself is replayed by a separate strobe clock, so this slider only changes how fast the Rabi dynamics run.',
    format: (v) => (v < 1 ? v.toFixed(3) : v.toFixed(2)),
  },
  {
    kind: 'select',
    key: 'integrator',
    label: 'Integrator',
    group: 'state',
    options: [
      { value: 'rk4', label: 'RK4 (sub-stepped)' },
      { value: 'exact', label: 'exp(−iH_eff·dt)' },
    ],
    help: 'Fixed-step fourth-order Runge–Kutta with automatic sub-stepping, or the exact SU(2) propagator of the RWA Hamiltonian. Both agree to ~10⁻²² while RK4 keeps up.',
  },
  {
    kind: 'toggle',
    key: 'probeForbidden',
    label: 'Probe a dark line',
    group: 'state',
    help: 'Jump to the forbidden transition chosen below (1s→2s, 2p→4f, …) and verify that d_fi and the whole Rabi oscillation vanish.',
  },
  {
    kind: 'select',
    key: 'probeCase',
    label: 'Dark transition',
    group: 'state',
    options: [
      { value: 'ls-2s', label: '1s → 2s (Δℓ = 0)' },
      { value: '2p-4f', label: '2p₀ → 4f₀ (Δℓ = +2)' },
      { value: 'ls-2p-m1', label: '1s → 2p₊₁ (Δm = +1)' },
      { value: 'ls-2p', label: '1s → 2p₀ (allowed)' },
      { value: '2p-3d', label: '2p₀ → 3d₀ (allowed)' },
      { value: '2s-3p', label: '2s → 3p₀ (allowed)' },
    ],
    help: 'Target of the dark-line probe. “2p → 3f” from the textbook does not exist — n ≥ ℓ + 1 forces f ⇒ n ≥ 4 — so the Δℓ = +2 case uses 4f.',
  },

  /* ------------------------------ the viewport ---------------------------- */
  {
    kind: 'select',
    key: 'render',
    label: 'Viewport',
    group: 'visuals',
    options: [
      { value: 'cloud', label: 'ψ cloud' },
      { value: 'bloch', label: 'Bloch sphere' },
      { value: 'both', label: 'Both' },
    ],
    help: 'Keys 1 / 2 / 3 on the stage switch between them.',
  },
  {
    kind: 'toggle',
    key: 'showField',
    label: 'Field arrows',
    group: 'visuals',
    help: 'Draw E(t) = E₀cos(ω_L t)ẑ as an arrow lattice around the cloud.',
  },
  {
    kind: 'toggle',
    key: 'phaseColor',
    label: 'Phase wheel',
    group: 'visuals',
    help: 'Colour encodes arg Ψ on the shared twilight wheel; off ⇒ grey luminance only, so |Ψ|² can be read quantitatively.',
  },
  {
    kind: 'slider',
    key: 'cloudOpacity',
    label: 'Cloud alpha',
    group: 'visuals',
    min: 0.1,
    max: 1,
    step: 0.01,
    help: 'Opacity of the |Ψ|² slice.',
    format: (v) => v.toFixed(2),
  },
  {
    kind: 'toggle',
    key: 'replay',
    label: 'Re-arm shot',
    group: 'plots',
    help: 'Flip this to restart the pulse from t = 0 with the atom back in |i⟩ — the same hook the guided tours use to fire a clean π pulse.',
  },
];

export function describeDipole(p: SimParams): string {
  const i = { n: pNum(p, 'iN', 1), l: pNum(p, 'iL', 0), m: pNum(p, 'iM', 0) };
  const f = { n: pNum(p, 'fN', 2), l: pNum(p, 'fL', 1), m: pNum(p, 'fM', 0) };
  const rel = pNum(p, 'laserRel', 1);
  return `Laser-driven ${stateLabel(i.n, i.l, i.m)} → ${stateLabel(f.n, f.l, f.m)} at ω_L = ${rel.toFixed(3)}·ω₁₂ with E₀ = ${pNum(p, 'intensity', 1).toFixed(3)}×10⁶ V/m.`;
}
