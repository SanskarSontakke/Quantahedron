/**
 * Orbitalis 3D — telemetry pill.
 *
 * Every number here is the *true* physical value in atomic units or eV — never a
 * display-scaled one. The renderer slows time down so the eye can follow it; the
 * read-out quotes what nature actually does.
 */

import type { SimParams, TelemetryItem } from '@/simulations/types';
import { ATOMIC_TIME_S, HARTREE_EV } from '@/engine/physics/constants';
import { radialNodes, rExpectation, angularNodes } from '@/engine/physics/hydrogen';
import { pNum } from '@/store/useSimStore';
import { beatPeriodSec, buildOrbitalState, displayOmega, expectations } from './state';

function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return v.toFixed(digits);
}

export function orbitalisTelemetry(p: SimParams): TelemetryItem[] {
  const state = buildOrbitalState(p);
  const omegaVis = displayOmega(state);
  const { eAvg, L2, Lz } = expectations(state);
  const nMax = state.nMax;
  const Z = state.Z;
  const rMean = rExpectation(Math.round(nMax), Math.round(pNum(p, 'l', 0)), Z);
  const period = beatPeriodSec(state.amps.map((a) => a.amp), omegaVis);
  const dominant = state.amps.reduce(
    (best, a) => (a.amp > best.amp ? a : best),
    state.amps[0] ?? { n: 1, l: 0, m: 0, amp: 1, phase: 0 },
  );
  const trueGap = state.omega.length > 1 ? Math.abs(state.omega[0] - state.omega[1]) : 0;

  const items: TelemetryItem[] = [
    {
      label: '|Ψ⟩',
      value: `${state.amps.length}-state`,
      hint: `dominant ${dominant.n}${'spdfghi'[dominant.l] ?? ''}(m=${dominant.m})`,
      tone: 'accent',
    },
    {
      label: '⟨E⟩',
      value: `${fmt(eAvg, 4)} eV`,
      hint: `${fmt(eAvg / HARTREE_EV, 5)} Ha`,
    },
    {
      label: '|L|',
      value: `${fmt(L2, 2)} ℏ`,
      hint: `⟨Lz⟩ = ${fmt(Lz, 2)} ℏ`,
    },
    {
      label: 'nodes',
      value: `${radialNodes(dominant.n, dominant.l)}r + ${angularNodes(dominant.l)}θ`,
      hint: `⟨r⟩ = ${fmt(rMean, 2)} a₀`,
    },
  ];

  if (period) {
    items.push({
      label: 'beat',
      value: `${fmt(period, 1)} s on screen`,
      hint:
        trueGap > 0
          ? `true gap ${fmt(trueGap * HARTREE_EV * 1e3, 3)} meV · period ${((2 * Math.PI / trueGap) * ATOMIC_TIME_S).toExponential(2)} s`
          : undefined,
      tone: 'good',
    });
  }

  const B = pNum(p, 'zeemanB', 0);
  if (B > 0) {
    const split = Math.abs(state.zeemanEv[1] ?? state.zeemanEv[0] ?? 0);
    items.push({ label: 'Zeeman', value: `${fmt(split * 1e3, 3)} meV`, hint: `B = ${fmt(B, 1)} T`, tone: 'warn' });
  }
  const F = pNum(p, 'starkE', 0);
  if (F > 0) {
    const stark = Math.abs(state.starkHa[0] ?? 0) * HARTREE_EV;
    items.push({ label: 'Stark', value: `${fmt(stark * 1e3, 3)} meV`, hint: `F = ${fmt(F, 2)}·10⁹ V/m`, tone: 'warn' });
  }

  return items;
}

export default orbitalisTelemetry;
