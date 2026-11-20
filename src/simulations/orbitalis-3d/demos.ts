/**
 * Orbitalis 3D — guided tours (Demo Director scripts).
 *
 * A tour is just keyframes over the same flat parameter map the URL uses, so the
 * learner can grab a slider at any moment and the director yields (store
 * `interruptDemo`). Quantum numbers snap (`instant`) because a half-way value
 * between ℓ = 0 and ℓ = 2 is not a state; everything continuous — exposure,
 * slice offset, camera azimuth — is eased by the director.
 */

import type { DemoScript } from '@/simulations/types';

/** One-slot state helper: |n ℓ m⟩ with unit amplitude. */
const one = (n: number, l: number, m: number) => ({
  ampsN: [n],
  ampsL: [l],
  ampsM: [m],
  ampsAmp: [1],
  ampsPhase: [0],
  n,
  l,
  m,
});

/** Two-slot state helper with a relative phase. */
const two = (
  a: [number, number, number],
  b: [number, number, number],
  wa = 0.707,
  wb = 0.707,
  phase = 0,
) => ({
  ampsN: [a[0], b[0]],
  ampsL: [a[1], b[1]],
  ampsM: [a[2], b[2]],
  ampsAmp: [wa, wb],
  ampsPhase: [0, phase],
  n: a[0],
  l: a[1],
  m: a[2],
});

const orbit = (az: number) => ({ camAz: az });

export const orbitalisDemos: DemoScript[] = [
  {
    id: 'safari',
    label: 'Orbital Safari',
    summary: 'Walk the quantum numbers: every node type, from 1s to 4f, in ~50 seconds.',
    durationSec: 52,
    keyframes: [
      {
        at: 0,
        ...{ instant: true },
        params: { ...one(1, 0, 0), basis: 'complex', render: 'raymarch', exposure: 1.2, densityScale: 1.4, isoLevel: 0.25, showAxes: true, streamlines: false, camDist: 26, camEl: 0.25 },
        caption: '1s — the ground state. Spherical, no nodes anywhere, and utterly static.',
      },
      {
        at: 9,
        instant: true,
        params: { ...one(2, 0, 0), densityScale: 1.1, camDist: 34, ...orbit(0.9) },
        caption: '2s: one radial node — a spherical shell of zero probability inside the cloud.',
      },
      {
        at: 18,
        instant: true,
        params: { ...one(2, 1, 0), camDist: 34 },
        caption: '2p₀: the node is now angular, a plane through the nucleus. Same energy as 2s.',
      },
      {
        at: 26,
        instant: true,
        params: { basis: 'real', ...one(3, 2, 0), render: 'isosurface', octant: true, isoLevel: 0.18 },
        caption: '3d(z²) in the real chemistry basis — two lobes plus a torus, cut open by the octant wedge.',
      },
      {
        at: 34,
        instant: true,
        params: { ...one(3, 2, 2), isoLevel: 0.14, ...orbit(2.2) },
        caption: 'Same n and ℓ, different m: a different shape from the same degenerate shell.',
      },
      {
        at: 42,
        instant: true,
        params: { ...one(4, 3, 0), render: 'slice', slicePlane: 'xz', sliceOffset: 0, octant: false },
        caption: '4f sliced: the nodal structure is a counting exercise — n−ℓ−1 radial, ℓ angular.',
      },
      {
        at: 50,
        instant: true,
        params: { render: 'raymarch', ...one(3, 1, 1), streamlines: true, isoLevel: 0.2 },
        caption: 'Try it yourself: n = 3, ℓ = 1, m = 1 has current flowing around z.',
      },
    ],
  },
  {
    id: 'beats',
    label: 'Quantum Beats',
    summary: 'Superpose two energies and watch the charge slosh — the oscillating dipole that emits light.',
    durationSec: 46,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: { basis: 'complex', render: 'raymarch', ...one(2, 0, 0), densityScale: 1.2, exposure: 1.2, zeemanB: 0, starkE: 0, camDist: 36 },
        caption: 'A pure 2s state is stationary: its density never changes, only an invisible global phase.',
      },
      {
        at: 7,
        instant: true,
        params: two([2, 0, 0], [2, 1, 0], 0.707, 0.707, 0),
        caption: 'Add 2p₀ with equal weight. Two energies now exist, so the relative phase evolves.',
      },
      {
        at: 10,
        params: { ampsPhase: [0, 0.0], camAz: 0.62 },
        caption: 'The dipole tilts to +z…',
      },
      {
        at: 13.5,
        params: { ampsPhase: [0, 3.142] },
        caption: '…and to −z half a beat later. The cloud really does rock back and forth.',
      },
      {
        at: 17,
        params: { ampsPhase: [0, 6.283] },
        caption: 'One full cycle. A classical antenna and this atom are doing the same thing.',
      },
      {
        at: 22,
        instant: true,
        params: two([2, 0, 0], [3, 1, 0], 0.6, 0.8, 0),
        caption: 'Now 2s + 3p: a bigger energy gap means a faster beat — and a real emitted photon frequency.',
      },
      {
        at: 30,
        instant: true,
        params: { starkE: 4 },
        caption: 'An electric field shifts 2s and 2p₀ apart (linear Stark), tuning the beat frequency.',
      },
      {
        at: 38,
        instant: true,
        params: { starkE: 0, ...two([2, 0, 0], [2, 1, 0], 0.94, 0.34, 0) },
        caption: 'Unbalanced weights change how far the charge moves — that is the transition dipole moment.',
      },
      { at: 45, instant: true, params: { ...one(2, 0, 0), starkE: 0 } },
    ],
  },
  {
    id: 'standing-circulating',
    label: 'Standing vs Circulating',
    summary: 'Why m = 0 stands still and m ≠ 0 flows — and how the two descriptions are the same physics.',
    durationSec: 42,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: { basis: 'complex', render: 'raymarch', ...one(2, 1, 0), streamlines: true, densityScale: 1.3, camDist: 34, camEl: 0.1 },
        caption: '2p₀ (m = 0): the phase is constant along φ, so no current — a standing wave with a nodal plane.',
      },
      {
        at: 8,
        instant: true,
        params: one(2, 1, 1),
        caption: 'm = +1: ψ ∝ e^{iφ}. The colour wraps once around the axis and the density becomes a torus.',
      },
      {
        at: 14,
        params: { camAz: 3.6 },
        caption: 'The current is purely azimuthal — the probability is circulating, but the cloud looks frozen.',
      },
      {
        at: 20,
        instant: true,
        params: two([2, 1, 1], [2, 1, -1], 0.707, 0.707, 0),
        caption: 'Add m = +1 and m = −1 with equal weight: the circulation cancels and lobes appear.',
      },
      {
        at: 26,
        params: { ampsPhase: [0, 3.142] },
        caption: 'Rotating their relative phase swings the lobes — this superposition IS the real pₓ/p_y pair.',
      },
      {
        at: 32,
        instant: true,
        params: { basis: 'real', ...one(2, 1, 1), streamlines: false },
        caption: 'Switch the basis to "real" and the same state appears as a two-lobed p orbital.',
      },
      {
        at: 38,
        instant: true,
        params: { basis: 'complex', ...one(4, 3, 3), streamlines: true, densityScale: 1.1 },
        caption: 'Maximum winding m = ℓ = 3: three phase turns, three current cells. Quantisation is geometry.',
      },
      { at: 41, instant: true, params: { ...one(2, 1, 0), streamlines: false } },
    ],
  },
  {
    id: 'order-from-randomness',
    label: 'Order from Randomness',
    summary: 'The Born rule made visible: individually random clicks, collectively a wavefunction.',
    durationSec: 50,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: { basis: 'complex', render: 'pointcloud', particleCount: 6000, measure: false, densityScale: 1, camDist: 34, ...one(3, 1, 1) },
        caption: 'Sampling view: each dot is one hypothetical position measurement, drawn from |Ψ|².',
      },
      {
        at: 8,
        params: { particleCount: 26000 },
        caption: 'Add samples. No dot knows the orbital exists — the pattern is entirely statistical.',
      },
      {
        at: 18,
        params: { particleCount: 62000 },
        caption: 'Sixty thousand independent draws and the nodal structure resolves out of pure chance.',
      },
      {
        at: 26,
        instant: true,
        params: { measure: true, measureRate: 320, collapse: false, render: 'raymarch', ...one(2, 0, 0) },
        caption: 'Detector on. Every click is unpredictable; the accumulated histogram is exactly the cloud.',
      },
      {
        at: 34,
        instant: true,
        params: two([2, 0, 0], [2, 1, 0], 0.5, 0.866, 1.571),
        caption: 'Same detector on a beating superposition: the accumulated hits change their pattern over time.',
      },
      {
        at: 42,
        instant: true,
        params: { collapse: true },
        caption: 'With projective collapse enabled, a burst re-prepares the atom in whichever state was found.',
      },
      { at: 48, instant: true, params: { measure: false, collapse: false, ...one(2, 0, 0) } },
    ],
  },
  {
    id: 'hybridization',
    label: 'Hybridisation Morphing',
    summary: 'From one spherical s orbital to five and six directional bonds, by exact linear combinations.',
    durationSec: 44,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: { basis: 'complex', ...one(2, 0, 0), render: 'isosurface', octant: false, isoLevel: 0.16, densityScale: 1.2, camDist: 30, streamlines: false },
        caption: 'Start with 2s: one sphere. Chemically useless for directional bonding.',
      },
      {
        at: 7,
        instant: true,
        params: { basis: 'hybrid', hybrid: 'none', ...one(2, 1, 0) },
        caption: 'And 2p: two lobes along an axis. Mixing s and p is what makes bonds point somewhere.',
      },
      {
        at: 14,
        instant: true,
        params: { hybrid: 'sp', n: 2, l: 1, m: 0 },
        caption: 'sp: two opposed lobes, 180° apart. Linear molecules like BeCl₂.',
      },
      {
        at: 21,
        instant: true,
        params: { hybrid: 'sp2' },
        caption: 'sp²: three lobes at 120° in a plane, with the leftover p orbital standing through it.',
      },
      {
        at: 28,
        instant: true,
        params: { hybrid: 'sp3' },
        caption: 'sp³: four tetrahedral lobes at 109.5° — the shape of every carbon you have ever touched.',
      },
      {
        at: 35,
        instant: true,
        params: { hybrid: 'sp3d' },
        caption: 'sp³d: trigonal bipyramidal. Six lobes appear for sp³d² (octahedral).',
      },
      {
        at: 41,
        instant: true,
        params: { hybrid: 'sp3d2', render: 'raymarch', densityScale: 1.5 },
        caption: 'Hybridisation is not new physics — it is just a change of basis in the same hydrogenic space.',
      },
      { at: 44, instant: true, params: { basis: 'complex', hybrid: 'none', ...one(1, 0, 0), render: 'raymarch' } },
    ],
  },
];

export default orbitalisDemos;
