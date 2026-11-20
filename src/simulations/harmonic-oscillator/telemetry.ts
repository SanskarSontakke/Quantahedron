/**
 * Harmonic Oscillator — telemetry.
 *
 * Every number here comes from the ladder algebra or from an exact quadrature of
 * the analytic Hermite–Gauss state; nothing is hard-coded or fudged. ⟨x⟩ and ⟨p⟩
 * oscillate, so the read-out reports their *amplitudes* (the classical turning
 * points of the packet centre), which are the time-independent part of the same
 * solution — the live instantaneous values are drawn on the phase-space dock.
 */

import type { SimParams, TelemetryItem } from '@/simulations/types';
import { pBool, pNum } from '@/store/useSimStore';
import {
  classicalDensity,
  evaluateWave,
  fmt,
  moments,
  poissonWeights,
  state2D,
  stateCoeffs,
  turningAmplitude,
} from './physics';
import { is2D } from './controls';

/** Σ|ψ|² outside |x| > A, as a fraction of the sampled probability. */
function leakage(ns: number[], re: number[], im: number[], omega: number, xMax: number, A: number): number {
  const f = evaluateWave(ns, re, im, omega, 4096, xMax);
  // piecewise-linear |ψ|² integrated with the trapezoid rule, split exactly at
  // ±A — a plain sample sum misses ~1 % on a sloping tail.
  const at = (x: number): number => {
    const t = Math.max(0, Math.min(f.count - 1.0001, (x - f.x0) / f.dx));
    const i = Math.floor(t);
    const u = t - i;
    return (f.density[i] ?? 0) * (1 - u) + (f.density[i + 1] ?? 0) * u;
  };
  const seg = (from: number, to: number): number => {
    if (to <= from) return 0;
    const steps = Math.max(1, Math.ceil((to - from) / f.dx));
    const h = (to - from) / steps;
    let s = 0;
    let prev = at(from);
    for (let k = 1; k <= steps; k++) {
      const cur = at(from + k * h);
      s += 0.5 * (prev + cur) * h;
      prev = cur;
    }
    return s;
  };
  const left = f.x0;
  const right = f.x0 + (f.count - 1) * f.dx;
  const tot = seg(left, right);
  if (tot <= 0) return 0;
  const inside = seg(Math.max(left, -A), Math.min(right, A));
  return Math.max(0, (tot - inside) / tot);
}

export function oscillatorTelemetry(p: SimParams): TelemetryItem[] {
  const omega = pNum(p, 'omega', 1);
  const xMax = pNum(p, 'xMax', 7);
  const coherent = pBool(p, 'coherent', false);

  if (is2D(p)) {
    const s = state2D(p, 0, 96);
    const r = Math.hypot(s.cx, s.cy);
    const pr = Math.hypot(s.cpx, s.cpy);
    return [
      { label: '⟨E⟩', value: `${fmt(s.energy, 3)} ħω`, hint: '2D isotropic well: (nₓ+n_y+1)ħω', tone: 'accent' },
      {
        label: 'Packet centre',
        value: `(${fmt(s.cx, 2)}, ${fmt(s.cy, 2)}) ℓ`,
        hint: `radius ${fmt(r, 2)} ℓ = √(2/ω)|α|`,
      },
      { label: '|⟨p⟩|', value: `${fmt(pr, 2)}`, hint: 'circulating momentum magnitude' },
      { label: 'Δx·Δp', value: '0.500 ħ', hint: 'every axis stays a minimum-uncertainty state', tone: 'good' },
      {
        label: 'Basis kept',
        value: s.coherent ? `${(s.kept * 100).toFixed(2)} %` : '100 %',
        hint: s.coherent ? 'Poisson weight inside the truncated basis' : 'degenerate product eigenstates',
        tone: s.kept > 0.999 ? 'good' : 'warn',
      },
    ];
  }

  const c = stateCoeffs(p);
  const m = moments(c, omega);
  const A = turningAmplitude(m.energy, omega);
  const xAmp = Math.sqrt(2 / omega) * Math.hypot(m.aRe, m.aIm);
  const pAmp = Math.sqrt(2 * omega) * Math.hypot(m.aRe, m.aIm);
  const leak = leakage(c.ns, c.re, c.im, omega, xMax, A);
  const classicalAt0 = A > 0 ? classicalDensity(0, A) : 0;
  const poisson = coherent ? poissonWeights(c.absA, Math.max(c.ns.length, 1)) : [];
  const peakW = poisson.length ? Math.max(...poisson) : 0;

  const items: TelemetryItem[] = [
    {
      label: '⟨x⟩ amplitude',
      value: `${fmt(xAmp, 3)} ℓ`,
      hint: pAmp > 0 ? `±A of the packet centre; ⟨p⟩ amplitude ${fmt(pAmp, 3)}` : 'state has no dipole moment',
    },
    { label: 'Δx', value: `${fmt(m.dx, 4)} ℓ`, hint: '√(⟨x²⟩−⟨x⟩²)' },
    { label: 'Δp', value: fmt(m.dp, 4), hint: '√(⟨p²⟩−⟨p⟩²)' },
    {
      label: 'Δx·Δp / ħ',
      value: m.product.toFixed(4),
      hint: m.product < 0.5005 ? 'saturates the Heisenberg bound' : 'above the ½ floor',
      tone: m.product < 0.5005 ? 'good' : 'default',
    },
    {
      label: '⟨E⟩',
      value: `${fmt(m.units, 3)} ħω`,
      hint: `(⟨n⟩ + ½)ħω = ${fmt(m.energy, 3)} in ω = ${omega.toFixed(2)} units`,
      tone: 'accent',
    },
    { label: '⟨n⟩', value: fmt(m.nbar, 3), hint: `${c.ns.length} amplitudes in the superposition` },
  ];

  if (coherent) {
    items.push({
      label: '|α|',
      value: fmt(c.absA, 3),
      hint: `arg α = ${fmt(Math.atan2(c.alphaIm, c.alphaRe), 3)} rad, ⟨n⟩ = |α|² = ${fmt(c.absA * c.absA, 3)}`,
      tone: 'accent',
    });
    items.push({
      label: 'Poisson Fano',
      value: fmt(m.nbar > 1e-9 ? c.fano : 1, 4),
      hint: `Var(n)/⟨n⟩ = 1 exactly; peak weight ${fmt(peakW, 3)} at n = ${Math.round(c.absA * c.absA)}`,
      tone: c.fano > 0.01 && Math.abs(c.fano - 1) < 0.02 ? 'good' : 'default',
    });
  } else {
    items.push({
      label: 'Σ|cₙ|²',
      value: fmt(c.norm, 4),
      hint: c.norm > 0.999 ? 'normalised superposition' : 'un-normalised — press Normalize in the dock',
      tone: c.norm > 0.999 ? 'good' : 'warn',
    });
  }

  items.push({
    label: 'Classical ±A',
    value: `±${fmt(A, 3)} ℓ`,
    hint: `E = ½ω²A² ⇒ P_cl(0) = ${fmt(classicalAt0, 3)}`,
  });
  items.push({
    label: 'Forbidden-region tail',
    value: `${(leak * 100).toFixed(2)} %`,
    hint: coherent
      ? '∫|ψ(x,0)|²dx outside ±A — the packet centre starts at the wall, so much of it is beyond'
      : 'probability beyond ±A, where the classical particle cannot be found',
    tone: leak > 0.02 ? 'warn' : 'good',
  });
  return items;
}
