'use client';

/**
 * Sim 4 — the Beam tab of the inspector.
 *
 * The contract's `telemetry(p)` is pure in the parameters, so every *measured*
 * number the propagator produces lives here instead: the panel polls the
 * `liveTunnel` port at 5 Hz (the animation loop writes it every frame) and shows
 * the detector ledger, the unitarity residual and the simulated-vs-exact
 * transmission agreement.
 *
 * The headline is the comparison a physicist actually cares about: a Gaussian
 * packet of spread Δk is not monochromatic, so the number the beam line converges
 * to is ⟨T⟩ folded over its own momentum distribution, not T(E₀). Both are
 * printed next to the measurement.
 */

import { useEffect, useState } from 'react';
import { evanescentKappa } from '@/engine/physics/splitStepFFT';
import { PlotCanvas } from '@/components/ui/PlotCanvas';
import { SectionTitle, cx } from '@/components/ui/controls';
import { pNum, useSimStore } from '@/store/useSimStore';
import type { SimParams, SimSlug } from '@/simulations/types';
import {
  analyticalT,
  clampNum,
  geomOf,
  groupVelocity,
  liveTunnel,
  massOf,
  packetMeanT,
  tCurveOf,
  type TCurve,
} from './model';

interface Snapshot {
  ready: boolean;
  t: number;
  steps: number;
  norm: number;
  drained: number;
  drift: number;
  maxDrift: number;
  transmitted: number;
  reflected: number;
  inside: number;
  tMeasured: number;
  resolved: boolean;
  x: number;
  p: number;
  energy: number;
  peak: number;
  fps: number;
  solverMs: number;
  n: number;
  dt: number;
}

function read(): Snapshot {
  return {
    ready: liveTunnel.ready,
    t: liveTunnel.t,
    steps: liveTunnel.steps,
    norm: liveTunnel.norm,
    drained: liveTunnel.drained,
    drift: liveTunnel.drift,
    maxDrift: liveTunnel.maxDrift,
    transmitted: liveTunnel.transmitted,
    reflected: liveTunnel.reflected,
    inside: liveTunnel.inside,
    tMeasured: liveTunnel.tMeasured,
    resolved: liveTunnel.resolved,
    x: liveTunnel.x,
    p: liveTunnel.p,
    energy: liveTunnel.energy,
    peak: liveTunnel.peak,
    fps: liveTunnel.fps,
    solverMs: liveTunnel.solverMs,
    n: liveTunnel.n,
    dt: liveTunnel.dt,
  };
}

const sci = (v: number, d = 3): string =>
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

/** The measured split as a stacked bar: reflected · still inside · transmitted. */
function Ledger({ snap }: { snap: Snapshot }) {
  const total = Math.max(1e-9, snap.transmitted + snap.reflected + snap.inside);
  const r = snap.reflected / total;
  const i = snap.inside / total;
  const t = snap.transmitted / total;
  return (
    <div className="mt-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full border border-white/10 bg-white/5">
        <div style={{ width: `${(r * 100).toFixed(2)}%` }} className="h-full bg-rose-400/70" />
        <div style={{ width: `${(i * 100).toFixed(2)}%` }} className="h-full bg-slate-400/40" />
        <div style={{ width: `${(t * 100).toFixed(2)}%` }} className="h-full bg-emerald-300/70" />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint">
        <span className="text-rose-300/80">R {(r * 100).toFixed(1)}%</span>
        <span>in flight {(i * 100).toFixed(1)}%</span>
        <span className="text-emerald-300/80">T {(t * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}

/** Log-scale agreement strip: exact curve, packet band, measured point. */
function Agreement({ snap, params }: { snap: Snapshot; params: SimParams }) {
  const curve: TCurve = tCurveOf(params);
  const e0 = clampNum(pNum(params, 'E0', 7), 0.02, 80);
  const tExact = analyticalT(params, e0);
  const fold = packetMeanT(params);
  return (
    <PlotCanvas
      height={120}
      draw={(ctx, w, h) => {
        const pad = 6;
        const yBot = h - 14;
        const yTop = 12;
        const eMax = Math.max(curve.eMax, 1e-6);
        const xPix = (e: number): number => pad + (clampNum(e / eMax, 0, 1)) * (w - pad * 2);
        const yPix = (t: number): number => yBot - ((Math.log10(clampNum(t, 1e-6, 1)) + 6) / 6) * (yBot - yTop);
        ctx.fillStyle = 'rgba(251,191,36,0.08)';
        const v0 = geomOf(params).v0;
        if (v0 < eMax) ctx.fillRect(pad, yTop, Math.max(0, xPix(v0) - pad), yBot - yTop);
        ctx.beginPath();
        for (let i = 0; i < curve.e.length; i++) {
          const x = xPix(curve.e[i]);
          const y = yPix(curve.t[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(251,191,36,0.95)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        if (snap.tMeasured > 0) {
          ctx.strokeStyle = 'rgba(94,234,212,0.8)';
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(pad, yPix(snap.tMeasured));
          ctx.lineTo(w - pad, yPix(snap.tMeasured));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle = 'rgba(226,232,240,0.85)';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(`exact T(E₀) ${sci(tExact)}`, pad, 9);
        ctx.fillStyle = 'rgba(94,234,212,0.9)';
        ctx.fillText(`⟨T⟩ packet ${sci(fold.mean)}  ΔE ${fold.spread.toFixed(2)}`, pad + 132, 9);
        ctx.fillStyle = 'rgba(148,163,184,0.8)';
        ctx.fillText(`measured ${sci(snap.tMeasured)}`, pad + 300, 9);
      }}
      deps={[snap.tMeasured, curve]}
    />
  );
}

export function BeamPanel({ slug }: { slug: SimSlug }) {
  const stored = useSimStore((s) => s.params[slug]);
  const params: SimParams = stored ?? {};
  const [snap, setSnap] = useState<Snapshot>(() => read());

  useEffect(() => {
    const id = window.setInterval(() => setSnap(read()), 200);
    return () => window.clearInterval(id);
  }, []);

  const geom = geomOf(params);
  const e0 = clampNum(pNum(params, 'E0', 7), 0.02, 80);
  const mass = massOf(params);
  const kappa = evanescentKappa(e0, geom.vmax, mass, 1);
  const tExact = analyticalT(params, e0);
  const fold = packetMeanT(params);
  const good = snap.drift < 1e-6;
  const ratio = snap.tMeasured > 0 && tExact > 0 ? snap.tMeasured / tExact : 0;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <SectionTitle
          right={
            <span
              className={cx(
                'rounded-full border px-2 py-0.5 font-mono text-[10px]',
                snap.resolved ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : 'border-white/15 text-ink-faint',
              )}
            >
              {snap.resolved ? 'packets separated' : 'in flight'}
            </span>
          }
        >
          Detectors
        </SectionTitle>
        <Row
          label="transmitted"
          value={snap.transmitted.toFixed(6)}
          hint={`sponge + far field, of the launch norm ${snap.norm > 0 ? ((snap.transmitted / Math.max(1e-9, snap.transmitted + snap.reflected + snap.inside)) * 100).toFixed(1) : '0.0'} %`}
          tone="text-emerald-300"
        />
        <Row label="reflected" value={snap.reflected.toFixed(6)} hint="return current past the left plane" tone="text-rose-300" />
        <Row
          label="measured T"
          value={sci(snap.tMeasured)}
          hint={`exact T(E₀) ${sci(tExact)} · packet ⟨T⟩ ${sci(fold.mean)}`}
        />
        <Row
          label="sim / exact"
          value={ratio > 0 ? ratio.toFixed(4) : '—'}
          hint="deviates by Δk, not by solver error: narrow the momentum spread to converge"
          tone={ratio > 0.9 && ratio < 1.1 ? 'text-emerald-300' : undefined}
        />
        <Ledger snap={snap} />
      </div>

      <div>
        <SectionTitle
          right={<span className="font-mono text-[10px] text-ink-faint">radix-2 FFT · main thread</span>}
        >
          Unitarity ledger
        </SectionTitle>
        <Row
          label="‖ψ‖² now"
          value={snap.norm.toFixed(8)}
          hint={`sponge drained ${sci(snap.drained)} (billed per side)`}
        />
        <Row
          label="unitarity |‖ψ‖²+drain−1|"
          value={sci(snap.drift, 1)}
          hint={`worst since relaunch ${sci(snap.maxDrift, 1)} · Strang splitting is exactly norm preserving`}
          tone={good ? 'text-emerald-300' : 'text-amber-300'}
        />
        <Row
          label="accumulated"
          value={`${snap.steps.toLocaleString()} steps`}
          hint={`t = ${snap.t.toFixed(2)} a.u. · ${snap.fps.toFixed(0)} fps · ${snap.solverMs.toFixed(2)} ms/frame`}
        />
        {!snap.ready ? (
          <p className="mt-2 text-[11px] text-ink-faint">
            Beam idle — press play (Space), or hit ⟲ relaunch on the canvas to fire a fresh packet.
          </p>
        ) : null}
      </div>

      <div>
        <SectionTitle>Beam state</SectionTitle>
        <Row label="⟨x⟩" value={`${snap.x.toFixed(3)} a.u.`} hint={`barrier spans ${geom.left.toFixed(2)} … ${geom.right.toFixed(2)}`} />
        <Row label="⟨p⟩" value={snap.p.toFixed(4)} hint={`v_group = ${groupVelocity(e0, mass).toFixed(3)} a.u.`} />
        <Row label="⟨H⟩" value={snap.energy.toFixed(4)} hint={`launch E₀ = ${e0.toFixed(3)} · κ = ${kappa > 0 ? kappa.toFixed(3) : '0'}`} />
        <Row label="grid" value={`N ${snap.n}`} hint={`Δt = ${snap.dt.toFixed(4)}, dx = ${(24 / snap.n).toFixed(4)}`} />
        <Agreement snap={snap} params={params} />
        <p className="mt-1 text-[10px] text-ink-faint">
          Amber region is E &lt; V₀. The sky step is the run&apos;s own accumulated transmission; where it sits on the
          gold curve is the whole point of the lab.
        </p>
      </div>
    </div>
  );
}

export default BeamPanel;
