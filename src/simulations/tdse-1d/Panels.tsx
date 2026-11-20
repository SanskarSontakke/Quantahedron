'use client';

/**
 * Sim 3 — the Solver tab of the inspector.
 *
 * `telemetry(p)` is contractually a pure function of the parameters, but the whole
 * point of a PDE solver is the numbers it *measures* while running. This panel is
 * the bridge: it polls the mutable `liveTdse` channel that the animation loop
 * writes every frame, at 5 Hz, so React re-renders on a human cadence instead of a
 * frame cadence and the 60 fps path never touches state.
 *
 * The headline is norm conservation. Crank–Nicolson is a Cayley ([1/1] Padé) form
 * of e^(−iΔtH), so ‖ψ‖ must stay constant to rounding error — |drift| below 1e-5 is
 * the pass condition printed here, and the same quantity is on the canvas HUD.
 */

import { useEffect, useState } from 'react';
import { PlotCanvas } from '@/components/ui/PlotCanvas';
import { SectionTitle, cx } from '@/components/ui/controls';
import { pNum, useSimStore } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';
import { BOX_AU, gridNOf, liveTdse } from './model';

interface Snapshot {
  ready: boolean;
  worker: boolean;
  t: number;
  steps: number;
  norm: number;
  norm0: number;
  drained: number;
  drift: number;
  maxDrift: number;
  x: number;
  p: number;
  energy: number;
  kinetic: number;
  potentialE: number;
  sum: number;
  topLevel: number;
  topWeight: number;
  fps: number;
  diagMs: number;
  eigenCount: number;
  weights: number[];
  energies: number[];
}

function read(): Snapshot {
  const w = liveTdse.weights;
  const e = liveTdse.energies;
  return {
    ready: liveTdse.ready,
    worker: liveTdse.worker,
    t: liveTdse.t,
    steps: liveTdse.steps,
    norm: liveTdse.norm,
    norm0: liveTdse.norm0,
    drained: liveTdse.drained,
    drift: liveTdse.drift,
    maxDrift: liveTdse.maxDrift,
    x: liveTdse.x,
    p: liveTdse.p,
    energy: liveTdse.energy,
    kinetic: liveTdse.kinetic,
    potentialE: liveTdse.potentialE,
    sum: liveTdse.weightsSum,
    topLevel: liveTdse.topLevel,
    topWeight: liveTdse.topWeight,
    fps: liveTdse.fps,
    diagMs: liveTdse.diagMs,
    eigenCount: liveTdse.eigenCount,
    weights: w ? Array.from(w) : [],
    energies: e ? Array.from(e) : [],
  };
}

const sci = (v: number, d = 2): string =>
  !Number.isFinite(v) ? '—' : v === 0 ? '0' : Math.abs(v) < 1e-3 || Math.abs(v) >= 1e4 ? v.toExponential(d) : v.toFixed(d);

function Row({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
      <span className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
      <span className="text-right">
        <span className={cx('font-mono text-[12px]', tone ?? 'text-ink')} data-telemetry>
          {value}
        </span>
        {hint ? <span className="block font-mono text-[10px] text-ink-faint">{hint}</span> : null}
      </span>
    </div>
  );
}

export function SolverPanel({ slug }: { slug: SimSlug }) {
  const params = useSimStore((s) => s.params[slug]);
  const [snap, setSnap] = useState<Snapshot>(() => read());

  useEffect(() => {
    const id = window.setInterval(() => setSnap(read()), 200);
    return () => window.clearInterval(id);
  }, []);

  const n = params ? gridNOf(params) : 512;
  const dx = BOX_AU / n;
  const dt = pNum(params ?? {}, 'dt', 0.0004);
  const good = snap.drift < 1e-5;
  const occ = snap.weights.length ? snap.weights : [];
  const maxOcc = Math.max(1e-9, ...occ, 1e-6);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <SectionTitle
          right={
            <span
              className={cx(
                'rounded-full border px-2 py-0.5 font-mono text-[10px]',
                snap.worker
                  ? 'border-sky-400/40 bg-sky-400/10 text-sky-200'
                  : 'border-amber-400/40 bg-amber-400/10 text-amber-200',
              )}
            >
              {snap.worker ? 'web worker' : 'main thread'}
            </span>
          }
        >
          Conservation
        </SectionTitle>
        <Row
          label="‖ψ‖² now"
          value={snap.norm.toFixed(8)}
          hint={`launched at ${snap.norm0.toFixed(4)} · sponge drained ${sci(snap.drained)}`}
          tone={good ? 'text-emerald-300' : 'text-amber-300'}
        />
        <Row
          label="unitarity |‖ψ‖²+drain−‖ψ₀‖²|"
          value={sci(snap.drift)}
          hint={`worst since reset ${sci(snap.maxDrift)} · pass < 1e-5 (round-off only)`}
          tone={good ? 'text-emerald-300' : 'text-amber-300'}
        />
        <Row
          label="accumulated"
          value={`${snap.steps.toLocaleString()} steps`}
          hint={`t = ${snap.t.toFixed(3)} a.u. · ${snap.fps.toFixed(0)} fps · ${snap.diagMs.toFixed(2)} ms/frame`}
        />
        {!snap.ready ? (
          <p className="mt-2 text-[11px] text-ink-faint">
            Solver idle — press play (Space) to start integrating.
          </p>
        ) : null}
      </div>

      <div>
        <SectionTitle>Expectation values</SectionTitle>
        <Row label="⟨x⟩" value={`${snap.x.toFixed(4)} a.u.`} hint={`box ${(BOX_AU).toFixed(0)} a.u.`} />
        <Row label="⟨p⟩" value={snap.p.toFixed(5)} hint="ℏ = m = 1" />
        <Row
          label="⟨H⟩"
          value={snap.energy.toFixed(5)}
          hint={`T ${snap.kinetic.toFixed(4)} + V ${snap.potentialE.toFixed(4)}`}
        />
      </div>

      <div>
        <SectionTitle
          right={<span className="font-mono text-[10px] text-ink-faint">Σ|⟨φₖ|ψ⟩|² = {snap.sum.toFixed(3)}</span>}
        >
          Occupation
        </SectionTitle>
        {occ.length > 0 ? (
          <>
            <PlotCanvas
              height={112}
              draw={(ctx, w, h) => {
                const pad = 6;
                const bw = (w - pad * 2) / occ.length;
                ctx.fillStyle = 'rgba(148,163,184,0.09)';
                ctx.fillRect(pad, h - 16, w - pad * 2, 1);
                for (let i = 0; i < occ.length; i++) {
                  const v = Math.min(1, occ[i] / maxOcc);
                  const bh = v * (h - 34);
                  ctx.fillStyle = i === snap.topLevel ? 'rgba(56,189,248,0.95)' : 'rgba(56,189,248,0.55)';
                  ctx.fillRect(pad + i * bw + 1, h - 16 - bh, Math.max(1, bw - 2), bh);
                  if (bw > 12) {
                    ctx.fillStyle = 'rgba(148,163,184,0.75)';
                    ctx.font = '9px ui-monospace, monospace';
                    ctx.fillText(`${i}`, pad + i * bw + 3, h - 5);
                  }
                }
                ctx.fillStyle = 'rgba(226,232,240,0.8)';
                ctx.font = '10px ui-monospace, monospace';
                ctx.fillText(
                  snap.topLevel >= 0
                    ? `most occupied |φ${snap.topLevel}⟩  E=${(snap.energies[snap.topLevel] ?? 0).toFixed(2)}  ${(snap.topWeight * 100).toFixed(1)}%`
                    : 'no spectrum loaded',
                  pad,
                  11,
                );
              }}
              deps={[snap.weights, snap.topLevel, snap.energies]}
            />
            <p className="mt-1 text-[10px] text-ink-faint">
              |⟨φₖ|ψ(t)|² against the {snap.eigenCount} levels diagonalised from the same tridiagonal H the propagator
              applies (dx = {dx.toFixed(4)}, Δt = {dt.toExponential(1)}).
            </p>
          </>
        ) : (
          <p className="text-[11px] text-ink-faint">
            Switch to the <span className="font-mono text-ink">eigen spectrum</span> view (key 3) or enable the level
            overlay to diagonalise H.
          </p>
        )}
      </div>
    </div>
  );
}

export default SolverPanel;
