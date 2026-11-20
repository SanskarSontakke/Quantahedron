/**
 * de Broglie Ring — live telemetry shown in the top-left pill.
 *
 * Pure function of the flat state, so a shared permalink reproduces the exact
 * numbers. Orbit tab reports the winding problem (n, λ, integer residual,
 * round-trip buildup Q); Scale Explorer tab reports the beam (λ, p, λ/a).
 */

import type { SimParams, TelemetryItem } from '@/simulations/types';
import { pStr } from '@/store/useSimStore';
import { deBroglieSI, formatAngle, formatEnergyEv, formatLength, formatMomentum, ringState } from './physics';

export function deBroglieTelemetry(p: SimParams): TelemetryItem[] {
  if (pStr(p, 'tab', 'orbit') === 'scale') {
    const d = deBroglieSI(p);
    return [
      {
        label: 'λ = h/p',
        value: formatLength(d.lambdaM),
        hint: `(${d.lambdaM.toExponential(3)} m)`,
        tone: 'accent',
      },
      {
        label: 'p',
        value: formatMomentum(d.pSI),
        hint: d.relativistic ? `γ = ${d.gamma.toFixed(3)}` : 'non-relativistic',
      },
      {
        label: 'λ / a',
        value: d.ratio >= 1e-3 && d.ratio < 1e4 ? d.ratio.toFixed(4) : d.ratio.toExponential(2),
        hint: `a = ${formatLength(d.apertureM)} ⇒ θ₁ ≈ ${formatAngle(d.firstNullRad)}`,
        tone: d.ratio > 1e-3 ? 'good' : 'warn',
      },
      {
        label: 'K',
        value: formatEnergyEv(d.kineticEv),
        hint: `mc² = ${formatEnergyEv(d.restEv)}`,
      },
    ];
  }

  const r = ringState(p);
  const q = r.quality;
  return [
    {
      label: 'n = 2πr/λ',
      value: r.n.toFixed(3),
      hint: r.lamAU > 0 ? `(${r.nRaw.toFixed(3)} before capture)` : '',
      tone: Math.abs(r.n - Math.round(r.n)) < 1e-3 ? 'good' : 'warn',
    },
    {
      label: 'λ',
      value: `${r.lamAU.toFixed(2)} a₀`,
      hint: `${r.wavelengthNm.toFixed(3)} nm`,
    },
    {
      label: '2πr/λ − round(n)',
      value: `${r.residual >= 0 ? '+' : ''}${r.residual.toFixed(4)}`,
      hint: `resonance at 2πr = ${Math.round(r.n)}λ`,
      tone: Math.abs(r.residual) < 0.02 ? 'good' : 'warn',
    },
    {
      label: '|∮e^{i2πnk}dk|/K',
      value: q.toFixed(3),
      hint: `K = ${r.circuits} turns`,
      tone: q > 0.9 ? 'good' : q > 0.4 ? 'accent' : 'warn',
    },
    { label: 'r', value: `${r.rAU.toFixed(2)} a₀`, hint: `${r.radiusNm.toFixed(3)} nm` },
  ];
}
