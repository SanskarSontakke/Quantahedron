/**
 * Sim 3 — auto-demo scripts (§3.4).
 *
 * Both tours are written against the *measured* spectra of this engine: the level
 * doublets, band widths and group velocities quoted in the captions come from
 * `eigenSpectrum` / a Crank–Nicolson run at the exact keyframe parameters, so the
 * numbers on screen agree with the numbers in the text.
 *
 * Time budget note: physical time advances at `stepsPerFrame·Δt` per rendered
 * frame, so the tours push Δt up to 0.006 a.u. — harmless because the CN map is
 * exactly unitary and Δt·E ≪ 1 on the occupied levels (see the telemetry row).
 */

import type { DemoScript } from '@/simulations/types';

export const tdseDemos: DemoScript[] = [
  {
    id: 'double-well-tunneling',
    label: 'Double-Well Tunneling',
    summary:
      'A packet trapped in one side of a symmetric double well: thin the central barrier and watch the crossing rate explode by the WKB factor e^(−κ·gap), then detune the far well and switch tunneling off completely.',
    durationSec: 64,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          potential: 'double',
          V0: 6,
          wellWidth: 0.5,
          barrierGap: 0.1,
          asymmetry: 0,
          x0: 0.36,
          sigma: 0.06,
          k0: 0,
          packetAmp: 1,
          gridN: 512,
          dt: 0.006,
          stepsPerFrame: 20,
          capWidth: 0.07,
          capStrength: 0.12,
          view: 'density',
          showPotential: true,
          showEigen: true,
          eigenCount: 6,
          colorPhase: true,
          logDensity: false,
        },
        caption:
          'A packet is dropped into the left well of a symmetric double well: V₀ = 6 a.u., barrier 0.10 of the box (1.5 a.u.) wide. Diagonalising the same tridiagonal H gives the ground doublet at 0.3914 / 0.3930 — split by ΔE = 1.5×10⁻³.',
      },
      {
        at: 9,
        caption:
          'The sloshing period is π/ΔE ≈ 2000 a.u., i.e. about four minutes at this frame rate. So far the density looks frozen — and that is the point: an insulating barrier makes tunneling *slow*, not impossible.',
      },
      {
        at: 14,
        params: { barrierGap: 0.06 },
        caption:
          'Thin the barrier to 0.06 (0.9 a.u.). ΔE jumps 1.5×10⁻³ → 8.9×10⁻³, a factor of 5.8 for a 40 % width change. The breathing becomes visible: period 353 a.u. ≈ 49 s.',
      },
      {
        at: 26,
        params: { barrierGap: 0.03 },
        caption:
          'Now 0.03: ΔE = 3.49×10⁻², period 90 a.u. ≈ 12 s of wall time. The packet crosses *completely* — the left-well population runs 0.98 → 0.02 → 0.98 — with no change of algorithm, only of geometry.',
      },
      {
        at: 40,
        caption:
          'Same twelve lines of Thomas algorithm, exponential sensitivity: κ = √(2(V₀−E)) = 3.4 a.u.⁻¹, so the rate scales like e^(−κ·gap). Removing 0.45 a.u. of barrier multiplies the crossing rate by e^1.5 ≈ 4.6; the solver says ×3.9, the WKB exponent says ×4.6, and the difference is the prefactor.',
      },
      {
        at: 46,
        params: { asymmetry: 0.5 },
        caption:
          'Tilt the right well up by 0.5·V₀ = 3 a.u. The wells are no longer degenerate: the pair that mattered is now 0.297 (left) against 3.3 (right), a detuning of Δ = 3 versus a coupling of ħΩ = 0.035.',
      },
      {
        at: 54,
        caption:
          'Maximum transfer for a detuned two-level system is (2t)²/(Δ² + (2t)²) = 1.4×10⁻⁴ — the sloshing has vanished into the noise. Resonance, not barrier thinness, is what carries current through an asymmetric double well (and through every tunnel diode, and the ammonia maser).',
      },
      {
        at: 58,
        instant: true,
        params: { asymmetry: 0, view: 'spectrum' },
        caption:
          'Back on resonance, and into the spectrum view: the ground doublet (0.278, 0.313) shares the packet almost evenly, |⟨φ₀|ψ⟩|² ≈ |⟨φ₁|ψ⟩|². Their phase difference advancing at ΔE/ħ *is* the tunneling oscillation you just watched.',
      },
      {
        at: 64,
        params: { view: 'spectrum' },
        caption:
          'Every curve on this screen — the density, the ladder, the crossing rate — is one tridiagonal solve repeated. Press 1 to return to |ψ|² and drive the barrier slider yourself.',
      },
    ],
  },
  {
    id: 'crystal-bands',
    label: 'Crystal Bands',
    summary:
      'Kronig–Penney lattice: launch packets across the first Brillouin zone, watch the group velocity collapse at the zone edge, then count exactly one level per period in every band.',
    durationSec: 60,
    keyframes: [
      {
        at: 0,
        instant: true,
        params: {
          potential: 'kronig',
          kronigPeriods: 6,
          latticeDepth: 2,
          V0: 6,
          x0: 0.13,
          sigma: 0.1,
          k0: 8,
          packetAmp: 1,
          gridN: 512,
          dt: 0.004,
          stepsPerFrame: 16,
          capWidth: 0.08,
          capStrength: 0.35,
          view: 'density',
          showPotential: true,
          showEigen: true,
          eigenCount: 26,
          colorPhase: true,
          logDensity: false,
          asymmetry: 0,
        },
        caption:
          'Six lattice periods across the 15 a.u. box: a = 2.5 a.u., so the first zone edge sits at k = π/a = 1.26 (the k₀ slider reads 18.9 there). Depth 2 is a nearly-free electron gas; a packet at k₀ = 8 (k = 0.53) runs at v_g = 0.31.',
      },
      {
        at: 11,
        params: { k0: 26 },
        caption:
          'Relaunch at k₀ = 26 (k = 1.73, beyond the zone edge). Measured from d⟨x⟩/dt the group velocity has fallen to 0.03: the lattice is a Bragg reflector for wavelengths λ = 2a, and the packet can no longer leave.',
      },
      {
        at: 22,
        params: { k0: 19, latticeDepth: 6 },
        caption:
          'Sit exactly on the zone edge and deepen the lattice to 6. Band 1 keeps exactly 6 levels — one per period, the Bloch count — squeezed from 1.02–1.46 into 1.37–1.70, and the forbidden window above it widens from 2.25 to 3.66 a.u.',
      },
      {
        at: 34,
        instant: true,
        params: { view: 'spectrum', latticeDepth: 18 },
        caption:
          'Depth 18 in the spectrum view: six dense levels, then a 3.7 a.u. void up to 5.36. A packet prepared inside that void has *no* eigencomponent to travel on — |ψ|² can only breathe in place.',
      },
      {
        at: 44,
        params: { kronigPeriods: 12, view: 'density' },
        caption:
          'Double the crystal to 12 periods. The first band now holds 12 levels and the gap edges stay where they were: band structure is set by the unit cell, while the number of states in a band is set by the sample size. That is the thermodynamic limit, visible on one slider.',
      },
      {
        at: 53,
        params: { kronigPeriods: 3, latticeDepth: 6 },
        caption:
          'Three periods and the continuum dissolves back into a handful of molecular levels — the same solver spans a metal, a semiconductor and a molecule without changing a line of code.',
      },
      {
        at: 60,
        params: { kronigPeriods: 3 },
        caption:
          'Press 1–4 to switch views by hand: the density shows Bloch’s theorem as a period-matched ripple, the spectrum shows why some of those ripples are forbidden.',
      },
    ],
  },
];

export default tdseDemos;
