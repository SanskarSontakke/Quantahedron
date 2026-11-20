import type { DemoScript } from '@/simulations/types';

/**
 * Guided tours for Sim 9 (§3.4 Demo Director).
 *
 * Numeric params tween between keyframes with an ease-in-out curve, so a bond
 * literally slides; strings and booleans snap at their keyframe instant, which is
 * what makes the σ → σ* flip read as a discrete quantum jump rather than a morph.
 */
export const molecularDemos: DemoScript[] = [
  {
    id: 'bond-formation',
    label: 'Bond Formation',
    summary:
      'Pull two hydrogen atoms from R = 10 a₀ down into the 1sσg well and read the potential-energy curve as the bond forms — attraction, balance, then Z²/R repulsion.',
    durationSec: 30,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          ao: '1s',
          combo: 'bonding',
          Z: 1,
          zetaMode: 'variational',
          render: 'raymarch',
          showCurve: true,
          curveModel: 'exact1s',
          markEquilibrium: true,
          showNodePlane: false,
          monochrome: false,
          exposure: 1.2,
          camDist: 26,
          camAz: 0.45,
          camEl: 0.16,
          R: 10,
        },
        caption: 'Two separated H atoms. S = 0, no bond: U sits exactly on the −0.500 Ha atomic limit.',
      },
      {
        at: 5,
        params: { R: 6 },
        caption: 'The clouds start to interpenetrate — S(R) climbs and ψ₊ begins leaking density into the bonding region.',
      },
      {
        at: 10,
        params: { R: 3.2 },
        caption: 'Attraction wins: the curve drops below the dissociation limit and the cursor slides down the wall.',
      },
      {
        at: 15,
        params: { R: 2.0 },
        caption: 'Equilibrium. dU/dR = 0 at R₀ ≈ 2.0 a₀ (106 pm) — polarisation exactly balances Z²/R.',
      },
      {
        at: 19,
        params: { R: 1.25 },
        caption: 'Compressed inside R₀ the internuclear repulsion takes over and the curve turns steeply upward.',
      },
      {
        at: 23,
        params: { R: 2.0 },
        caption: 'Released: the bond relaxes back to the bottom of the well, Dₑ ≈ 0.087 Ha below the atoms.',
      },
      {
        at: 26,
        params: { curveModel: 'morse' },
        caption: 'The same valley written analytically — Morse V(R) = Dₑ(1 − e^{−a(R−R₀)})², fitted to H₂⁺.',
      },
    ],
  },
  {
    id: 'bonding-vs-antibonding',
    label: 'Bonding vs Antibonding',
    summary:
      'Hold the bond at R₀ and flip the sign of the superposition: watch the nodal plane appear between the nuclei while the level jumps above the dissociation limit.',
    durationSec: 27,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          ao: '1s',
          combo: 'bonding',
          Z: 1,
          zetaMode: 'variational',
          render: 'raymarch',
          showCurve: true,
          curveModel: 'exact1s',
          markEquilibrium: true,
          showNodePlane: true,
          showNuclei: true,
          monochrome: false,
          exposure: 1.25,
          isoLevel: 0.35,
          camDist: 20,
          camAz: 0.5,
          camEl: 0.18,
          R: 2,
        },
        caption: '1sσg at R = 2 a₀: |ψ|² bridges the two protons, 0.087 Ha below the separated atoms.',
      },
      {
        at: 6,
        params: { exposure: 1.8 },
        caption: 'Look along the bond axis — the amplitude is the sum φ_A + φ_B, largest exactly where it attracts both nuclei.',
      },
      {
        at: 9,
        params: { combo: 'antibonding', exposure: 1.25 },
        caption: 'Flip the sign: ψ₋ = φ_A − φ_B. The two amplitudes cancel on the midpoint plane.',
      },
      {
        at: 13,
        params: { R: 2.4 },
        caption: 'The curve cursor jumps above the dissociation limit — σu* is repulsive at every R. Bond order 0.',
      },
      {
        at: 17,
        params: { render: 'isosurface', isoLevel: 0.22 },
        caption: 'The iso-shell isolates the node: two lobes facing away from each other, nothing holding the pair together.',
      },
      {
        at: 21,
        params: { render: 'raymarch', combo: 'bonding', R: 2.0, isoLevel: 0.35 },
        caption: 'Back to bonding — the bridge returns and the level drops below the atoms again.',
      },
      {
        at: 26,
        params: { camAz: 3.64 },
        caption: 'Orbit through the nodal plane: the phase colours swap lobes, but |ψ|² — the observable — never changes.',
      },
    ],
  },
];

export default molecularDemos;
