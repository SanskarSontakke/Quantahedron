'use client';

/**
 * Harmonic Oscillator — charts.
 *
 * Two surfaces live here:
 *
 *  • `Dock` — the pair of glass cards anchored inside the bottom of the stage
 *    (the stage reserves exactly `DOCK_H + 30` px for them). The static geometry
 *    is drawn with the shared `PlotCanvas`; the moving centroid and its trail are
 *    painted on a transparent overlay canvas straight from `oscPort`, so the 60
 *    fps motion never touches React state.
 *
 *  • `OscillatorPanel` — the inspector tab holding the `PhasorMatrix` amplitude
 *    dials plus the |cₙ|² verification rig (measured populations against the
 *    analytic Poisson weights, on the same axis).
 *
 * Everything plotted is computed from the ladder algebra — no decorative numbers.
 */

import { useCallback, useRef, type ReactNode } from 'react';
import { PlotCanvas, label, plotFrame, plotGrid } from '@/components/ui/PlotCanvas';
import { PhasorMatrix, type PhasorBasisCell } from '@/components/stage/PhasorMatrix';
import { cx } from '@/components/ui/controls';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { pBool, pNum, useSimParams, useSimStore } from '@/store/useSimStore';
import type { SimParams, SimSlug } from '@/simulations/types';
import {
  MAX_LEVELS,
  TRAIL,
  moments,
  oscPort,
  poissonWeights,
  stateCoeffs,
} from './physics';
import { is2D, renderDepth } from './controls';

const ACCENT = '#34d399';
const SLACK = 'rgba(148,163,184,0.55)';
/** Chart height inside the dock (the card adds ~30 px of chrome). */
const DOCK_H = 116;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ------------------------------ population data ---------------------------- */

interface PopData {
  depth: number;
  pops: number[];
  exact: number[] | null;
  nbar: number;
  norm: number;
  absA: number;
  coherent: boolean;
  omega: number;
  /** √(⟨E⟩/ω) — the classical shell radius in α units. */
  shell: number;
}

/** Measured |cₙ|² of the rendered state, plus the analytic Poisson reference. */
function popData(p: SimParams): PopData {
  const omega = clamp(pNum(p, 'omega', 1), 0.05, 8);
  const c = stateCoeffs(p);
  const m = moments(c, omega);
  const depth = Math.max(1, Math.min(MAX_LEVELS, Math.max(renderDepth(p), c.ns.length)));
  const pops = new Array<number>(depth).fill(0);
  for (let i = 0; i < c.ns.length; i++) {
    const n = Math.round(c.ns[i] ?? 0);
    if (n >= 0 && n < depth) pops[n] = (c.re[i] ?? 0) ** 2 + (c.im[i] ?? 0) ** 2;
  }
  return {
    depth,
    pops,
    exact: c.coherent ? poissonWeights(c.absA, depth) : null,
    nbar: m.nbar,
    norm: c.norm,
    absA: c.absA,
    coherent: c.coherent,
    omega,
    shell: Math.sqrt(Math.max(0.25, m.nbar + 0.5)),
  };
}

/* ---------------------------------- Dock ----------------------------------- */

export function Dock({ slug }: { slug: SimSlug }) {
  const params = useSimParams(slug);
  const inspectorOpen = useSimStore((s) => s.inspectorOpen);
  const twoD = is2D(params);
  const ladder = pBool(params, 'showLadder', true);
  const phase = pBool(params, 'showPhaseSpace', true) && !twoD;
  if (!ladder && !phase) return null;
  return (
    <div
      role="group"
      aria-label="Docked oscillator charts"
      className={cx(
        'pointer-events-none absolute bottom-3 left-4 flex gap-3',
        inspectorOpen ? 'right-4 lg:right-[360px]' : 'right-4',
      )}
    >
      {ladder ? <LadderCard params={params} grow={phase ? undefined : 1} /> : null}
      {phase ? <PhaseCard params={params} grow={ladder ? undefined : 1} /> : null}
    </div>
  );
}

function Card({
  title,
  note,
  children,
  grow,
}: {
  title: string;
  note: string;
  children: ReactNode;
  grow?: number;
}) {
  return (
    <div
      className="glass flex min-w-0 flex-col rounded-xl px-2 pb-1 pt-1.5"
      style={grow ? { flexGrow: grow, flexBasis: 0 } : { width: 214, flexShrink: 0 }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
          {title}
        </span>
        <span className="shrink-0 font-mono text-[9.5px] text-ink-dim" data-telemetry>
          {note}
        </span>
      </div>
      <div className="relative mt-0.5">{children}</div>
    </div>
  );
}

/* ------------------------------ energy ladder ------------------------------ */

function LadderCard({ params, grow }: { params: SimParams; grow?: number }) {
  const d = popData(params);
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const pad = { l: 24, r: 8, t: 9, b: 15 };
      const xMaxE = d.depth + 0.5;
      const plotW = w - pad.l - pad.r;
      const plotH = h - pad.t - pad.b;
      const toPx = (E: number, v: number): [number, number] => [
        pad.l + (plotW * E) / xMaxE,
        h - pad.b - plotH * (1 - clamp(v, 0, 1.05)),
      ];
      plotFrame(ctx, w, h, pad);
      plotGrid(ctx, w, h, pad, 3, Math.min(10, d.depth));

      const barW = Math.max(2, (plotW / xMaxE) * 0.55);
      ctx.save();
      for (let n = 0; n < d.depth; n++) {
        const v = d.pops[n] ?? 0;
        const [x, yTop] = toPx(n + 0.5, v);
        const [, yBase] = toPx(n + 0.5, 0);
        // the rung itself: a tick on the energy axis, brightened by occupation
        ctx.strokeStyle = 'rgba(148,163,184,0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - barW / 2, yBase);
        ctx.lineTo(x + barW / 2, yBase);
        ctx.stroke();
        if (v > 1e-6) {
          ctx.fillStyle = ACCENT;
          ctx.globalAlpha = 0.22 + 0.6 * Math.min(1, v);
          ctx.fillRect(x - barW / 2, yTop, barW, Math.max(0.8, yBase - yTop));
          ctx.globalAlpha = 1;
          ctx.fillStyle = 'rgba(236,253,245,0.95)';
          ctx.fillRect(x - barW / 2, yTop - 1.4, barW, 1.4);
        }
        if (d.depth <= 12 || n % 2 === 0) {
          ctx.fillStyle = 'rgba(107,125,153,0.9)';
          ctx.font = '8.5px "JetBrains Mono", ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${n}`, x, h - pad.b + 10);
        }
      }
      ctx.restore();

      if (d.exact) {
        // analytic Poisson weights — they must sit exactly on the bars
        ctx.save();
        ctx.strokeStyle = 'rgba(226,232,240,0.8)';
        ctx.lineWidth = 1.1;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        for (let n = 0; n < d.depth; n++) {
          const [x, y] = toPx(n + 0.5, d.exact[n] ?? 0);
          if (n === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // ⟨E⟩ = (⟨n⟩+½)ħω
      const [ex] = toPx(d.nbar + 0.5, 0);
      ctx.save();
      ctx.strokeStyle = 'rgba(251,191,36,0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(ex, pad.t);
      ctx.lineTo(ex, h - pad.b);
      ctx.stroke();
      ctx.restore();
      label(ctx, `⟨E⟩=${(d.nbar + 0.5).toFixed(2)}`, Math.min(w - 62, ex + 3), pad.t + 8, 'rgba(251,191,36,0.9)', 8.5);
      label(ctx, '|cₙ|²', pad.l - 21, pad.t + 7, SLACK, 8.5);
      label(ctx, d.coherent ? 'Poisson' : 'n', w - pad.r - 34, h - 3, SLACK, 8.5);
    },
    [d],
  );

  return (
    <Card
      title={d.coherent ? 'Glauber populations' : 'Level populations'}
      note={`Σ|c|² ${d.norm.toFixed(3)} · ⟨n⟩ ${d.nbar.toFixed(2)}`}
      grow={grow}
    >
      <PlotCanvas height={DOCK_H} draw={draw} deps={[d.depth, d.pops.join(','), d.exact?.join(','), d.nbar, d.coherent]} />
    </Card>
  );
}

/* ------------------------------- phase space ------------------------------- */

interface Pad {
  l: number;
  r: number;
  t: number;
  b: number;
}

function phaseMap(w: number, h: number, R: number) {
  const pad: Pad = { l: 16, r: 10, t: 9, b: 14 };
  const span = Math.max(8, Math.min(w - pad.l - pad.r, h - pad.t - pad.b));
  const cx0 = pad.l + (w - pad.l - pad.r) / 2;
  const cy0 = pad.t + (h - pad.t - pad.b) / 2;
  const s = span / (2 * R);
  return { pad, cx0, cy0, s, toPx: (a: number, b: number): [number, number] => [cx0 + a * s, cy0 - b * s] };
}

/** (x, p) in ℓ, ħ/ℓ → the dimensionless centroid coordinates (Re⟨a⟩, Im⟨a⟩). */
const toAlpha = (x: number, p: number, omega: number): [number, number] => [
  x * Math.sqrt(omega / 2),
  p / Math.sqrt(2 * omega),
];

function PhaseCard({ params, grow }: { params: SimParams; grow?: number }) {
  const d = popData(params);
  const R = Math.max(0.85, 1.08 * Math.max(d.shell, d.coherent ? d.absA : 0));
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const { pad, cx0, cy0, s } = phaseMap(w, h, R);
      plotGrid(ctx, w, h, pad, 4, 4);
      ctx.save();
      ctx.strokeStyle = 'rgba(148,163,184,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.l, cy0);
      ctx.lineTo(w - pad.r, cy0);
      ctx.moveTo(cx0, pad.t);
      ctx.lineTo(cx0, h - pad.b);
      ctx.stroke();

      // classical energy shell |α|_cl = √(⟨E⟩/ω)
      ctx.strokeStyle = 'rgba(148,163,184,0.45)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(cx0, cy0, d.shell * s, 0, Math.PI * 2);
      ctx.stroke();

      if (d.coherent) {
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(52,211,153,0.85)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(cx0, cy0, d.absA * s, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      label(ctx, `±${R.toFixed(1)}`, w - pad.r - 20, cy0 - 4, 'rgba(107,125,153,0.9)', 8);
      label(ctx, `shell √(E/ω)=${d.shell.toFixed(2)}`, pad.l - 10, h - 3, 'rgba(148,163,184,0.7)', 8);
      label(ctx, d.coherent ? `|α|=${d.absA.toFixed(2)}` : '|⟨a⟩|', pad.l - 10, pad.t + 6, SLACK, 8.5);
    },
    [R, d],
  );

  const live = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const { cx0, cy0, toPx } = phaseMap(w, h, R);
      const n = oscPort.trailN;
      if (n > 1) {
        ctx.save();
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(94,234,212,0.55)';
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const k = (oscPort.trailHead - n + i + TRAIL * 2) % TRAIL;
          const [ax, ay] = toAlpha(oscPort.trailX[k], oscPort.trailY[k], d.omega);
          const [px, py] = toPx(ax, ay);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }
      const [hx, hy] = toAlpha(oscPort.x, oscPort.p, d.omega);
      const [px, py] = toPx(hx, hy);
      ctx.save();
      ctx.strokeStyle = 'rgba(52,211,153,0.35)';
      ctx.beginPath();
      ctx.moveTo(cx0, cy0);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = 'rgba(236,253,245,0.95)';
      ctx.beginPath();
      ctx.arc(px, py, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
    [R, d],
  );

  return (
    <Card
      title="Phase space  Re⟨a⟩ / Im⟨a⟩"
      note={`x=√(2/ω)Re⟨a⟩ · ω=${d.omega.toFixed(2)}`}
      grow={grow}
    >
      <PlotCanvas height={DOCK_H} draw={draw} deps={[R, d.shell, d.coherent, d.absA, d.omega]} />
      <LiveCanvas draw={live} />
    </Card>
  );
}

/**
 * Transparent 60 fps overlay for the dock. It reads the stage's `oscPort` every
 * frame and paints directly — no React state, so the inspector, the telemetry
 * pill and the stage all keep their own render cadence.
 */
function LiveCanvas({ draw }: { draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useAnimationClock(() => {
    const cv = ref.current;
    if (!cv) return;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (w < 8 || h < 8) return;
    const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (cv.width !== bw || cv.height !== bh) {
      cv.width = bw;
      cv.height = bh;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawRef.current(ctx, w, h);
  });
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 block h-full w-full"
    />
  );
}

/* --------------------------- inspector: amplitudes ------------------------- */

const CELLS: PhasorBasisCell[] = Array.from({ length: MAX_LEVELS }, (_, i) => ({
  n: i,
  l: 0,
  m: 0,
  label: `|${i}⟩`,
}));

export function OscillatorPanel({ slug }: { slug: SimSlug }) {
  const params = useSimParams(slug);
  const d = popData(params);
  const cells = CELLS.slice(0, clamp(Math.max(10, d.depth), 1, MAX_LEVELS));
  const c = stateCoeffs(params);
  const argA = Math.atan2(c.alphaIm, c.alphaRe);

  let maxDev = 0;
  if (d.exact) {
    for (let n = 0; n < d.depth; n++) maxDev = Math.max(maxDev, Math.abs((d.pops[n] ?? 0) - (d.exact[n] ?? 0)));
  }

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const pad = { l: 30, r: 10, t: 12, b: 18 };
      plotFrame(ctx, w, h, pad);
      plotGrid(ctx, w, h, pad, 4, Math.min(10, d.depth));
      const plotW = w - pad.l - pad.r;
      const plotH = h - pad.t - pad.b;
      const toPx = (n: number, v: number): [number, number] => [
        pad.l + (plotW * (n + 0.5)) / d.depth,
        h - pad.b - plotH * (1 - clamp(v, 0, 1)),
      ];
      const barW = Math.max(2.5, (plotW / d.depth) * 0.6);
      for (let n = 0; n < d.depth; n++) {
        const v = d.pops[n] ?? 0;
        const ph = c.coherent ? n * argA : 0;
        const [x, y] = toPx(n, v);
        const [, base] = toPx(n, 0);
        ctx.fillStyle = d.coherent
          ? `hsla(${(((ph * 180) / Math.PI + 360) % 360).toFixed(0)}, 70%, 62%, 0.8)`
          : ACCENT;
        ctx.globalAlpha = 0.25 + 0.7 * Math.min(1, v);
        ctx.fillRect(x - barW / 2, y, barW, Math.max(0.6, base - y));
        ctx.globalAlpha = 1;
      }
      if (d.exact) {
        ctx.save();
        ctx.strokeStyle = 'rgba(226,232,240,0.85)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        for (let n = 0; n < d.depth; n++) {
          const [x, y] = toPx(n, d.exact[n] ?? 0);
          if (n === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }
      label(ctx, '|cₙ|²', pad.l - 26, pad.t + 7, SLACK, 9);
      label(ctx, 'n', w - pad.r - 8, h - 4, SLACK, 9);
    },
    [d, c, argA],
  );

  return (
    <div className="pt-1">
      <div className="mb-2 text-[11px] leading-relaxed text-ink-dim">
        {d.coherent ? (
          <>
            The Glauber toggle owns the amplitudes right now:{' '}
            <span className="font-mono text-ink">cₙ = e^(−|α|²/2)·αⁿ/√(n!)</span> with |α| ={' '}
            <span className="font-mono text-ink">{d.absA.toFixed(3)}</span>. Switch it off to dial a
            hand-built superposition; the dials below always edit the same arrays.
          </>
        ) : (
          <>
            Drag outward from a dial to raise |cₙ|, around it to set arg cₙ. The state is the
            superposition Σ cₙ|n⟩ rendered on the stage; its total weight Σ|cₙ|² is printed next to
            the buttons.
          </>
        )}
      </div>

      <PhasorMatrix
        slug={slug}
        nKey="hn"
        lKey="hampL"
        mKey="hampM"
        ampKey="hampAmp"
        phaseKey="hampPhase"
        cells={cells}
        maxSlots={10}
        title="Superposition Σ cₙ|n⟩"
      />

      <div className="mt-2">
        <PlotCanvas height={140} draw={draw} deps={[d.depth, d.pops.join(','), d.exact?.join(','), d.coherent, argA]} />
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-1.5">
        <Mini label="Σ|cₙ|²" value={d.norm.toFixed(4)} />
        <Mini label="⟨n⟩" value={d.nbar.toFixed(3)} />
        <Mini label="|α|" value={c.absA.toFixed(3)} />
        <Mini label="arg α" value={`${argA.toFixed(3)} rad`} />
        <Mini label="Poisson Fano Var/⟨n⟩" value={c.fano.toFixed(4)} />
        <Mini
          label="max |cₙ|² − Poisson"
          value={d.exact ? maxDev.toExponential(1) : '— (not coherent)'}
        />
      </dl>
      <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
        Bars are the coefficients actually fed into ψ(x,t); the dashed line is the closed-form Poisson
        weight {'e^(−|α|²)·|α|²ⁿ/n!'}. They agree to{' '}
        {d.exact ? `${maxDev.toExponential(1)} (double precision)` : 'n/a'} — the log-space
        normalisation √(2ⁿn!) is what keeps that true up to n = {MAX_LEVELS - 1}.
      </p>
    </div>
  );
}

function Mini({ label: t, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-hairline bg-obsidian-2/70 px-2 py-1">
      <dt className="text-[9px] uppercase tracking-wide text-ink-faint">{t}</dt>
      <dd className="font-mono text-[11.5px] text-ink" data-telemetry>
        {value}
      </dd>
    </div>
  );
}
