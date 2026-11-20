/**
 * Stern–Gerlach Spin — guided tours for the Demo Director.
 *
 * Keyframes are ordinary parameter patches, so the tour drives the same store the
 * inspector does: the bench, the Bloch sphere and the Statistics histogram all
 * react on their own. Booleans are used as re-arm triggers (`reroll`) because
 * `sampleDemo` switches strings/booleans exactly at each keyframe and pins numerics
 * from the last one.
 */

import type { DemoScript } from '@/simulations/types';

export const sternGerlachDemos: DemoScript[] = [
  {
    id: 'erased-knowledge',
    label: 'Erased Knowledge',
    summary:
      'Build the textbook sequence SG_z → SG_x → SG_z and watch a value that was selected with certainty come back 50/50, then make the last magnet deterministic and finally dial the three-magnet chain that transmits exactly 12.5%.',
    durationSec: 42,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          render: 'both',
          showBloch: true,
          showTrajectories: true,
          stages: 2,
          a1Axis: 'z',
          a2Axis: 'z',
          a3Axis: 'z',
          block1Up: false,
          block1Down: true,
          block2Up: false,
          block2Down: true,
          block3Up: false,
          block3Down: false,
          spinTheta: 0,
          spinPhi: 0,
          larmor: 0,
          precessionFreq: 0.8,
          beamCount: 900,
          seed: 7,
          magnetGap: 0.5,
          fieldGradient: 1,
          reroll: true,
        },
        caption:
          'Two magnets, both ẑ, both passing only their “+” beam, fed by |↑z⟩. Every atom that survives the first survives the second: T = 1.000, and the histogram says so.',
      },
      {
        at: 7,
        params: { reroll: false, stages: 3, a2Axis: 'x', block2Down: false },
        caption:
          'Insert a third magnet and rotate only the middle one to x̂, leaving both of its ports open. It is a measurement, so it sorts the ↑z beam into ↑x and ↓x with probability ½ each.',
      },
      {
        at: 14,
        params: { a3Axis: 'z', block3Down: true },
        caption:
          'Now ẑ again at the end. Atoms that were certainly ↑z enter SG3 as a mixture of ↑x and ↓x, so SG3 splits them 50/50 — the first magnet’s answer has been destroyed, not merely hidden.',
      },
      {
        at: 21,
        params: { a3Axis: 'x', block3Down: true },
        caption:
          'Make SG3 ask the same question SG2 asked and one of its ports closes on nothing: the surviving +x beam passes with probability 1. A measurement is only destructive when you change the basis.',
      },
      {
        at: 27,
        params: {
          a1Axis: 'z',
          a2Axis: 'x',
          a3Axis: 'y',
          spinTheta: 90,
          spinPhi: 0,
          block1Down: true,
          block2Down: true,
          block3Down: true,
        },
        caption:
          'The 12.5% puzzle: prepare |+x⟩, then ẑ → x̂ → ŷ with one port open each. Three orthogonal projections, (1/√2)² cubed, so T = 1/8 exactly.',
      },
      {
        at: 34,
        params: { reroll: true, beamCount: 1800 },
        caption:
          'Re-deal the beam with 1800 atoms. The detector counts scatter around 225 with σ = √(Np(1−p)) ≈ 14 — shot noise, not a disagreement with the theory.',
      },
      {
        at: 42,
        params: { reroll: false },
        caption:
          'Everything on screen is the same arithmetic: |P±χ|² for the thickness, cos²(γ/2) for the tilt, and a seeded sampler for the counts you can share as a permalink.',
      },
    ],
  },
  {
    id: 'larmor-precession',
    label: 'Larmor Precession',
    summary:
      'Turn on a guide field between two magnets, slow the replay down until the spinor visibly cones about ẑ, and show that a transverse analyser reads that phase as a population while a ẑ analyser cannot see it at all.',
    durationSec: 36,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          render: 'both',
          showBloch: true,
          showTrajectories: true,
          stages: 2,
          a1Axis: 'x',
          a2Axis: 'z',
          a3Axis: 'z',
          block1Up: false,
          block1Down: true,
          block2Up: false,
          block2Down: false,
          block3Up: false,
          block3Down: false,
          spinTheta: 90,
          spinPhi: 0,
          larmor: 0,
          precessionFreq: 1.2,
          beamCount: 600,
          seed: 11,
          magnetGap: 0.45,
          fieldGradient: 1.2,
          reroll: true,
        },
        caption:
          'SG1 along x̂ selects |+x⟩ — a spinor lying on the equator, pointing at φ = 0. With no guide field the state is frozen between the magnets, so SG2 on ẑ reports exactly 50/50 forever.',
      },
      {
        at: 7,
        params: { larmor: 20, reroll: false },
        caption:
          'Switch on a 20 mT guide field along ẑ. Between the magnets the spinor obeys U(t) = exp(−iω_L t σ_z/2) with ω_L = γ_e B = 3.52×10⁹ rad/s, so it sweeps a latitude circle: watch the blue arrow cone while its height ⟨σz⟩ stays put.',
      },
      {
        at: 13,
        params: { precessionFreq: 0.12 },
        caption:
          'Slow the replay to 0.12 turn/s. The honest number is unchanged — γ_e·B·t_flight ≈ 141 000 turns per flight — this is only the display scale, and the telemetry pill prints the slow-motion factor.',
      },
      {
        at: 20,
        params: { a2Axis: 'x', precessionFreq: 1 },
        caption:
          'Swap SG2 to x̂. Now the analyser measures the very direction the vector is precessing around, and its transmission swings between 0 and 1 as the azimuth runs through 2π — a phase converted into a population.',
      },
      {
        at: 27,
        params: { a2Axis: 'z' },
        caption:
          'Back to ẑ: precession about ẑ cannot change P(±z). The beams stay exactly 50/50 no matter how fast the field spins the spinor — the defining property of a conserved quantity.',
      },
      {
        at: 36,
        params: { a2Axis: 'custom', a2CustomAz: 45, a2CustomEl: 0, larmor: 55, seed: 12 },
        caption:
          'Final setting: an analyser at 45° between x̂ and ŷ reads half of the phase, so its splitting breathes between cos² and sin² of the precession angle as the atoms fly.',
      },
    ],
  },
];

export default sternGerlachDemos;
