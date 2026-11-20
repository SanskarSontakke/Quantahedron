/**
 * Dipole Transitions — live telemetry (top-left pill).
 *
 * `telemetry(p)` only ever sees the flat parameter map, so every dynamical
 * quantity here is a value the canvas mirrored into the store a few times per
 * second (`p2Live`, `pulseArea`, …). Everything else is recomputed from
 * `computeAtom`, which is the same function the integrator is fed — a displayed
 * number can never disagree with the one being simulated.
 */

import type { SimParams, TelemetryItem } from '@/simulations/types';
import { pNum, pStr } from '@/store/useSimStore';
import { computeAtom } from './physics';
import { rabiFormula } from './atom';

/** Compact rad·s⁻¹ formatter: 1.550e16 rather than 15500000000000000. */
const rad = (v: number): string => (Math.abs(v) >= 1e4 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(3) : v.toFixed(2));

const pct = (v: number): string => `${(100 * v).toFixed(1)}%`;

export function dipoleTelemetry(p: SimParams): TelemetryItem[] {
  const a = computeAtom(p);
  const p2 = Math.min(1, Math.max(0, pNum(p, 'p2Live', 0)));
  const area = pNum(p, 'pulseArea', 0);
  const tNs = pNum(p, 'tLiveNs', 0);
  const maxInv = a.omegaGen > 1e-9 ? (a.rabi * a.rabi) / (a.omegaGen * a.omegaGen) : 0;
  const analytic = rabiFormula(
    { omega0: a.omega0, delta: a.detuning, rabi: a.rabi, gamma: 0 },
    tNs * 1e-9,
  );

  return [
    {
      label: 'transition',
      value: `${a.iLabel} → ${a.fLabel}`,
      hint: `${a.series} · Z = ${a.Z}`,
      tone: 'accent',
    },
    {
      label: 'ħω₁₂',
      value: `${a.deltaE.toFixed(4)} eV`,
      hint: Number.isFinite(a.wavelengthNm) ? `λ = ${a.wavelengthNm.toFixed(2)} nm` : 'degenerate',
    },
    {
      label: 'ω₁₂',
      value: `${rad(a.omega0)} s⁻¹`,
      hint: `ν = ${rad(a.laserHz)} Hz`,
    },
    {
      label: 'Δ = ω_L − ω₁₂',
      value: `${rad(a.detuning)} s⁻¹`,
      hint:
        a.rabi > 1e-9
          ? `Δ/Ω_R = ${(a.detuning / a.rabi).toFixed(2)}`
          : Number.isFinite(a.detuning)
            ? 'laserRel − 1'
            : '—',
      tone: Math.abs(a.relDetune) < 1e-3 ? 'good' : 'default',
    },
    {
      label: '|d_fi|',
      value: a.allowed ? `${a.absD.toFixed(5)} e·a₀` : `${a.absD.toExponential(2)} e·a₀`,
      hint: a.element.verdict,
      tone: a.allowed ? 'good' : 'warn',
    },
    {
      label: 'Ω_R',
      value: `${rad(a.rabi)} s⁻¹`,
      hint: `E₀ = ${a.eField.toExponential(2)} V/m · I = ${a.intensityWCm2 < 1e4 ? a.intensityWCm2.toFixed(2) : a.intensityWCm2.toExponential(2)} W/cm²`,
    },
    {
      label: 'Ω',
      value: `${rad(a.omegaGen)} s⁻¹`,
      hint: `ceiling Ω_R²/Ω² = ${pct(maxInv)}`,
    },
    {
      label: 'P₂',
      value: p2.toFixed(4),
      hint: `analytic ${analytic.toFixed(4)} · t = ${tNs < 10 ? tNs.toFixed(3) : tNs.toFixed(1)} ns`,
      tone: a.allowed ? (p2 > 0.995 ? 'good' : 'default') : 'warn',
    },
    {
      label: 'pulse area',
      value: `${area.toFixed(3)} rad`,
      hint: `π / Ω_R = ${Number.isFinite(a.tPiNs) ? `${a.tPiNs < 10 ? a.tPiNs.toFixed(4) : a.tPiNs.toFixed(2)} ns` : '∞ (dark)'}`,
      tone: Math.abs(area % (2 * Math.PI) - Math.PI) < 0.05 && a.allowed ? 'good' : 'default',
    },
    {
      label: '⟨d⟩',
      value: `${pNum(p, 'dipoleLive', 0).toFixed(3)} e·a₀`,
      hint:
        a.gamma > 0
          ? `τ = ${a.lifetimeNs.toFixed(2)} ns · emitted ${pct(Math.min(1, pNum(p, 'emittedLive', 0)))}`
          : 'undamped (γ = 0)',
    },
    {
      label: 'solver',
      value: `${pStr(p, 'integratorLive', 'rk4')} · ${Math.round(pNum(p, 'subSteps', 0))} substeps`,
      hint: `Ω_R/ω₁₂ = ${a.rwaRatio.toExponential(2)} (RWA)`,
    },
  ];
}
