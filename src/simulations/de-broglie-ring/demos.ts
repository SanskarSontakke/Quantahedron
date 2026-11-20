/**
 * de Broglie Ring — auto-demo scripts (§3.4).
 *
 * Keyframes only ever name keys that exist in `defaults.ts`, so a tour can be
 * permalinked (`?sim=de-broglie-ring&demo=integer-lock`) and scrubbed. Numeric
 * targets tween with easing between frames; strings and booleans switch at their
 * own instant, and `instant: true` pins the numerics as soon as the frame starts.
 */

import type { DemoScript } from '@/simulations/types';

const LAMBDA = 33.301; // a₀ = 2π·5.3, so n = r/5.3 with the wavelength frozen

/** Resonant radii rₙ = nλ/2π for λ = 33.301 a₀. */
const rN = (n: number) => Math.round(((n * LAMBDA) / (2 * Math.PI)) * 1000) / 1000;

export const deBroglieDemos: DemoScript[] = [
  {
    id: 'integer-lock',
    label: 'Integer Lock',
    summary:
      'Freeze λ and drag the orbit through radii where 2πr/λ runs from 1 to 5: the ring locks onto every integer with a resonance flash and dissolves in between.',
    durationSec: 46,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          tab: 'orbit',
          wavelengthLock: false,
          wavelengthAU: LAMBDA,
          radiusAU: rN(1),
          nTarget: 1,
          lockWidth: 0.08,
          showWave: true,
          showStanding: true,
          showInterference: true,
          showGuides: true,
          sweep: false,
          amplitude: 1,
          thickness: 2.2,
        },
        caption: 'λ frozen at 33.30 a₀ (= 2π·5.3 a₀). At r = 5.30 a₀ the circumference holds exactly one wavelength: n = 1, the wave closes, Q = 1.',
      },
      {
        at: 3.5,
        params: { radiusAU: rN(1) },
        caption: 'Release the lock and sweep the radius outward. n = 2πr/λ is continuous, so the seam at θ = 2π starts to open: e^{i2πn} ≠ 1.',
      },
      {
        at: 7.5,
        params: { radiusAU: rN(2) },
        caption: 'n = 2.000 → the wrap-around wave returns in phase. The counter-circulating partner rebuilds to full amplitude and a two-lobed standing wave snaps into place.',
      },
      {
        at: 11,
        params: { radiusAU: rN(2.5) },
        caption: 'Midway at n = 2.500 the 16 round-trip phasors form a closed polygon — their sum is exactly zero. No standing wave can survive this radius.',
      },
      {
        at: 15,
        params: { radiusAU: rN(3) },
        caption: 'n = 3.000 → three lobes, three nodes per half-turn, Q back to 1. This is the hydrogen n = 3 shell: r = 3λ/2π = 9 a₀ = 0.476 nm.',
      },
      {
        at: 18.5,
        params: { radiusAU: rN(3.5) },
        caption: 'Half-integer windings are the worst case: |e^{i2πn} − 1| = 2, the seam vector is maximal and the ring is a pure travelling wave.',
      },
      {
        at: 22.5,
        params: { radiusAU: rN(4) },
        caption: 'n = 4.000 → four lobes locked. Note how narrow the capture band is: the flash fires only within ±0.08 of the integer.',
      },
      {
        at: 26,
        params: { radiusAU: rN(4.6) },
        caption: 'Between the shells the accumulated amplitude per lap falls off like 1/(K·|sin πn|) — destructive interference does the quantising, not a force.',
      },
      {
        at: 30,
        params: { radiusAU: rN(5) },
        caption: 'n = 5.000 locked at r = 26.5 a₀. Five whole wavelengths fit the orbit; 2πr = nλ is now visibly a closed braid.',
      },
      {
        at: 34,
        params: { radiusAU: rN(5) },
        caption: 'Widen the capture band and hand the radius to the sweep: the orbit chases the nearest integer and n steps like a staircase.',
        instant: false,
      },
      {
        at: 36,
        instant: true,
        params: { sweep: true, sweepSpeed: 0.55, lockWidth: 0.22, radiusAU: rN(4) },
        caption: 'Sweeping n continuously with a wide band: lock → slip → lock. Each plateau is a Bohr orbit, each slip is the interference collapsing.',
      },
      {
        at: 46,
        params: { sweep: true },
        caption: 'Only integer windings survive: that single boundary condition — ψ is single-valued — is the whole of Bohr’s model.',
      },
    ],
  },
  {
    id: 'scale-ladder',
    label: 'Scale Ladder',
    summary:
      'Step the beam from a thermal neutron to a cricket ball and watch λ collapse from lattice-matched to far below nuclear scales, with the aperture fixed.',
    durationSec: 48,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          tab: 'scale',
          massChoice: 'neutron',
          massKg: 1.67492749804e-27,
          speedMS: 2200,
          logMass: -26.776,
          logSpeed: 3.3424,
          slitNm: 0.21,
          logSlit: -0.6778,
        },
        caption: 'Thermal neutron, 2200 m·s⁻¹: λ = h/(mv) = 0.180 nm against a 0.21 nm graphite layer spacing. λ/a = 0.86 ⇒ real Bragg diffraction.',
      },
      {
        at: 8,
        instant: true,
        params: {
          massChoice: 'electron',
          massKg: 9.1093837015e-31,
          speedMS: 1e6,
          logMass: -30.0405,
          logSpeed: 6,
          slitNm: 1,
        },
        caption: 'Electron at 1.0×10⁶ m·s⁻¹ (2.85 eV): λ = 0.727 nm. Drop the aperture to 1 nm and λ/a = 0.73 — still diffracting.',
      },
      {
        at: 16,
        instant: true,
        params: {
          massChoice: 'electron100',
          massKg: 9.1093837015e-31,
          speedMS: 1.6435248e8,
          logMass: -30.0405,
          logSpeed: 8.2158,
          slitNm: 1,
        },
        caption: '100 keV electron microscope: β = 0.548, γ = 1.196, so p = γmv and λ = 3.70 pm — a tenth of a carbon–carbon bond. The relativistic factor is worth 4.8 %.',
      },
      {
        at: 24,
        instant: true,
        params: { logSlit: -0.6778 },
        caption: 'Same 100 keV beam against 0.21 nm graphite: λ/a = 0.0176. The first fringe would sit 0.018 rad out and the lattice planes are the only grating fine enough.',
      },
      {
        at: 32,
        instant: true,
        params: {
          massChoice: 'atom',
          massKg: 1.1955881279e-24,
          speedMS: 200,
          logMass: -23.9224,
          logSpeed: 2.301,
          slitNm: 100,
          logSlit: 2,
        },
        caption: 'C₆₀ buckyball at 200 m·s⁻¹ — 720 u, 1.3 million electron masses. λ = 2.77 pm against a 100 nm grating: λ/a = 2.8×10⁻⁵ — the 1999 Vienna buckyball experiment, and molecular interference now extends to 25 000 u.',
      },
      {
        at: 40,
        instant: true,
        params: {
          massChoice: 'baseball',
          massKg: 0.16,
          speedMS: 30,
          logMass: -0.7959,
          logSpeed: 1.4771,
          slitNm: 1,
          logSlit: 0,
        },
        caption: 'Cricket ball, 0.16 kg at 30 m·s⁻¹: λ = 1.38×10⁻³⁴ m — 19 decades below a proton radius and 28 below a machinable slit. Its matter wave is real and permanently unobservable.',
      },
      {
        at: 48,
        params: { massChoice: 'baseball' },
        caption: 'Same formula, 24 orders of magnitude of runway: diffraction is invisible not because quantum mechanics stops, but because nothing is small enough to measure it.',
      },
    ],
  },
];
