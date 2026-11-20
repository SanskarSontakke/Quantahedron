/**
 * Sim 4 — auto-demo scripts (§3.4).
 *
 * Every number in these captions was measured, not asserted: the T(E) values come
 * from `transmissionRectangular` / `transmissionDouble` in
 * `@/engine/physics/splitStepFFT` evaluated at the exact keyframe parameters (the
 * same functions the T(E) panel plots), and the ⟨T⟩ figures are those closed forms
 * folded over the launched packet's Gaussian momentum distribution. The double
 * barrier's T = 1 mode is the *exact* root of the Fabry–Pérot condition
 * k·gap + φ_r(E) = π, found numerically by `resonanceEnergies` — the textbook
 * hard-wall value π²/2m·gap² = 2.380 is 44 % high for this geometry.
 *
 * Timing: physical time advances at `stepsPerFrame·Δt` per rendered frame, so both
 * tours run at Δt = 0.002 with 8 steps/frame ≈ 0.96 a.u. of flight per second.
 * E₀ sits inside `packetSig`, so every energy change relaunches ψ — the sweeps are
 * therefore `instant` staircases rather than tweens, which would re-fire the packet
 * on every frame and freeze the beam.
 */

import type { DemoScript } from '@/simulations/types';

/** Shared beam-line settings for both tours (open box, log T axis, exact curve). */
const RIG = {
  gridN: 1024,
  dt: 0.002,
  stepsPerFrame: 8,
  capWidth: 0.07,
  capStrength: 0.45,
  mass: 1,
  view: 'both',
  showAnalytical: true,
  showEvanescent: true,
  showPotential: true,
  showReIm: false,
  logDensity: false,
  logT: true,
  energyScan: 0,
  stmMode: false,
  colorPhase: true,
} as const;

export const tunnelDemos: DemoScript[] = [
  /* ------------------------------------------------------------------ */
  {
    id: 'energy-sweep',
    label: 'Energy Sweep',
    summary:
      'Fire identical packets at one rectangular barrier from E₀ = 0.4·V₀ to 1.4·V₀: the closed-form T(E) climbs eight decades, turns exponential below the barrier into oscillatory above it, and hits Ramsauer–Townsend perfection exactly where κ·a = π.',
    durationSec: 76,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          ...RIG,
          barrier: 'rect',
          V0: 12,
          width: 0.055,
          gap: 0.1,
          E0: 4.8,
          sigmaK: 12,
          packetX: 0.16,
        },
        caption:
          'One rectangular barrier, V₀ = 12 a.u. wide a = 1.32 a.u. The packet is launched far to the left at E₀ = 4.8 — only 0.4·V₀, deep in the forbidden zone. Exact T = 1.712×10⁻⁴, κ = √(2(V₀−E)) = 3.795 so 2κa = 10.02 and e^(−2κa) = 4.5×10⁻⁵.',
      },
      {
        at: 10,
        instant: true,
        params: { E0: 7.2 },
        caption:
          'Same barrier, 50 % more energy. T jumps 1.712×10⁻⁴ → 1.076×10⁻³: six extra e-folds of barrier bought a factor of 6.3, because only κ moves (3.795 → 3.098) while the width is fixed. This is the e^(−2κa) law, and it is why barrier width, not barrier height, is the design knob.',
      },
      {
        at: 20,
        instant: true,
        params: { E0: 9.6 },
        caption:
          'E₀ = 9.6, still below the top. κ = 2.191, T = 7.862×10⁻³. Watch the dashed envelope over the simulated tail: inside the barrier |ψ| decays as e^(−κx) with exactly this κ, and the reflected and transmitted packets are already separating — the beam line is resolving T without any boundary condition being imposed.',
      },
      {
        at: 30,
        instant: true,
        params: { E0: 12.0 },
        caption:
          'Threshold: E₀ = V₀ = 12. The sinh formula degenerates and the exact limit is T = [1 + mV₀a²/2ℏ²]⁻¹ = 8.730×10⁻². Reaching the top of the barrier still only gives you 8.7 % — a classical particle would say 100 %, so the barrier’s finiteness, not its height, is what a quantum particle cannot forgive.',
      },
      {
        at: 40,
        instant: true,
        params: { E0: 14.4 },
        caption:
          'Above the barrier the curve turns from sinh to sin and climbs to T = 0.940. Classically there is nothing to cross now, yet the wave still reflects — an evanescent-free Fresnel mismatch at the two edges, and the T(E) trace on the lower panel is oscillating instead of rising.',
      },
      {
        at: 50,
        instant: true,
        params: { E0: 14.83 },
        caption:
          'Ramsauer–Townsend: κ′a = π at E = 12 + π²/2a² = 14.832, and the two edge reflections interfere exactly out of phase. T = 1.000000000 to twelve digits. The packet crosses a 12 a.u. wall as if it were not there, and the E₀ marker sits on the crest of the curve.',
      },
      {
        at: 59,
        instant: true,
        params: { E0: 16.2 },
        caption:
          'Slide past the resonance and T falls back to 0.826; at 16.8 (1.4·V₀) it is 0.772. Higher energy is not better transmission — above the barrier the structure is a Fabry–Pérot etalon whose thickness, measured in de Broglie wavelengths inside it, is what counts.',
      },
      {
        at: 66,
        instant: true,
        params: { sigmaK: 5 },
        caption:
          'Same barrier, narrower momentum spread (Δk = 0.21 → σ_x = 2.4 a.u., ΔE = 0.65). The measured ⟨T⟩ is no longer a blurred average of the curve: at E₀ = 4.8 it sharpens from 3.27×10⁻⁴ to 1.97×10⁻⁴, and at 14.83 it rises from 0.660 to 0.809, converging on the exact value as ΔE → 0. Drag E₀ yourself and watch the two markers on the curve stay glued together.',
      },
      {
        at: 76,
        params: {},
        caption:
          'Four decades of T(E), one propagator: two FFTs and two phase kicks per step, unitary to round-off, benchmarked every frame against the closed form. Switch to the triangular barrier and the sinh law dies — only WKB survives.',
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'resonant-tunneling',
    label: 'Resonant Tunneling',
    summary:
      'Two thin barriers with a quantum well between them: park the packet on the exact T = 1 mode buried at E₀ = 0.11·V₀, watch the well hold the particle for a dwell time 1/Γ, then stretch the barriers to see the resonance sharpen without ever losing height — and finish with the STM tip that turns the same exponent into atomic resolution.',
    durationSec: 84,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          ...RIG,
          barrier: 'double',
          V0: 12,
          width: 0.01,
          gap: 0.06,
          E0: 2.6,
          sigmaK: 5,
          packetX: 0.16,
          logDensity: true,
        },
        caption:
          'A double barrier: two 0.24 a.u. walls of height 12 separated by a 1.44 a.u. well. Packet at E₀ = 2.6, well below the walls, and deliberately off resonance. Exact T = 3.70×10⁻² — the folded packet value the solver should measure is 4.7×10⁻².',
      },
      {
        at: 10,
        instant: true,
        params: { E0: 1.335 },
        caption:
          'Lower the energy by 49 % and transmission goes UP by 5.6×. E₀ = 1.335 is the exact T = 1 mode of the structure — a monochromatic beam would pass through two classically impenetrable walls with zero reflection. Only 26 % of this packet gets through, because the resonance is 0.17 wide and the packet is 0.34 wide.',
      },
      {
        at: 20,
        caption:
          'Watch the timing: the transmitted pulse arrives *late*. The resonant state has width Γ = 0.1705, so its lifetime is ℏ/Γ = 5.87 a.u. — the well stores the amplitude, rings, and leaks it out both sides. That dwell time, not any extra barrier, is what makes a resonant tunnel diode a high-frequency device.',
      },
      {
        at: 28,
        instant: true,
        params: { E0: 1.42, width: 0.02 },
        caption:
          'Double both barriers to 0.48 a.u. Each wall alone now passes 2.0×10⁻² instead of 0.178 — nine times more opaque — and the mode narrows from Γ = 0.171 to 0.018, a dwell time of 55 a.u. Yet the peak is *still exactly* T = 1, and it has barely moved (1.335 → 1.421). Perfect transmission through an arbitrarily thick barrier: the pole slides down into the wall as the walls thicken.',
      },
      {
        at: 40,
        instant: true,
        params: { E0: 1.146, width: 0.005 },
        caption:
          'Halve them instead: a = 0.12, T_single = 0.499, and the resonance is so broad that no half-width can be measured — it has merged with the continuum. The packet now transmits at 0.629, higher than either wall alone would allow, because the well between them is a constructive interferometer.',
      },
      {
        at: 50,
        instant: true,
        params: { E0: 0.591, width: 0.01, gap: 0.1 },
        caption:
          'Widen the well to 2.4 a.u. and the mode falls to E = 0.591, Γ = 0.034, ⟨T⟩ = 0.090. Note where the particle-in-a-box estimate π²/2·gap² puts it: 0.857. The true mode is 31 % lower, because the wave does not stop at the wall faces — it penetrates them, and the Fabry–Pérot condition is k·gap + φ_r(E) = π with a reflection phase φ_r = 0.251π here.',
      },
      {
        at: 62,
        instant: true,
        params: { barrier: 'rect', E0: 6, gap: 0.06, logDensity: false },
        caption:
          'Same exponent, different machine: one rectangular barrier at E₀ = 6 against V₀ = 12 gives κ = 3.464. In constant-current STM the tip current is I ∝ V·e^(−2κd), so 2κ = 6.93 — retract the tip by a single ångström-equivalent and the current falls by a factor of 1021.',
      },
      {
        at: 70,
        instant: true,
        params: { stmMode: true, stmHeight: 0.05, stmAmp: 0.45, stmContrast: 0.35 },
        caption:
          'Tip mode on. The lower trace is the true atomic profile, the upper one is what constant-current feedback paints: over an atom the local barrier drops by 35 %, so the tip must back off by Δd = ln(1/0.65)/2κ = 0.063 a.u. to hold I fixed — a 1 height step becomes a 1.5 apparent step. Atomic resolution is an artefact of the exponential, and that is exactly why it works.',
      },
      {
        at: 84,
        params: {},
        caption:
          'Everything on this screen is one split-step propagator plus four closed forms. Try the tilt slider to leave the sinh formula behind (only WKB follows you), or press L to relaunch and time the resonant pulse yourself.',
      },
    ],
  },
];

export default tunnelDemos;
