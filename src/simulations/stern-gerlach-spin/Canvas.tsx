'use client';

/**
 * Sim 8 — Stern–Gerlach Spin & Bloch Sphere: the stage viewport.
 *
 * One Canvas2D beam bench, one R3F Bloch sphere, one animation clock and no
 * per-frame React state:
 *
 *  • `useAnimationClock` advances the display phase (Larmor turns) and the packet
 *    progress along the bench, recomputes the analytic chain — at most 8 rays, so
 *    it is free every frame — and writes the shared `liveSpin` singleton that the
 *    sphere reads inside `useFrame`;
 *  • each time a packet completes a lap, `sampleChain` deals another slice of the
 *    Monte-Carlo beam onto the detector, so the counts visibly converge to |P±χ|²;
 *  • the sphere is mounted with `next/dynamic(..., { ssr: false })`, so three.js is
 *    never evaluated during SSR.
 *
 * Changing any parameter that defines the chain re-arms the counter: the numbers
 * beside a histogram always belong to the apparatus being drawn.
 */

import { useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { blochVector, precess, v3, type BeamRay } from '@/engine/physics/blochSpin';
import { pBool, pNum, pStr, useSimStore } from '@/store/useSimStore';
import type { SimParams, SimSlug } from '@/simulations/types';
import { REFERENCE_MT, buildModel, chainAt, openChainAt, portLabel, shoot } from './chain';
import {
  createCounter,
  liveSpin,
  mergeShot,
  pushTrail,
  resetCounter,
  resetLiveSpin,
  type Counter,
} from './live';
import { buildBench, drawBench, drawBenchLegend, drawStageBookkeeping } from './render';

const BlochSphere = dynamic(() => import('./BlochSphere'), { ssr: false, loading: () => null });

/** Wall seconds for one packet to fly source → detector. */
const FLIGHT_SEC = 1.8;
/** Monte-Carlo batch size as a fraction of `beamCount`. */
const BATCHES = 6;
/** Minimum wall milliseconds between store write-backs of the live read-outs. */
const WRITEBACK_MS = 240;
const TAU = Math.PI * 2;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  w: number;
  h: number;
  dpr: number;
  bench: Box | null;
  book: Box | null;
  sphere: Box | null;
}

/** Fingerprint of everything that changes the physics of the chain. */
function chainKey(st: SimParams): string {
  const parts: string[] = [String(Math.round(pNum(st, 'stages', 3)))];
  for (let i = 1; i <= 3; i++) {
    parts.push(
      pStr(st, `a${i}Axis`, 'z'),
      pNum(st, `a${i}CustomAz`, 0).toFixed(1),
      pNum(st, `a${i}CustomEl`, 45).toFixed(1),
      pBool(st, `block${i}Up`, false) ? '1' : '0',
      pBool(st, `block${i}Down`, false) ? '1' : '0',
    );
  }
  parts.push(pNum(st, 'spinTheta', 0).toFixed(2), pNum(st, 'spinPhi', 0).toFixed(2));
  return parts.join('|');
}

export default function SternGerlachCanvas({ slug }: { slug: SimSlug }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const benchRef = useRef<HTMLCanvasElement>(null);
  const sphereRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const counterRef = useRef<Counter>(createCounter([]));
  const writeRef = useRef(0);
  const stageRef = useRef(0);
  const rerollRef = useRef(false);

  const params = useSimStore((s) => s.params[slug]);
  const setParams = useSimStore((s) => s.setParams);
  const resetToken = useSimStore((s) => s.resetToken);

  const model = buildModel(params);
  const key = chainKey(params);
  const turnsLive = pNum(params, 'phaseTurnsLive', 0);
  const stat = chainAt(model, turnsLive);

  /* ------------------------------- re-arm --------------------------------- */

  useEffect(() => {
    resetCounter(counterRef.current, []);
    resetLiveSpin(liveSpin);
    stageRef.current = 0;
  }, [key, resetToken]);

  const reroll = pBool(params, 'reroll', false);
  useEffect(() => {
    if (rerollRef.current === reroll) return;
    rerollRef.current = reroll;
    resetCounter(counterRef.current, []);
    counterRef.current.cycle += 1;
  }, [reroll]);

  /* -------------------------------- layout -------------------------------- */

  const measure = useCallback((): Layout | null => {
    const host = hostRef.current;
    if (!host) return null;
    const rect = host.getBoundingClientRect();
    const w = Math.max(240, Math.round(rect.width));
    const h = Math.max(240, Math.round(rect.height));
    const dpr = Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
    const prev = sizeRef.current;
    if (prev.w !== w || prev.h !== h || prev.dpr !== dpr) {
      sizeRef.current = { w, h, dpr };
      const bench = benchRef.current;
      if (bench) {
        bench.width = Math.round(w * dpr);
        bench.height = Math.round(h * dpr);
      }
    }

    const store = useSimStore.getState();
    const st = store.params[slug] ?? {};
    const inspector = store.inspectorOpen && w > 760;
    const left = 14;
    const right = w - (inspector ? 344 : 16);
    const top = 64;
    const bottom = h - 46;
    const availW = Math.max(140, right - left);
    const availH = Math.max(180, bottom - top);
    const gap = 10;
    const mode = pStr(st, 'render', 'both');
    const showSphere = pBool(st, 'showBloch', true) && mode !== 'beam';
    const showBench = mode !== 'bloch';

    let sphere: Box | null = null;
    let bench: Box | null = null;
    let book: Box | null = null;

    if (showSphere && showBench) {
      if (availW >= 640) {
        const sw = Math.max(180, Math.min(330, Math.round(availW * 0.34)));
        bench = { x: left, y: top, w: availW - sw - gap, h: availH };
        sphere = { x: left + bench.w + gap, y: top, w: sw, h: availH };
      } else {
        const sh = Math.max(150, Math.round(availH * 0.4));
        bench = { x: left, y: top, w: availW, h: availH - sh - gap };
        sphere = { x: left, y: top + bench.h + gap, w: availW, h: sh };
      }
    } else if (showSphere) {
      sphere = { x: left, y: top, w: availW, h: availH };
    } else if (showBench) {
      bench = { x: left, y: top, w: availW, h: availH };
    }

    if (bench) {
      const rows = Math.max(1, Math.round(pNum(st, 'stages', 3)));
      const bookH = Math.max(54, Math.min(96, 26 * rows + 16));
      if (bench.h > bookH + 150) {
        book = { x: bench.x, y: bench.y + bench.h - bookH, w: bench.w, h: bookH };
        bench = { x: bench.x, y: bench.y, w: bench.w, h: bench.h - bookH - 6 };
      }
    }

    const layout: Layout = { w, h, dpr, bench, book, sphere };

    const div = sphereRef.current;
    if (div) {
      const s = div.style;
      if (sphere) {
        const px = `${Math.round(sphere.x)}px`;
        const py = `${Math.round(sphere.y)}px`;
        const pw = `${Math.round(sphere.w)}px`;
        const ph = `${Math.round(sphere.h)}px`;
        if (s.left !== px || s.top !== py || s.width !== pw || s.height !== ph) {
          s.left = px;
          s.top = py;
          s.width = pw;
          s.height = ph;
          s.display = 'block';
        }
      } else if (s.display !== 'none') {
        s.display = 'none';
      }
    }
    const canvas = benchRef.current;
    if (canvas) {
      const want = bench ? 'block' : 'none';
      if (canvas.style.display !== want) canvas.style.display = want;
    }
    return layout;
  }, [slug]);

  useEffect(() => {
    measure();
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(host);
    return () => ro.disconnect();
  }, [measure]);

  /* --------------------------------- frame -------------------------------- */

  useAnimationClock(
    ({ dt, elapsed }) => {
      const benchCanvas = benchRef.current;
      if (!benchCanvas) return;
      const ctx = benchCanvas.getContext('2d');
      if (!ctx) return;
      const lay = measure();
      if (!lay) return;

      const st = useSimStore.getState().params[slug] ?? {};
      const m = buildModel(st);
      const counter = counterRef.current;

      // Display phase: one turn per 1/precessionFreq s at the 20 mT reference field.
      const rate = m.precessionHz * (m.larmorMT / REFERENCE_MT);
      if (dt > 0) liveSpin.turns = (liveSpin.turns + dt * rate) % 1;
      liveSpin.stamp = elapsed;
      const turns = liveSpin.turns;

      const chain = chainAt(m, turns);
      const open = openChainAt(m, turns);
      const geom = buildBench(m, open);

      // Where the packet is along the bench, and which spinor it carries.
      const prevPhase = liveSpin.phase;
      if (dt > 0) liveSpin.phase = (liveSpin.phase + dt / FLIGHT_SEC) % 1;
      const yNow = liveSpin.phase * geom.detY;
      let j = -1;
      for (let i = 0; i < geom.ys.length; i++) if (yNow >= geom.ys[i]) j = i;
      let state = m.input;
      let frac = 0;
      if (j >= 0) {
        const nextY = j + 1 < geom.ys.length ? geom.ys[j + 1] : geom.detY;
        frac = Math.max(0, Math.min(1, (yNow - geom.ys[j]) / Math.max(1e-6, nextY - geom.ys[j])));
        const want = j + 1;
        let best: BeamRay | undefined;
        for (const r of chain.rays) {
          if (r.path.length === want && (!best || r.weight > best.weight)) best = r;
        }
        if (best) state = best.state;
      }
      const carried = j < 0 ? state : precess(state, v3(0, 0, 1), TAU * turns * frac);
      liveSpin.bloch = blochVector(carried);
      const crossed = j + 1;
      if (crossed > stageRef.current) liveSpin.flash = elapsed;
      stageRef.current = crossed;
      liveSpin.stage = crossed;
      if (dt > 0) pushTrail(liveSpin);

      // Completed a lap? Deal another Monte-Carlo batch onto the detector.
      if (dt > 0 && liveSpin.phase < prevPhase && m.beamCount > 0) {
        if (counter.shots >= m.beamCount) resetCounter(counter, []);
        counter.maxShots = m.beamCount;
        const n = Math.max(1, Math.ceil(m.beamCount / BATCHES));
        const seed = ((Math.round(pNum(st, 'seed', 7)) * 100003 + counter.cycle * 7919) | 0) >>> 0;
        mergeShot(counter, shoot(m, turns, seed, n));
      }

      /* --- paint ---------------------------------------------------------- */
      const { w, h, dpr } = lay;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (lay.bench) {
        ctx.save();
        ctx.translate(lay.bench.x, lay.bench.y);
        drawBench(ctx, lay.bench.w, lay.bench.h, m, geom, liveSpin, counter);
        drawBenchLegend(ctx, lay.bench.w, lay.bench.h, m, liveSpin);
        ctx.restore();
      }
      if (lay.book) {
        ctx.save();
        ctx.strokeStyle = 'rgba(148,163,184,0.16)';
        ctx.lineWidth = 1;
        ctx.strokeRect(lay.book.x + 0.5, lay.book.y + 0.5, lay.book.w - 1, lay.book.h - 1);
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        monoText(ctx);
        ctx.fillText('|P±χ|² per analyser — outline = after the beam blocks', lay.book.x + 6, lay.book.y + 10);
        ctx.translate(lay.book.x, lay.book.y + 12);
        drawStageBookkeeping(ctx, lay.book.w, lay.book.h - 14, m, open, chain);
        ctx.restore();
      }

      /* --- mirror live numbers -------------------------------------------- */
      const now = typeof performance === 'undefined' ? Date.now() : performance.now();
      if (now - writeRef.current > WRITEBACK_MS) {
        writeRef.current = now;
        setParams(slug, {
          phaseTurnsLive: turns,
          transmittedLive: chain.transmitted,
          sxLive: liveSpin.bloch[0],
          syLive: liveSpin.bloch[1],
          szLive: liveSpin.bloch[2],
          activeStageLive: liveSpin.stage,
          detectedLive: counter.detected,
          shotsLive: counter.shots,
        });
      }
    },
    { maxDt: 0.05 },
  );

  /* -------------------------------- DOM ----------------------------------- */

  const counter = counterRef.current;

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden" data-sim="stern-gerlach-spin">
      <canvas
        ref={benchRef}
        className="absolute inset-0 h-full w-full"
        aria-label="Stern–Gerlach analyser chain with beam paths and detector counts"
      />
      <div
        ref={sphereRef}
        className="absolute overflow-hidden rounded-xl border border-hairline bg-obsidian-2/40"
        aria-label="Bloch sphere"
      >
        {model.render !== 'beam' && model.showBloch ? <BlochSphere slug={slug} /> : null}
        <div className="pointer-events-none absolute left-2 top-1.5 font-mono text-[10px] text-ink-faint">
          |χ⟩ = cos(θ/2)|↑⟩ + e^(iφ) sin(θ/2)|↓⟩
        </div>
        <div className="pointer-events-none absolute bottom-1 left-2 right-2 flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[10px] text-ink-faint">
          <span>
            θ {model.thetaDeg.toFixed(1)}° · φ {model.phiDeg.toFixed(1)}°
          </span>
          <span>drag = orbit · click = collapse</span>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-4 right-4 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-[10.5px] text-ink-faint">
        <span className="font-mono">{model.stages.map((s) => s.label).join(' → ')}</span>
        <span className="font-mono">
          ⟨σ⃗⟩ = ({liveSpin.bloch[0].toFixed(3)}, {liveSpin.bloch[1].toFixed(3)},{' '}
          {liveSpin.bloch[2].toFixed(3)})
        </span>
        <span className="font-mono">
          T = {stat.transmitted.toFixed(4)} · blocked {stat.blocked.toFixed(4)}
        </span>
        <span className="font-mono">
          {stat.channels
            .slice(0, 4)
            .map((c) => `${portLabel(c.path)} ${(c.probability * 100).toFixed(2)}%`)
            .join('  ')}
        </span>
        <span className="font-mono">
          n = {counter.detected}/{counter.shots} detected
        </span>
      </div>
    </div>
  );
}

function monoText(ctx: CanvasRenderingContext2D): void {
  ctx.font = '600 9.5px "JetBrains Mono", ui-monospace, monospace';
}
