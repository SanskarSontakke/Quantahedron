/**
 * Sim 4 — telemetry rows for the Inspector's Diagnostics tab.
 *
 * Every value here is an *exact* function of the permalinked parameters: the closed
 * forms from `splitStepFFT` plus the folding of the packet's Gaussian momentum
 * distribution through them. The time-dependent numbers the integrator produces
 * (‖ψ‖², the absorbed fractions, the measured T) are on the canvas HUD and in the
 * Beam tab, which read the live frame port directly.
 */

import type { SimParams, TelemetryItem } from '@/simulations/types';
import { pBool, pNum } from '@/store/useSimStore';
import {
  analyticalT,
  barrierOf,
  buildTunnelSetup,
  clampNum,
  eMaxOf,
  geomOf,
  groupVelocity,
  gridTOf,
  kOfEnergy,
  massOf,
  packetMeanT,
  phasePerStep,
  probeEnergy,
  sigmaKOf,
  sigmaXOf,
  TUN_BOX_AU,
  tCurveOf,
  wkbT,
} from './model';
import { evanescentKappa } from '@/engine/physics/splitStepFFT';

const pct = (v: number): string =>
  v >= 0.01 ? `${(v * 100).toFixed(v >= 0.1 ? 1 : 2)} %` : `${(v * 100).toExponential(2)} %`;

const sig = (v: number, d = 4): string =>
  !Number.isFinite(v) ? '—' : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(d - 1) : v.toFixed(d);

export function tunnelTelemetry(p: SimParams): TelemetryItem[] {
  const g = geomOf(p);
  const mass = massOf(p);
  const e0 = clampNum(pNum(p, 'E0', 7), 0.02, 80);
  const k0 = kOfEnergy(e0, mass);
  const kappa = evanescentKappa(e0, g.v0, mass, 1);
  const tExact = analyticalT(p, e0);
  const fold = packetMeanT(p);
  const curve = tCurveOf(p);
  const n = gridTOf(p);
  const dx = TUN_BOX_AU / n;
  const setup = buildTunnelSetup(p);
  const phase = phasePerStep(setup);
  const probe = probeEnergy(p);
  const v = eMaxOf(p);
  const ratio = e0 / g.v0;
  const resonances = curve.resonances;
  const nearest = resonances.length
    ? resonances.reduce((best, e) => (Math.abs(e - e0) < Math.abs(best - e0) ? e : best), resonances[0])
    : 0;

  return [
    {
      label: 'E₀ / V₀',
      value: ratio.toFixed(3),
      hint: ratio < 1 ? 'classically forbidden — every transmitted particle tunneled' : 'over-the-barrier, interference still modulates T',
      tone: ratio < 1 ? 'accent' : 'default',
    },
    {
      label: 'k₀ = √(2mE₀)',
      value: k0.toFixed(4),
      hint: `λ = ${(2 * Math.PI) / Math.max(1e-9, k0)} a.u., v_group = ${groupVelocity(e0, mass).toFixed(3)}`,
    },
    {
      label: 'κ under the barrier',
      value: kappa > 0 ? kappa.toFixed(4) : '0 (propagating)',
      hint: kappa > 0 ? `ψ ∝ e^(−κx): amplitude ÷ e every ${(1 / kappa).toFixed(3)} a.u.` : 'E₀ above the local barrier top',
      tone: kappa > 0 ? 'warn' : 'good',
    },
    {
      label: 'Gamow factor e^(−2κa)',
      value: kappa > 0 ? sig(Math.exp(-2 * kappa * g.a)) : '1',
      hint: `a = ${g.a.toFixed(3)} a.u. — the exponential part of T, before the prefactor`,
    },
    {
      label: 'Analytical T(E₀)',
      value: sig(tExact, 6),
      hint: `${pct(tExact)} — ${barrierOf(p) === 'tri' ? 'transfer-matrix product (24 slices)' : 'closed form'}`,
      tone: 'accent',
    },
    {
      label: 'WKB T(E₀)',
      value: sig(wkbT(p, e0), 6),
      hint: 'e^(−2∫κdx): agrees with the exact curve wherever the profile is smooth compared with 1/κ',
    },
    {
      label: 'Packet ⟨T⟩',
      value: sig(fold.mean, 6),
      hint: `Δk = ${sigmaKOf(p).toFixed(3)}, σ_x = ${sigmaXOf(p).toFixed(3)} a.u., ΔE ≈ ${fold.spread.toFixed(2)} — the beam is not monochromatic`,
    },
    {
      label: 'Brightest component',
      value: `T ${sig(fold.tPeak, 4)} at E = ${fold.ePeak.toFixed(3)}`,
      hint: `T(E₀) = ${sig(tExact, 4)}; the packet's high-energy tail always leaks first`,
    },
    {
      label: 'Unitarity resonances',
      value:
        resonances.length === 0
          ? 'none in the window'
          : `${resonances.length} modes, first at E = ${resonances[0].toFixed(3)}`,
      hint: resonances.length
        ? `${resonances.length} points below E = ${v.toFixed(1)}; nearest to E₀ is ${nearest.toFixed(3)} (Δ = ${Math.abs(nearest - e0).toFixed(3)}), where T = ${sig(analyticalT(p, nearest), 6)}${barrierOf(p) === 'double' ? ' — barrier penetration pulls the cavity modes below n²π²/2·gap²' : ''}`
        : 'thicken the barrier or switch to the double well to open the Fabry–Pérot comb',
      tone: resonances.length ? 'good' : 'default',
    },
    {
      label: 'Probe energy',
      value: `E = ${probe.toFixed(3)} → T = ${sig(analyticalT(p, probe), 6)}`,
      hint: pNum(p, 'energyScan', 0) < 0.05 ? 'following E₀' : 'manual sweep marker',
    },
    {
      label: 'Lattice',
      value: `N = ${n}, dx = ${dx.toFixed(4)}`,
      hint: `Δt = ${setup.dt.toFixed(4)}, ${Math.round(pNum(p, 'stepsPerFrame', 8))} steps/frame → ${(setup.dt * pNum(p, 'stepsPerFrame', 8) * 60).toFixed(2)} a.u. of physical time per second`,
    },
    {
      label: 'Δt·(V₀ + E_max)',
      value: phase.toFixed(4),
      hint: 'phase a single Strang kick-drift-kick must resolve on the fastest occupied mode',
      tone: phase < 0.3 ? 'good' : 'warn',
    },
    {
      label: 'Sponge',
      value: pNum(p, 'capWidth', 0.07) <= 0 ? 'off' : `${(clampNum(pNum(p, 'capWidth', 0.07), 0, 0.3) * TUN_BOX_AU).toFixed(2)} a.u. × ${pNum(p, 'capStrength', 0.45).toFixed(2)}`,
      hint: pBool(p, 'stmMode', false)
        ? 'beam panel hidden by STM mode'
        : 'absorbed probability is billed left/right, so T keeps counting after detection',
      tone: pNum(p, 'capWidth', 0.07) <= 0 ? 'warn' : 'default',
    },
  ];
}

export default tunnelTelemetry;
