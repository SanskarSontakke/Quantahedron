/**
 * Sim 4 — auto-demo scripts (§3.4).
 *
 * Every number in these captions was measured, not asserted: the T(E) values come
 * from `transmissionRectangular` / `transmissionDouble` in
 * `@/engine/physics/splitStepFFT` evaluated at the exact keyframe parameters (the
 * same functions the T(E) panel plots), the ⟨T⟩ figures are those closed forms
 * folded over the launched packet's Gaussian momentum spectrum, and the T_sim
 * figures are the split-step ledger itself run to saturation on the same
 * parameters. The double barrier's T = 1 modes come from `resonanceEnergies`, i.e.
 * the exact Fabry–Pérot condition k·gap + φ_r(E) = nπ — for the 1.2 a.u. well below
 * it sits at E = 1.8354 while the hard-wall estimate π²/2m·gap² = 3.427 is 46 %
 * high, and at gap = 0.72 a.u. it is 3.630 against an estimate of 9.519.
 *
 * Timing: physical time advances at `stepsPerFrame·Δt` per rendered frame, so both
 * tours run at Δt = 0.001 with 24 steps/frame ≈ 1.44 a.u. of flight per second —
 * long enough that a beat ends once the transmitted flux has been fully counted
 * (the deep-tunnelling ledger is flat to 10⁻⁸ by t ≈ 25, the resonant one by
 * t ≈ 35 ≈ 3τ). E₀ and σK both sit inside `packetSig`, so every energy change
 * relaunches ψ: the sweeps are `instant` staircases rather than tweens, which would
 * re-fire the packet on every frame and freeze the beam.
 */

import type { DemoScript } from '@/simulations/types';

/** Shared beam-line settings for both tours (open box, log T axis, exact curve). */
const RIG = {
  gridN: 1024,
  dt: 0.001,
  stepsPerFrame: 24,
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
      'Fire identical packets at one rectangular barrier from E₀ = 0.4·V₀ to 1.4·V₀: the closed-form T(E) climbs from 10⁻⁴ to 1, turns exponential below the barrier into oscillatory above it, and hits Ramsauer–Townsend perfection exactly where κ′a = π — then shorten the packet to see what a wavepacket does to a curve this steep.',
    durationSec: 90,
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
          sigmaK: 8,
          packetX: 0.22,
        },
        caption:
          'One rectangular barrier: V₀ = 12 a.u. high, a = 1.32 a.u. wide, and a packet launched at E₀ = 4.8 = 0.4·V₀, deep in the forbidden zone. The closed form the lower panel draws says T = 1.712×10⁻⁴ — κ = √(2m(V₀−E₀)) = 3.795, so the Gamow factor e^(−2κa) = 4.5×10⁻⁵ sets the scale — and the folded packet value in the telemetry is 2.52×10⁻⁴. The T_sim counter in the corner ends this beat at 5.6×10⁻⁴.',
      },
      {
        at: 10,
        instant: true,
        params: { E0: 7.2 },
        caption:
          'Fifty per cent more energy, T up 6.3×: 1.712×10⁻⁴ → 1.076×10⁻³ exact, 2.71×10⁻³ measured. Only κ moves (3.795 → 3.098) while a stays 1.32, so the whole change is e^(2Δκa) = e^1.84: this is why barrier *width*, not barrier height, is the design knob of every tunnel junction. Below the top the curve is a straight line on the log axis — a pure exponential.',
      },
      {
        at: 20,
        instant: true,
        params: { E0: 9.6 },
        caption:
          'E₀ = 9.6, still under the top: κ = 2.191, exact T = 7.862×10⁻³, packet ⟨T⟩ = 2.77×10⁻², beam measures 2.96×10⁻². Now the two agree to 7 %. Look at the beam itself — the dashed envelope riding over the barrier is e^(−κx) with exactly this κ, the reflected pulse has already detached to the left, and the amplitude on the far side is a continuation of the same wavefunction, not a classical shortcut.',
      },
      {
        at: 30,
        instant: true,
        params: { E0: 12.0 },
        caption:
          'Threshold: E₀ = V₀ = 12. The sinh formula degenerates and the exact limit is T = [1 + mV₀a²/2ℏ²]⁻¹ = 8.730×10⁻². Reaching the very top of the barrier still only gives you 8.7 % — a classical particle would say 100 %, so it is the barrier’s *finiteness*, not its height, that a quantum particle cannot forgive. The beam counts 0.2437 and the ⟨T⟩ row 0.2374: 2.7 % apart, because this packet is a ΔE = 1.6 band riding a curve that is steep right here.',
      },
      {
        at: 40,
        instant: true,
        params: { E0: 14.4 },
        caption:
          'Above the barrier the closed form switches from sinh to sin and T climbs to 0.940, while the packet measures 0.642 with R = 0.358. Classically there is nothing left to cross, yet a third of the wave still reflects — an evanescent-free impedance mismatch at the two faces — and the T(E) trace on the lower panel is now oscillating instead of rising.',
      },
      {
        at: 50,
        instant: true,
        params: { E0: 14.832 },
        caption:
          'Ramsauer–Townsend: κ′a = π at E₀ = V₀ + π²/2a² = 14.832, where κ′ = √(2m(E₀−V₀)) = 2.380. The two edge reflections have equal size and opposite phase and cancel: the closed form returns T = 0.999999991, one part in 10⁸ off perfection, and `resonanceEnergies` marks the exact crest at 14.8322. The packet crosses a 12 a.u. wall almost as if it were not there — the beam reads 0.694, which is that crest smeared by the packet’s own ΔE = 1.8.',
      },
      {
        at: 60,
        instant: true,
        params: { E0: 16.8 },
        caption:
          '1.4·V₀, past the crest: T slides back down to 0.772 while the beam counts 0.805 (packet average 0.808 — 0.4 % apart). Higher energy is not better transmission: above the barrier the structure is a Fabry–Pérot etalon, and what counts is its thickness measured in de Broglie wavelengths inside it, λ = 2π/√(2m(E₀−V₀)).',
      },
      {
        at: 70,
        instant: true,
        params: { E0: 4.8, sigmaK: 16 },
        caption:
          'Now change the *probe* instead of the barrier: σK 8 → 16 makes a short packet, σ_x = 0.75 a.u. with ΔE = 2.1. E₀ is back at 4.8, so the closed form still reads 1.712×10⁻⁴ — but the packet now carries a band of energies, and because T(E) is exponential the hot edge dominates: ⟨T⟩ = 2.20×10⁻³ and the beam measures 2.36×10⁻³, 14× the value at its own centroid.',
      },
      {
        at: 78,
        instant: true,
        params: { E0: 14.832 },
        caption:
          'Same short packet, back on the Ramsauer–Townsend crest: the measured value falls to 0.587, because a ΔE = 3.65 beam averages a T = 1 spike against the T < 1 wings. The long packet of the first six beats read 0.694 there. A wavepacket never samples one energy — that is the one caveat to everything on this panel, and the reason the ⟨T⟩ row is shown next to the exact T(E₀).',
      },
      {
        at: 90,
        params: {},
        caption:
          'Four decades of T(E), one propagator: two FFTs and two phase kicks per step, unitary to 10⁻¹⁰ across the whole tour — watch the norm row and the sponge ledger, which never drift. Now set the barrier to Triangular: the sinh formula dies there and only WKB follows you, which is the physics of field emission and of the microscope in the next tour.',
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    id: 'resonant-tunneling',
    label: 'Resonant Tunneling',
    summary:
      'Two thin barriers with a quantum well between them: park the packet on the exact T = 1 mode buried at 0.15·V₀, watch the well hold the particle for a dwell time ℏ/Γ, thin and thicken the walls to squeeze the resonance without ever losing its height, then hand the same exponent to an STM tip and see why it resolves atoms.',
    durationSec: 116,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          ...RIG,
          barrier: 'double',
          V0: 12,
          width: 0.015,
          gap: 0.05,
          E0: 0.55,
          sigmaK: 8,
          packetX: 0.28,
          logDensity: true,
        },
        caption:
          'A double barrier: two 0.36 a.u. walls of height 12 separated by a 1.2 a.u. well. The packet sits at E₀ = 0.55 = 0.046·V₀, deliberately off resonance, with κ = 4.785. One wall alone passes 2.33×10⁻²; the pair passes 1.41×10⁻⁴ — 165× more opaque than either wall by itself, because the two interfaces are destructively interfering. The counter closes this beat near 5×10⁻³.',
      },
      {
        at: 14,
        instant: true,
        params: { E0: 1.8354 },
        caption:
          'Drop onto the structure’s T = 1 mode: E₀ = 1.8354, bracketed from the drawn curve (the hard-wall estimate π²/2m·gap² = 3.427 would miss it entirely). A monochromatic beam crosses both classically impenetrable walls with zero reflection; this packet puts 0.176 through with R = 0.805 — 35× the previous beat — because the resonance is only Γ = 9.7×10⁻² wide while the packet is ΔE = 1.04 wide.',
      },
      {
        at: 36,
        caption:
          'Watch the timing rather than the number: the transmitted pulse arrives *late* and the counter keeps creeping up long after the reflected one has stopped. The resonant state’s width Γ = 9.73×10⁻² gives a lifetime ℏ/Γ = 10.3 a.u. — the well captures the amplitude, rings, and leaks it out both faces. That dwell time, not the barrier thickness, is what caps the cutoff frequency of a resonant-tunnel diode.',
      },
      {
        at: 48,
        instant: true,
        params: { width: 0.01, E0: 1.7495 },
        caption:
          'Thin both walls to 0.24 a.u.: one wall alone now passes 0.224 instead of 0.080, the mode broadens to Γ = 0.292 (τ = 3.4 a.u.) — and the peak is still exactly T = 1. The beam measures 0.342, the best of the tour: a wider pole swallows more of the packet’s bandwidth, and the wall thickness no longer matters at all.',
      },
      {
        at: 62,
        instant: true,
        params: { width: 0.02, E0: 1.8654 },
        caption:
          'Thicken them instead to 0.48 a.u. — each wall 8× more opaque (T_single = 2.78×10⁻²) — Γ collapses to 3.31×10⁻² and the dwell time stretches to 30 a.u., yet the peak has barely moved (1.7495 → 1.8654) and it is still exactly 1. The counter is still climbing when this beat ends, 0.043 on its way to 0.088: you are watching the resonance fill at its own rate. Perfect transmission through an arbitrarily thick barrier.',
      },
      {
        at: 80,
        instant: true,
        params: { width: 0.015, gap: 0.03, E0: 3.6302 },
        caption:
          'Shrink the well 1.2 → 0.72 a.u. and ask where the mode must go: the particle-in-a-box answer is π²/2m·gap² = 9.519. The real one is 3.630 — 62 % lower — because the wave does not stop at the wall faces, it penetrates them, and the true condition is k·gap + φ_r(E) = nπ with φ_r = 0.383π here. Put E₀ there and the beam reports 0.271, still through two walls that pass 0.165 each.',
      },
      {
        at: 96,
        instant: true,
        params: { barrier: 'rect', width: 0.055, gap: 0.05, E0: 6, logDensity: false },
        caption:
          'Same exponent, different machine. A single rectangular barrier at E₀ = 6 against V₀ = 12 gives κ = 3.464, so the tunneling factor e^(−2κd) carries 2κ = 6.93 per unit length: open the gap by one a.u. and the current drops by e^6.93 = 1021×. That number, not the tip radius, is what buys atomic resolution.',
      },
      {
        at: 108,
        instant: true,
        params: {
          stmMode: true,
          stmBias: 0.4,
          stmHeight: 0.05,
          stmAmp: 0.45,
          stmContrast: 0.35,
        },
        caption:
          'Tip mode. The lower line is the true surface — three 0.45 a.u. adsorbates on a plane, d₀ = 1.2 a.u. of vacuum; the upper one is what constant-current feedback paints. Over an atom the gap narrows to 0.75 a.u. *and* the local barrier drops from 12 to 7.8, so at a fixed height the current would jump 158×; to hold I = I₀ the feedback backs the tip off by 0.89 a.u. and reports the atom as 1.35 a.u. tall — three times reality. Atomic resolution is an artefact of the exponential, which is exactly why it works.',
      },
      {
        at: 116,
        instant: true,
        params: { stmMode: false, barrier: 'double', width: 0.015, gap: 0.05, E0: 1.8354 },
        caption:
          'One split-step propagator, four closed forms, and a resonance condition measured instead of assumed — back on the double barrier at its T = 1 mode. Drag E₀ across the peak and hit the ⟲ relaunch chip to time the delay yourself, or push tilt up to leave the sinh formula behind: only WKB survives a triangular barrier.',
      },
    ],
  },
];

export default tunnelDemos;
