/**
 * Stern–Gerlach Spin — live telemetry (top-left pill).
 *
 * `telemetry(p)` only sees the flat parameter map, so the animated quantities
 * (display phase, Monte-Carlo totals) come from the mirrors the canvas writes a
 * few times per second, and everything else is recomputed with `buildModel` +
 * `chainAt` — literally the same calls the bench makes each frame. No number in
 * this pill is decorative: each one is either an engine output or a store mirror.
 */

import { angleBetween, blochVector, precess, v3 } from '@/engine/physics/blochSpin';
import { pNum } from '@/store/useSimStore';
import type { SimParams, TelemetryItem } from '@/simulations/types';
import { GAMMA_E_RAD_S_T, REFERENCE_MT, buildModel, chainAt, malusChain, openChainAt, portLabel } from './chain';

const deg = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(2)}°`;

const pct = (v: number): string => `${(100 * v).toFixed(3)}%`;

export function sternGerlachTelemetry(p: SimParams): TelemetryItem[] {
  const m = buildModel(p);
  const turns = pNum(p, 'phaseTurnsLive', 0);
  const chain = chainAt(m, turns);
  const open = openChainAt(m, turns);
  const live = blochVector(precess(m.input, v3(0, 0, 1), Math.PI * 2 * turns));
  const mal = malusChain(m);
  const shots = Math.round(pNum(p, 'shotsLive', 0));
  const detected = Math.round(pNum(p, 'detectedLive', 0));
  const empirical = shots > 0 ? detected / shots : NaN;
  const dev = shots > 0 ? empirical - chain.transmitted : NaN;

  const items: TelemetryItem[] = [
    {
      label: 'prepared |χ⟩',
      value: `θ ${m.thetaDeg.toFixed(2)}° · φ ${m.phiDeg.toFixed(2)}°`,
      hint: `|↑⟩ amplitude ${Math.cos((m.thetaDeg * Math.PI) / 360).toFixed(4)}`,
      tone: 'accent',
    },
    {
      label: '⟨σz⟩',
      value: live[2].toFixed(6),
      hint: `P(+z) = ${pct((1 + live[2]) / 2)}`,
    },
    {
      label: '⟨σx⟩',
      value: live[0].toFixed(6),
      hint: `P(+x) = ${pct((1 + live[0]) / 2)}`,
    },
    {
      label: '⟨σy⟩',
      value: live[1].toFixed(6),
      hint: `P(+y) = ${pct((1 + live[1]) / 2)}`,
    },
    {
      label: 'purification',
      value: `|⟨σ⃗⟩| = ${Math.hypot(live[0], live[1], live[2]).toFixed(6)}`,
      hint: `unit length ⇒ pure state · stage ${Math.round(pNum(p, 'activeStageLive', 0))}/${m.count}`,
      tone: Math.abs(Math.hypot(live[0], live[1], live[2]) - 1) < 1e-6 ? 'good' : 'default',
    },
  ];

  m.stages.forEach((st, i) => {
    const os = open.stages[i];
    const cs = chain.stages[i];
    if (!os || !cs) return;
    items.push({
      label: `SG${i + 1} · ${st.kind === 'custom' ? `az ${st.azDeg.toFixed(0)}° el ${st.elDeg.toFixed(0)}°` : `${st.kind}̂`}`,
      value: `+${pct(os.up)} −${pct(os.down)}`,
      hint: `in ${os.incident.toFixed(4)} → out ${cs.transmitted.toFixed(4)} · absorbed ${(cs.incident - cs.transmitted).toFixed(4)}`,
      tone: cs.incident - cs.transmitted > 1e-9 ? 'warn' : 'default',
    });
  });

  items.push({
    label: 'exit channels',
    value: chain.channels
      .slice(0, 3)
      .map((c) => `${portLabel(c.path)} ${pct(c.probability)}`)
      .join('  '),
    hint:
      chain.channels.length > 3
        ? `${chain.channels.length} open channels, Σ = ${chain.channels.reduce((s, c) => s + c.probability, 0).toFixed(6)}`
        : `Σ = ${chain.channels.reduce((s, c) => s + c.probability, 0).toFixed(6)}`,
    tone: 'accent',
  });

  items.push({
    label: 'beam counter',
    value: `${detected}/${shots}`,
    hint: Number.isFinite(empirical)
      ? `empirical ${pct(empirical)} vs theory ${pct(chain.transmitted)} · Δ = ${(dev * 100).toFixed(2)} pp`
      : 'no atoms fired yet',
    tone: Number.isFinite(dev) && Math.abs(dev) < 0.03 ? 'good' : 'default',
  });

  if (mal.length) {
    items.push({
      label: 'Malus',
      value: mal.map((x) => `${pct(x.t)}`).join(' · '),
      hint: mal.map((x) => `${x.angleDeg.toFixed(1)}°`).join(' → ') + ' between analyser axes',
    });
  }

  items.push({
    label: 'Larmor',
    value: m.larmorMT > 0 ? `${deg(m.trueAngleRad)} per flight` : 'off (B = 0)',
    hint:
      m.larmorMT > 0
        ? `ω_L = ${(m.omegaLarmor / 1e9).toFixed(3)} grad/s = ${GAMMA_E_RAD_S_T.toExponential(4)}·B · display ${(
            (Math.PI * 2 * m.precessionHz * m.larmorMT) /
            REFERENCE_MT
          ).toFixed(2)} rad/s, ×${m.slowMotion.toExponential(1)} slow`
        : 'raise the guide field to precess the spinor between analysers',
    tone: m.larmorMT > 0 ? 'accent' : 'default',
  });

  if (m.count >= 3) {
    // P(SG3 = − | SG1 = +): 0 without the middle analyser, ½ once it is inserted.
    let sel = 0;
    let flip = 0;
    for (const c of chain.channels) {
      if (c.path[0] !== 1) continue;
      sel += c.probability;
      if (c.path[2] === -1) flip += c.probability;
    }
    const pFlip = sel > 1e-12 ? flip / sel : NaN;
    const parallel = angleBetween(m.stages[0].axis, m.stages[2].axis) < 1e-9;
    items.push({
      label: 'knowledge erased',
      value: Number.isFinite(pFlip) ? `P(SG3 = − | SG1 = +) = ${pct(pFlip)}` : 'SG1 beam closed',
      hint: parallel
        ? 'SG1 ∥ SG3: any value of S_z the first analyser sorted out has been reset by the intermediate measurement'
        : `SG1 and SG3 differ by ${deg(angleBetween(m.stages[0].axis, m.stages[2].axis))}`,
      tone: Number.isFinite(pFlip) && pFlip > 0.4 ? 'good' : 'default',
    });
  }

  return items;
}
