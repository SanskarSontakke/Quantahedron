'use client';

/**
 * Orbitalis 3D — the stage viewport.
 *
 * Owns: the WebGL2 renderer, the eigenstate bake cache (chunked so the UI never
 * freezes), the Born-rule sampler, the measurement/collapse engine, the
 * probability-current streamlines, and the orbit camera (pointer + wheel, written
 * back into the store so permalinks reproduce the exact viewpoint).
 *
 * If WebGL2 is missing the component degrades to a CPU-rendered cross-section of
 * the same analytic wavefunction — the learner loses the 3D, not the physics.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SimSlug } from '@/simulations/types';
import { pArr, pBool, pNum, pStr, useSimParams, useSimStore } from '@/store/useSimStore';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { bakeResolution } from '@/lib/detectGpu';
import { densityPhaseColor, type Palette } from '@/lib/colorMap';
import { probabilityCurrent, sanitizeState } from '@/engine/physics/hydrogen';
import { COULOMB_VIS_GAIN, MAX_SLOTS, buildOrbitalState, displayOmega } from './state';
import { bakeKey, bakeSlot, peakAmplitude } from './bake';
import {
  bornWeights,
  buildField,
  drawIndex,
  makeRng,
  sampleCloud,
  type Field,
  type FieldSlot,
} from './sampler';
import { recordCollapse, recordHit, resetDetector } from './stats';
import { OrbitalisRenderer, webgl2Available } from './WebGLRenderer';
import type { BakeData, FrameState, RenderMode, SliceAxis } from './types';

/* --------------------------- eigenstate cache ---------------------------- */
/* Module level: survives React remounts and route changes, keyed by the exact
   bake parameters. Changing amplitude, phase, fields or time never re-bakes.  */

const bakeCache = new Map<string, BakeData>();
const CACHE_LIMIT = 14;

function cacheGet(key: string): BakeData | undefined {
  const hit = bakeCache.get(key);
  if (hit) {
    bakeCache.delete(key);
    bakeCache.set(key, hit); // LRU bump
  }
  return hit;
}

function cachePut(key: string, data: BakeData) {
  bakeCache.set(key, data);
  while (bakeCache.size > CACHE_LIMIT) {
    const oldest = bakeCache.keys().next().value;
    if (oldest === undefined) break;
    bakeCache.delete(oldest);
  }
}

/* ------------------------------- constants ------------------------------- */

const MAX_PARTICLES = 60000;
const MAX_DOTS = 5000;
const STRIPLINES = 44;
const STRIPE_STEPS = 60;

interface Camera {
  az: number;
  el: number;
  dist: number;
}

export default function OrbitalisCanvas({ slug }: { slug: SimSlug }) {
  const params = useSimParams(slug);
  const prefs = useSimStore((s) => s.prefs);
  const gpu = useSimStore((s) => s.gpu);
  const resetToken = useSimStore((s) => s.resetToken);
  const setParams = useSimStore((s) => s.setParams);
  const interruptDemo = useSimStore((s) => s.interruptDemo);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  const rendererRef = useRef<OrbitalisRenderer | null>(null);
  const [glReady, setGlReady] = useState<boolean | null>(null);
  const [baking, setBaking] = useState(false);
  const [hint, setHint] = useState(true);

  /* Every mutable buffer/ref used by the clock is declared up front so the
     animation loop, the bake effect and the input handlers see one instance. */
  const tauRef = useRef(0);
  const scaleRef = useRef(1);
  const fpsRef = useRef({ frames: 0, last: 0, low: 0 });
  const fieldRef = useRef<Field | null>(null);
  const peakRef = useRef(1);
  const cloudBufRef = useRef<Float32Array>(new Float32Array(MAX_PARTICLES * 6));
  const cloudCountRef = useRef(0);
  const cloudKeyRef = useRef('');
  const cloudCursorRef = useRef(0);
  const dotsRef = useRef<Float32Array>(new Float32Array(MAX_DOTS * 6));
  const dotCountRef = useRef(0);
  const dotCursorRef = useRef(0);
  const detectedRef = useRef(0);
  const mergedRef = useRef<Float32Array>(new Float32Array((MAX_PARTICLES + MAX_DOTS) * 6));
  const linesRef = useRef<Float32Array>(new Float32Array(STRIPLINES * STRIPE_STEPS * 2 * 4));
  const linesCountRef = useRef(0);
  const linesKeyRef = useRef('');
  const accRef = useRef(0);
  const rngRef = useRef(makeRng(0x51ed270b));
  const camRef = useRef<Camera>({ az: 0.62, el: 0.34, dist: 32 });

  /* ------------------------------ physics -------------------------------- */

  const state = useMemo(() => buildOrbitalState(params), [params]);
  const omegaVis = useMemo(() => displayOmega(state), [state]);
  const mode = pStr(params, 'render', 'raymarch') as RenderMode;

  const res = useMemo(() => {
    const mobile =
      typeof window !== 'undefined' &&
      (window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 820);
    return bakeResolution(gpu.tier === 'none' ? 'balanced' : gpu.tier, prefs.quality, mobile);
  }, [gpu.tier, prefs.quality]);

  /* The renderer decides the texture format; until it exists we assume float. */
  const packed = glReady === true ? rendererRef.current?.packed === true : glReady === false;

  /* --------------------------- renderer mount ---------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !webgl2Available()) {
      setGlReady(false);
      return;
    }
    let renderer: OrbitalisRenderer;
    try {
      renderer = new OrbitalisRenderer(
        canvas,
        gpu.tier === 'high' ? 'high' : gpu.tier === 'none' ? 'low' : 'balanced',
      );
    } catch {
      setGlReady(false);
      return;
    }
    rendererRef.current = renderer;
    setGlReady(true);
    return () => {
      renderer.dispose();
      rendererRef.current = null;
      setGlReady(null);
    };
  }, [gpu.tier]);

  /* ------------------------------- sizing -------------------------------- */

  useEffect(() => {
    const host = hostRef.current;
    const fallback = fallbackRef.current;
    if (!host) return;
    const apply = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const renderer = rendererRef.current;
      if (renderer) renderer.resize(rect.width, rect.height, dpr, scaleRef.current);
      if (fallback) {
        fallback.width = Math.max(1, Math.round(rect.width));
        fallback.height = Math.max(1, Math.round(rect.height));
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(host);
    window.addEventListener('orientationchange', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', apply);
    };
  }, [glReady]);

  /* --------------------------- bake / upload ----------------------------- */

  const slotKeys = useMemo(
    () => state.amps.slice(0, MAX_SLOTS).map((a) => bakeKey(a.n, a.l, a.m, state.Z, res, packed)),
    [state.amps, state.Z, res, packed],
  );
  const bakeSignature = slotKeys.join(',') + `|${packed}|${res}`;

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || glReady !== true) return;
    let cancelled = false;
    setBaking(true);

    const run = async () => {
      const amps = state.amps.slice(0, MAX_SLOTS);
      // Shared normalisation: every slot is divided by the brightest one, so the
      // relative brightness of 1s vs 5g is the physics, not a fudge factor.
      const norm = Math.max(
        1e-9,
        ...amps.map((a) => peakAmplitude(a.n, a.l, a.m, state.Z)),
      );
      const results: (BakeData | null)[] = [];

      for (let i = 0; i < MAX_SLOTS; i++) {
        if (cancelled) return;
        const a = amps[i];
        if (!a) {
          results.push(null);
          continue;
        }
        const hit = cacheGet(slotKeys[i]);
        if (hit) {
          results.push(hit);
          continue;
        }
        const data = await bakeSlot(
          {
            n: a.n,
            l: a.l,
            m: a.m,
            Z: state.Z,
            norm,
            res,
            rBox: state.rBox,
            packed: renderer.packed,
            sampleRes: 44,
          },
          (fraction) => {
            if (cancelled) return;
            void fraction;
          },
        );
        if (cancelled) return;
        cachePut(slotKeys[i], data);
        results.push(data);
      }

      for (let i = 0; i < MAX_SLOTS; i++) renderer.uploadSlot(i, results[i]);
      applyAmplitudes(results, amps);
      cloudKeyRef.current = '';
      linesKeyRef.current = '';
      setBaking(false);
    };

    void run();
    return () => {
      cancelled = true;
      setBaking(false);
    };
    // omegaVis/amps changes refresh the CPU field but never trigger a bake.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bakeSignature, glReady]);

  /** Rebuild the CPU sampler field + auto-exposure from cached bakes. */
  function applyAmplitudes(cached: (BakeData | null)[], amps = state.amps.slice(0, MAX_SLOTS)) {
    const slots: FieldSlot[] = [];
    for (let i = 0; i < MAX_SLOTS; i++) {
      const data = cached[i];
      const a = amps[i];
      if (data && a) slots.push({ data, amp: a.amp, phase: a.phase, omega: omegaVis[i] ?? 0 });
    }
    fieldRef.current = slots.length ? buildField(slots) : null;
    const weighted = slots.reduce((sum, s) => sum + Math.abs(s.amp) * s.data.peak, 0);
    peakRef.current = Math.max(0.05, weighted * weighted);
  }

  /** Amplitude/phase/basis/field edits: refresh the sampler without any re-bake. */
  useEffect(() => {
    applyAmplitudes(slotKeys.map((k) => cacheGet(k) ?? null));
    cloudKeyRef.current = '';
    linesKeyRef.current = '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKeys, omegaVis, state.amps]);

  /* ------------------------------- camera -------------------------------- */

  const camAz = pNum(params, 'camAz', 0.62);
  const camEl = pNum(params, 'camEl', 0.34);
  const camDist = pNum(params, 'camDist', 32);
  useEffect(() => {
    camRef.current = { az: camAz, el: camEl, dist: camDist };
  }, [camAz, camEl, camDist]);

  const commitCamera = useCallback(() => {
    const { az, el, dist } = camRef.current;
    setParams(slug, {
      camAz: Math.round(az * 1000) / 1000,
      camEl: Math.round(el * 1000) / 1000,
      camDist: Math.round(dist * 10) / 10,
    });
  }, [setParams, slug]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pinch = 0;
    let moved = false;
    let commitTimer = 0;

    const queueCommit = () => {
      window.clearTimeout(commitTimer);
      commitTimer = window.setTimeout(commitCamera, 180);
    };
    const down = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      host.setPointerCapture?.(e.pointerId);
      setHint(false);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      const cam = camRef.current;
      cam.az -= dx * 0.007;
      cam.el = Math.max(-1.5, Math.min(1.5, cam.el + dy * 0.006));
      if (moved) {
        interruptDemo();
        queueCommit();
      }
    };
    const up = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      host.releasePointerCapture?.(e.pointerId);
      if (moved) commitCamera();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      cam.dist = Math.max(4, Math.min(400, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      interruptDemo();
      setHint(false);
      queueCommit();
    };
    const touch2 = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY,
      );
      if (pinch > 0) {
        const cam = camRef.current;
        cam.dist = Math.max(4, Math.min(400, cam.dist * (pinch / Math.max(1, d))));
        queueCommit();
      }
      pinch = d;
      e.preventDefault();
    };
    const touchEnd = () => {
      pinch = 0;
    };

    host.addEventListener('pointerdown', down);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
    host.addEventListener('wheel', wheel, { passive: false });
    host.addEventListener('touchmove', touch2, { passive: false });
    host.addEventListener('touchend', touchEnd);
    return () => {
      window.clearTimeout(commitTimer);
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      host.removeEventListener('wheel', wheel);
      host.removeEventListener('touchmove', touch2);
      host.removeEventListener('touchend', touchEnd);
    };
  }, [commitCamera, interruptDemo]);

  /* ------------------------- slider → slot editing ------------------------ */
  /* The n/ℓ/m sliders edit whichever slot `focus` points at. A demo or a phasor
     drag changes the amplitude arrays in the same store update, so those writes
     are recognised and left alone.                                      */

  const sigRef = useRef({ n: -1, l: -1, m: -1, amps: '' });
  const nS = Math.round(pNum(params, 'n', 1));
  const lS = Math.round(pNum(params, 'l', 0));
  const mS = Math.round(pNum(params, 'm', 0));
  const focus = Math.round(pNum(params, 'focus', 0));
  useEffect(() => {
    const ns = pArr(params, 'ampsN');
    const ls = pArr(params, 'ampsL');
    const ms = pArr(params, 'ampsM');
    const sig = `${ns.join(',')}|${ls.join(',')}|${ms.join(',')}`;
    const prev = sigRef.current;
    const ampsMoved = prev.amps !== sig && prev.amps !== '';
    const slidersMoved = prev.n !== nS || prev.l !== lS || prev.m !== mS;
    sigRef.current = { n: nS, l: lS, m: mS, amps: sig };
    if (!slidersMoved || ampsMoved || !ns.length) return;
    const i = Math.min(Math.max(0, focus), ns.length - 1);
    const clean = sanitizeState(nS, lS, mS);
    if (ns[i] === clean.n && ls[i] === clean.l && ms[i] === clean.m) return;
    setParams(slug, {
      ampsN: ns.map((v, k) => (k === i ? clean.n : v)),
      ampsL: ls.map((v, k) => (k === i ? clean.l : v)),
      ampsM: ms.map((v, k) => (k === i ? clean.m : v)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nS, lS, mS, focus]);

  /* --------------------------- measurement rig --------------------------- */

  const measure = pBool(params, 'measure', false);
  const collapse = pBool(params, 'collapse', true);
  const measureSeed = Math.round(pNum(params, 'measureSeed', 0));
  const measureBurst = Math.round(pNum(params, 'measureBurst', 0));

  useEffect(() => {
    dotCountRef.current = 0;
    dotCursorRef.current = 0;
    detectedRef.current = 0;
    rngRef.current = makeRng((measureSeed >>> 0) + 0x51ed270b);
    resetDetector();
  }, [measureSeed, resetToken]);

  /** Detector flash: n fresh Born-rule positions written into the dot ring. */
  function fireBurst(n: number) {
    const field = fieldRef.current;
    if (!field) return;
    const buf = dotsRef.current;
    const t = tauRef.current;
    for (let i = 0; i < n; i++) {
      const slot = dotCursorRef.current % MAX_DOTS;
      dotCursorRef.current++;
      const wrote = sampleCloud(field, t, buf, slot, 1, rngRef.current, {
        peak: peakRef.current,
        size: 1.15,
        intensity: 1,
      });
      if (wrote > 0) {
        // The size channel doubles as a shader-side marker for detector hits.
        buf[slot * 6 + 5] = 2.4;
        detectedRef.current += 1;
        dotCountRef.current = Math.min(MAX_DOTS, dotCountRef.current + 1);
        recordHit(buf[slot * 6], buf[slot * 6 + 1], buf[slot * 6 + 2], state.rBox);
      }
    }
  }

  /** Projective collapse: keep only the eigenstate a position measurement found. */
  const doCollapse = useCallback(() => {
    const amps = state.amps.slice(0, MAX_SLOTS);
    if (!amps.length) return;
    const idx = drawIndex(bornWeights(amps.map((a) => a.amp)), rngRef.current);
    const found = amps[Math.min(idx, amps.length - 1)];
    recordCollapse(found.n, found.l, found.m);
    setParams(slug, {
      ampsN: [found.n],
      ampsL: [found.l],
      ampsM: [found.m],
      ampsAmp: [1],
      ampsPhase: [0],
      n: found.n,
      l: found.l,
      m: found.m,
      basis: 'complex',
      measureSeed: measureSeed + 1,
    });
  }, [measureSeed, setParams, slug, state.amps]);

  const lastBurstRef = useRef(measureBurst);
  useEffect(() => {
    if (measureBurst === lastBurstRef.current) return;
    lastBurstRef.current = measureBurst;
    fireBurst(420);
    if (collapse) doCollapse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureBurst]);

  /* --------------------------- point cloud + lines ----------------------- */

  function updateCloud(target: number, frame: FrameState) {
    const field = fieldRef.current;
    if (!field || target <= 0) {
      cloudCountRef.current = 0;
      return;
    }
    const buf = cloudBufRef.current;
    const cap = Math.min(target, MAX_PARTICLES);
    const key = `${slotKeys.join(',')}|${cap}|${frame.rBox}`;
    const opts = { peak: peakRef.current, size: 1.5, intensity: 0.85 };
    if (key !== cloudKeyRef.current) {
      cloudKeyRef.current = key;
      cloudCursorRef.current = 0;
      cloudCountRef.current = sampleCloud(field, tauRef.current, buf, 0, cap, rngRef.current, opts);
      return;
    }
    // Rolling refresh: re-draw a slice so time-dependent densities animate
    // without resampling 60 000 particles every frame.
    if (cloudCountRef.current < cap) {
      const got = sampleCloud(
        field,
        tauRef.current,
        buf,
        cloudCountRef.current,
        Math.min(Math.round(cap * 0.08), cap - cloudCountRef.current),
        rngRef.current,
        opts,
      );
      cloudCountRef.current += got;
      return;
    }
    const wrote = sampleCloud(
      field,
      tauRef.current,
      buf,
      cloudCursorRef.current,
      Math.round(cap * 0.05),
      rngRef.current,
      opts,
    );
    cloudCursorRef.current = (cloudCursorRef.current + wrote) % cap;
    void wrote;
  }

  function updateStreamlines(frame: FrameState) {
    if (!pBool(params, 'streamlines', false) || frame.count === 0) {
      linesCountRef.current = 0;
      return;
    }
    const amps = state.amps;
    const tBucket = Math.round(frame.time * 5);
    const key = `${amps.map((a) => `${a.n}${a.l}${a.m}${a.amp.toFixed(2)}${a.phase.toFixed(2)}`).join(',')}|${state.Z}|${tBucket}`;
    if (key === linesKeyRef.current) return;
    linesKeyRef.current = key;

    // The visual clock is a slowed-down phase clock; convert back to the atomic
    // time the analytic probability current uses so the two stay consistent.
    const tAU = frame.time / COULOMB_VIS_GAIN;
    const buf = linesRef.current;
    const r0 = Math.max(1.2, frame.rBox * 0.28);
    const step = (frame.rBox * 0.9) / STRIPE_STEPS;
    let w = 0;
    let emitted = 0;
    for (let s = 0; s < STRIPLINES; s++) {
      const eta = (s + 0.5) / STRIPLINES;
      const theta = Math.acos(1 - 2 * eta);
      const phi = (s * 2.399963) % (Math.PI * 2); // golden-angle spread
      let p: [number, number, number] = [
        r0 * Math.sin(theta) * Math.cos(phi),
        r0 * Math.sin(theta) * Math.sin(phi),
        r0 * Math.cos(theta),
      ];
      const pts: [number, number, number, number][] = [];
      for (let i = 0; i < STRIPE_STEPS; i++) {
        const j = probabilityCurrent(amps, p, tAU, state.Z);
        const mag = Math.hypot(j[0], j[1], j[2]);
        if (!Number.isFinite(mag) || mag < 1e-14) break;
        const h = step / Math.min(1, mag * 6 + 0.25);
        const mid: [number, number, number] = [
          p[0] + (j[0] / mag) * h * 0.5,
          p[1] + (j[1] / mag) * h * 0.5,
          p[2] + (j[2] / mag) * h * 0.5,
        ];
        const j2 = probabilityCurrent(amps, mid, tAU, state.Z);
        const m2 = Math.hypot(j2[0], j2[1], j2[2]) || 1;
        p = [p[0] + (j2[0] / m2) * h, p[1] + (j2[1] / m2) * h, p[2] + (j2[2] / m2) * h];
        if (Math.hypot(p[0], p[1], p[2]) > frame.rBox * 1.05) break;
        pts.push([p[0], p[1], p[2], Math.min(1, mag * 40 + 0.12)]);
      }
      if (pts.length < 2) continue;
      emitted += 1;
      for (let i = 0; i < pts.length - 1 && w + 8 <= buf.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        buf[w++] = a[0];
        buf[w++] = a[1];
        buf[w++] = a[2];
        buf[w++] = a[3];
        buf[w++] = b[0];
        buf[w++] = b[1];
        buf[w++] = b[2];
        buf[w++] = b[3] * 0.85;
      }
    }
    linesCountRef.current = emitted > 0 ? w / 4 : 0;
  }

  /** Concatenate the sampling cloud and the detector dots into one draw buffer. */
  function mergePoints(useCloud: number, useDots: number): number {
    const out = mergedRef.current;
    const cN = Math.min(useCloud, cloudCountRef.current, MAX_PARTICLES);
    const dN = Math.min(useDots, dotCountRef.current, MAX_DOTS);
    if (cN > 0) out.set(cloudBufRef.current.subarray(0, cN * 6), 0);
    if (dN > 0) out.set(dotsRef.current.subarray(0, dN * 6), cN * 6);
    return cN + dN;
  }

  /* ------------------------------ fallback -------------------------------- */

  function paintFallback(frame: FrameState) {
    const canvas = fallbackRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const field = fieldRef.current;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#05070c';
    ctx.fillRect(0, 0, w, h);
    if (!field) return;

    const side = 104;
    const img = ctx.createImageData(side, side);
    const rBox = frame.rBox;
    const res = field.res;
    const cell = (2 * rBox) / res;
    const t = frame.time;
    for (let jy = 0; jy < side; jy++) {
      const y = (-1 + (2 * jy) / (side - 1)) * rBox;
      for (let ix = 0; ix < side; ix++) {
        const x = (-1 + (2 * ix) / (side - 1)) * rBox;
        const i = Math.max(0, Math.min(res - 1, Math.round((x + rBox) / cell)));
        const k = Math.max(0, Math.min(res - 1, Math.round((y + rBox) / cell)));
        // xz plane through the nucleus: y index pinned to the centre slice.
        const o = (k * res + (res >> 1)) * res + i;
        const [re, im] = cpuPsi(field, o, t);
        const d = Math.min(1, (re * re + im * im) * frame.density);
        const c = densityPhaseColor(Math.atan2(im, re), d, prefs.palette as Palette);
        const p = (jy * side + ix) * 4;
        img.data[p] = Math.round(c.r * 255);
        img.data[p + 1] = Math.round(c.g * 255);
        img.data[p + 2] = Math.round(c.b * 255);
        img.data[p + 3] = 255;
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = side;
    tmp.height = side;
    tmp.getContext('2d')?.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, w, h);
    ctx.fillStyle = 'rgba(235,240,252,0.72)';
    ctx.font = '12px "JetBrains Mono", ui-monospace, monospace';
    ctx.fillText('2D fallback — xz cross-section of the same exact ψ', 12, h - 14);
  }

  /* ------------------------------ animation ------------------------------- */

  function makeFrame(): FrameState {
    return {
      mode,
      camAz: camRef.current.az,
      camEl: camRef.current.el,
      camDist: camRef.current.dist,
      count: Math.min(state.count, MAX_SLOTS),
      omega: omegaVis,
      amps: state.amps.map((a) => Math.abs(a.amp)),
      phases: state.amps.map((a) => a.phase),
      rBox: state.rBox,
      exposure: pNum(params, 'exposure', 1.1),
      gamma: pNum(params, 'gamma', 2.2),
      isoLevel: pNum(params, 'isoLevel', 0.9),
      density: (pNum(params, 'densityScale', 1) * 1.1) / peakRef.current,
      octant: pBool(params, 'octant', false),
      sliceAxis: pStr(params, 'slicePlane', 'xz') as SliceAxis,
      sliceOffset: pNum(params, 'sliceOffset', 0),
      monochrome: pBool(params, 'monochrome', false),
      showAxes: pBool(params, 'showAxes', true),
      palette: (prefs.palette as Palette) === 'cividis' ? 1 : 0,
      time: tauRef.current,
    };
  }

  useAnimationClock(
    ({ dt }) => {
      tauRef.current += dt;
      const frame = makeFrame();
      frame.time = tauRef.current;

      // Dynamic resolution: back off when the raymarch cannot hold ~45 fps.
      const fps = fpsRef.current;
      fps.frames += 1;
      const now = performance.now();
      if (!fps.last) fps.last = now;
      if (now - fps.last > 900) {
        const measured = (fps.frames * 1000) / (now - fps.last);
        fps.frames = 0;
        fps.last = now;
        if (measured < 40 && scaleRef.current > 0.55) {
          scaleRef.current = Math.max(0.5, scaleRef.current - 0.12);
          fpsRef.current.low += 1;
          const renderer = rendererRef.current;
          const host = hostRef.current;
          if (renderer && host) {
            const rect = host.getBoundingClientRect();
            renderer.resize(rect.width, rect.height, Math.min(2, window.devicePixelRatio || 1), scaleRef.current);
          }
        } else if (measured > 57 && scaleRef.current < 1) {
          scaleRef.current = Math.min(1, scaleRef.current + 0.08);
          const renderer = rendererRef.current;
          const host = hostRef.current;
          if (renderer && host) {
            const rect = host.getBoundingClientRect();
            renderer.resize(rect.width, rect.height, Math.min(2, window.devicePixelRatio || 1), scaleRef.current);
          }
        }
      }

      const renderer = rendererRef.current;
      if (!renderer) {
        paintFallback(frame);
        return;
      }

      const target = Math.round(pNum(params, 'particleCount', 40000));
      updateCloud(frame.mode === 'pointcloud' ? target : 0, frame);
      updateStreamlines(frame);

      if (measure && fieldRef.current && dt > 0) {
        accRef.current += dt * pNum(params, 'measureRate', 240);
        const batch = Math.min(200, Math.floor(accRef.current));
        if (batch > 0) {
          accRef.current -= batch;
          fireBurst(batch);
        }
      }

      const pointCount = mergePoints(
        frame.mode === 'pointcloud' ? cloudCountRef.current : 0,
        measure ? dotCountRef.current : 0,
      );

      renderer.render(
        frame,
        pointCount > 0
          ? { buffer: mergedRef.current, count: pointCount, tint: [0.36, 0.85, 0.95] }
          : undefined,
        linesCountRef.current > 0
          ? { buffer: linesRef.current, count: linesCountRef.current, color: [0.99, 0.78, 0.32] }
          : undefined,
      );
    },
    { maxDt: 0.05 },
  );

  /* --------------------------------- HUD --------------------------------- */

  const accent = '#5eead4';
  const showFallbackSurface = glReady === false;
  const lowFps = fpsRef.current.low;

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 select-none overflow-hidden bg-obsidian"
      style={{ touchAction: 'none', cursor: 'grab' }}
    >
      <canvas
        ref={canvasRef}
        className={showFallbackSurface ? 'hidden' : 'block h-full w-full'}
        aria-label="Orbitalis 3D volumetric wavefunction viewport"
      />
      {showFallbackSurface ? (
        <canvas ref={fallbackRef} className="block h-full w-full" aria-label="Wavefunction cross-section (2D fallback)" />
      ) : null}

      {baking ? (
        <div className="glass pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full px-2.5 py-1 text-[10.5px] text-ink-dim">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: accent }} />
          baking eigenstate · {res}³
        </div>
      ) : null}

      {hint ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border border-hairline bg-obsidian/70 px-3 py-1 text-[10.5px] text-ink-faint backdrop-blur-sm">
          drag to orbit · scroll to zoom · 1–4 switch view, M measures
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden flex-col gap-1 text-[9.5px] text-ink-faint md:flex">
        <span>x red · y green · z blue</span>
        <span>
          hue = arg Ψ · brightness = |Ψ|² ·{' '}
          {showFallbackSurface ? '2D fallback' : `${res}³ bake${packed ? ' (RGBA8)' : ' (RGBA16F)'}`}
        </span>
        {measure ? <span>{detectedRef.current.toLocaleString('en-US')} detector hits</span> : null}
        {scaleRef.current < 1 ? <span>adaptive resolution {Math.round(scaleRef.current * 100)}%</span> : null}
      </div>

      {lowFps > 3 && scaleRef.current <= 0.5 ? (
        <div className="glass pointer-events-none absolute right-3 top-3 z-10 max-w-[220px] rounded-lg px-2.5 py-1.5 text-[10px] text-solar">
          Heavy scene — lower the sample count or switch to the Surface view for smoother frames.
        </div>
      ) : null}
    </div>
  );
}

/** Ψ on the coarse CPU grid at voxel index `o`, evolved to time `t`. */
function cpuPsi(field: Field, o: number, t: number): [number, number] {
  let re = 0;
  let im = 0;
  for (const s of field.slots) {
    if (s.amp <= 0) continue;
    const vr = s.data.cpuRe[o] ?? 0;
    const vi = s.data.cpuIm[o] ?? 0;
    const ang = s.phase - s.omega * t;
    const cs = Math.cos(ang) * s.amp;
    const sn = Math.sin(ang) * s.amp;
    re += cs * vr - sn * vi;
    im += cs * vi + sn * vr;
  }
  return [re, im];
}
