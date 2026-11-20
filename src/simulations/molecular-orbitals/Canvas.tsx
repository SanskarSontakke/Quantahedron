'use client';

/**
 * Sim 9 — Molecular Orbitals & LCAO Bonding: stage viewport.
 *
 * Three render paths, picked per frame from the capability probe the shell already
 * ran (`useSimStore().gpu`) plus the user's `render` selector:
 *
 *   raymarch / isosurface → raw WebGL2 fullscreen-triangle march of |ψ±|²
 *       (`src/engine/shaders/molecular.ts`), analytic density, no framebuffers.
 *   pointcloud            → GL_POINTS over a |ψ|² rejection sample of the same MO.
 *   fallback              → no WebGL2 *or* no float-texture support ⇒ the identical
 *       sampled cloud projected and painted by Canvas2D. Nothing throws, nothing
 *       goes blank; the corner badge always states which path is live.
 *
 * React owns only the mount, the overlay plot and the pointer handlers — every pixel
 * is drawn from the shared rAF clock. All state lives in the flat store map so
 * permalinks, the demo director and reset keep working without local state.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { PlotCanvas, label, plotFrame, plotGrid } from '@/components/ui/PlotCanvas';
import {
  atomicLimitHa,
  auToPm,
  fitMorse,
  h2PlusMorse,
  moAmplitude,
  moAssignment,
  moState,
  morseTotal,
  samplePointCloud,
  type CurvePoint,
  type CloudSample,
  type MorseParams,
} from '@/engine/physics/lcao';
import {
  CPU_BACKGROUND,
  MOLECULAR_CLOUD_FRAG,
  MOLECULAR_CLOUD_VERT,
  MOLECULAR_RAYMARCH_FRAG,
  MOLECULAR_RAYMARCH_VERT,
} from '@/engine/shaders/molecular';
import { useAnimationClock } from '@/hooks/useAnimationClock';
import { pBool, pNum, pStr, useSimParams, useSimStore } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';
import { aoOf, comboOf, curveOf, equilibriumOf, rOf, zOf, zetaModeOf } from './math';

/* ------------------------------------------------------------------ */
/* Camera                                                              */
/* ------------------------------------------------------------------ */

const FOV = (46 * Math.PI) / 180;
const FOCAL = 1 / Math.tan(FOV / 2);

interface Camera {
  pos: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  fwd: [number, number, number];
}

/**
 * Orbit the midpoint with azimuth/elevation, looking down the bond axis (world z).
 * Elevation is clamped away from the poles so `worldUp × fwd` never degenerates.
 */
function makeCamera(az: number, el: number, dist: number): Camera {
  const e = Math.max(-1.42, Math.min(1.42, el));
  const ce = Math.cos(e);
  const pos: [number, number, number] = [dist * ce * Math.sin(az), dist * ce * Math.cos(az), dist * Math.sin(e)];
  const len = Math.hypot(pos[0], pos[1], pos[2]) || 1;
  const fwd: [number, number, number] = [-pos[0] / len, -pos[1] / len, -pos[2] / len];
  // right = fwd × ẑ  (ẑ is the bond axis; the elevation clamp keeps |right| > 0)
  let rx = fwd[1];
  let ry = -fwd[0];
  const rz = 0;
  const rl = Math.hypot(rx, ry, rz);
  if (rl < 1e-6) {
    rx = 1;
    ry = 0;
  } else {
    rx /= rl;
    ry /= rl;
  }
  const right: [number, number, number] = [rx, ry, rz];
  const up: [number, number, number] = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  return { pos, right, up, fwd };
}

/** Peak |ψ|² over the meridian plane — the shader's density normaliser. */
function peakDensity(
  amp: (x: number, y: number, z: number) => number,
  halfR: number,
  zeta: number,
): { peak: number; bound: number } {
  const reach = 9 / Math.max(zeta, 0.25);
  const bound = halfR + reach;
  let peak = 0;
  const nz = 88;
  const nr = 32;
  for (let i = 0; i <= nz; i++) {
    const z = -bound + (2 * bound * i) / nz;
    for (let j = 0; j <= nr; j++) {
      const rho = (reach * j) / nr;
      const v = amp(rho, 0, z);
      const d = v * v;
      if (d > peak) peak = d;
    }
  }
  return { peak: Math.max(peak, 1e-10), bound };
}

/* ------------------------------------------------------------------ */
/* Tiny WebGL2 wrapper (no three.js, so nothing else can break this)   */
/* ------------------------------------------------------------------ */

class GpuProgram {
  private map = new Map<string, WebGLUniformLocation | null>();
  constructor(
    readonly gl: WebGL2RenderingContext,
    readonly program: WebGLProgram,
  ) {}
  private loc(name: string): WebGLUniformLocation | null {
    const hit = this.map.get(name);
    if (hit !== undefined) return hit;
    const l = this.gl.getUniformLocation(this.program, name);
    this.map.set(name, l);
    return l;
  }
  f(name: string, v: number) {
    const l = this.loc(name);
    if (l) this.gl.uniform1f(l, v);
  }
  i(name: string, v: number) {
    const l = this.loc(name);
    if (l) this.gl.uniform1i(l, v);
  }
  v3(name: string, a: readonly [number, number, number]) {
    const l = this.loc(name);
    if (l) this.gl.uniform3f(l, a[0], a[1], a[2]);
  }
  attr(name: string): number {
    return this.gl.getAttribLocation(this.program, name);
  }
  dispose() {
    this.map.clear();
    this.gl.deleteProgram(this.program);
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
  tag: string,
): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn(`[molecular-orbitals] ${tag} failed to compile:`, gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function buildProgram(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
  tag: string,
): GpuProgram | null {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs, `${tag}.vert`);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs, `${tag}.frag`);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn(`[molecular-orbitals] ${tag} failed to link:`, gl.getProgramInfoLog(p));
    gl.deleteProgram(p);
    return null;
  }
  return new GpuProgram(gl, p);
}

/** Placeholder so the raymarch path never pays for rejection sampling. */
const EMPTY_CLOUD: CloudSample = {
  positions: new Float32Array(0),
  values: new Float32Array(0),
  count: 0,
  rMax: 1,
  peak: 0,
};

interface GlBundle {
  gl: WebGL2RenderingContext;
  volume: GpuProgram | null;
  cloud: GpuProgram | null;
  vao: WebGLVertexArrayObject | null;
  posBuf: WebGLBuffer | null;
  valBuf: WebGLBuffer | null;
  uploaded: unknown;
}

/* ------------------------------------------------------------------ */
/* Stage                                                               */
/* ------------------------------------------------------------------ */

export default function MolecularCanvas({ slug }: { slug: SimSlug }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLCanvasElement>(null);
  /** A canvas that has handed out a webgl2 context can never return a 2d one, so the
   *  Canvas2D fallback paints into its own element and the two cross-fade. */
  const cpuRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GlBundle | null>(null);
  const ctx2dRef = useRef<CanvasRenderingContext2D | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const dragRef = useRef<{ id: number; x: number; y: number; az: number; el: number } | null>(null);
  const [path, setPath] = useState<'volume' | 'gpu-cloud' | 'cpu-cloud'>('cpu-cloud');
  const [fallbackReason, setFallbackReason] = useState('');

  /* Narrow selectors only: `simTime` ticks every frame, so a whole-store
   * subscription would re-render this component 60×/s. */
  const params = useSimParams(slug);
  const gpu = useSimStore((s) => s.gpu);
  const setParam = useSimStore((s) => s.setParam);
  const interruptDemo = useSimStore((s) => s.interruptDemo);

  /* ------------------------------ physics ------------------------------ */

  const kind = aoOf(params);
  const combo = comboOf(params);
  const Z = zOf(params);
  const R = rOf(params);
  const zetaMode = zetaModeOf(params);
  const render = pStr(params, 'render', 'raymarch');
  const assign = moAssignment(kind, combo);
  const st = useMemo(() => moState(kind, R, Z, { combo }), [kind, R, Z, combo]);
  const zeta = st.zeta;
  const sign = st.sign;
  const limit = atomicLimitHa(kind, Z);

  const amp = useMemo(() => moAmplitude(kind, zeta, R, sign), [kind, zeta, R, sign]);
  const { peak, bound } = useMemo(() => peakDensity(amp, R / 2, zeta), [amp, R, zeta]);

  /**
   * The point cloud is only needed when something will actually draw it, and rejection
   * sampling costs 10–90 ms, so the cache key quantises R (0.2 a₀) and ζ (0.02) and the
   * sample is taken at those quantised values — a demo sweep then rebuilds a handful of
   * times instead of every frame, and the raymarch path never samples at all.
   */
  const cloudCount = Math.round(
    pNum(params, 'cloudCount', 20000) *
      (gpu.tier === 'low' ? 0.45 : gpu.tier === 'balanced' ? 0.8 : 1),
  );
  const cloudNeeded = render === 'pointcloud' || path !== 'volume';
  const cloudQ = Math.round(R * 5) / 5;
  const zetaQ = Math.round(zeta * 50) / 50;
  const cloudKey = `${kind}|${zetaQ}|${cloudQ}|${sign}|${cloudCount}|${cloudNeeded}`;
  const cloud = useMemo(
    () =>
      cloudNeeded
        ? samplePointCloud(kind, zetaQ, cloudQ, sign, cloudCount, 7)
        : EMPTY_CLOUD,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cloudKey],
  );

  const curve = useMemo(
    () => curveOf(params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, Z, combo, zetaMode],
  );
  const partnerCurve = useMemo(
    () => curveOf(params, combo === 'bonding' ? 'antibonding' : 'bonding'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, Z, combo, zetaMode],
  );
  const eq = useMemo(
    () => equilibriumOf(params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, Z, combo, zetaMode],
  );

  const morse: MorseParams = useMemo(() => {
    if (kind === '1s' && Z === 1 && combo === 'bonding') return h2PlusMorse();
    const fitted = fitMorse(curve, limit);
    return fitted ?? { De: Math.max(eq.De, 1e-4), Re: Number.isFinite(eq.Re) ? eq.Re : 2, a: 0.7 };
  }, [kind, Z, combo, curve, limit, eq]);

  /* ------------------------------ GL context ---------------------------- */

  useEffect(() => {
    const canvas = stageRef.current;
    if (!canvas) return;
    const probe = useSimStore.getState().gpu;
    let bundle: GlBundle | null = null;

    if (!probe.webgl2) {
      ctx2dRef.current = canvas.getContext('2d');
      setPath('cpu-cloud');
      setFallbackReason('no WebGL2');
      return;
    }
    try {
      const gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
      });
      if (gl) {
        const volume = buildProgram(gl, MOLECULAR_RAYMARCH_VERT, MOLECULAR_RAYMARCH_FRAG, 'raymarch');
        const cloudProg = buildProgram(gl, MOLECULAR_CLOUD_VERT, MOLECULAR_CLOUD_FRAG, 'cloud');
        bundle = {
          gl,
          volume,
          cloud: cloudProg,
          vao: gl.createVertexArray(),
          posBuf: gl.createBuffer(),
          valBuf: gl.createBuffer(),
          uploaded: null,
        };
        glRef.current = bundle;
        if (volume && probe.floatTextures) {
          setPath('volume');
          setFallbackReason('');
        } else {
          setPath(cloudProg ? 'gpu-cloud' : 'cpu-cloud');
          setFallbackReason(
            !volume ? 'volume shader unavailable' : 'no float-texture support → point cloud',
          );
        }
        return () => {
          volume?.dispose();
          cloudProg?.dispose();
          gl.deleteBuffer(bundle?.posBuf ?? null);
          gl.deleteBuffer(bundle?.valBuf ?? null);
          gl.deleteVertexArray(bundle?.vao ?? null);
          gl.getExtension('WEBGL_lose_context')?.loseContext();
          glRef.current = null;
        };
      }
    } catch (err) {
      console.warn('[molecular-orbitals] WebGL2 init failed, falling back to Canvas2D', err);
    }
    setPath('cpu-cloud');
    setFallbackReason('WebGL2 context creation failed');
    return;
  }, [gpu.webgl2, gpu.floatTextures]);

  /* ------------------------------- sizing ------------------------------- */

  useEffect(() => {
    const host = hostRef.current;
    const canvas = stageRef.current;
    const cpu = cpuRef.current;
    if (!host || !canvas || !cpu) return;
    const apply = () => {
      const rect = host.getBoundingClientRect();
      const tier = useSimStore.getState().gpu.tier;
      // Points are cheaper per pixel than marched voxels, so they get the finer buffer.
      const scale =
        Math.min(2, Math.max(1, window.devicePixelRatio || 1)) *
        (tier === 'low' ? 0.55 : tier === 'balanced' ? 0.8 : 1) *
        (render !== 'pointcloud' ? 1 : 1.2);
      const dpr = Math.max(0.5, Math.min(2, scale));
      const w = Math.max(160, Math.round(rect.width));
      const h = Math.max(120, Math.round(rect.height));
      sizeRef.current = { w, h, dpr };
      for (const el of [canvas, cpu]) {
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(host);
    return () => ro.disconnect();
  }, [render]);

  /* ------------------------------- drawing ------------------------------ */

  const frameRef = useRef({ render, kind, zeta, sign, R, st, peak, bound, cloud, assign });
  frameRef.current = { render, kind, zeta, sign, R, st, peak, bound, cloud, assign };

  const draw = useCallback(
    (elapsed: number) => {
      const { w, h, dpr } = sizeRef.current;
      const pw = Math.max(1, Math.round(w * dpr));
      const ph = Math.max(1, Math.round(h * dpr));
      const f = frameRef.current;
      const state = useSimStore.getState();
      const p = state.params[slug] ?? {};
      const cam = makeCamera(pNum(p, 'camAz', 0.5), pNum(p, 'camEl', 0.22), pNum(p, 'camDist', 18));
      const exposure = pNum(p, 'exposure', 1.2);
      const gamma = pNum(p, 'gamma', 2.2);
      const iso = Math.min(0.95, Math.max(0.05, pNum(p, 'isoLevel', 0.35)));
      const mono = pBool(p, 'monochrome', false) ? 1 : 0;
      const pal = state.prefs.palette === 'cividis' ? 1 : 0;
      const nuclei = pBool(p, 'showNuclei', true) ? 1 : 0;
      const node = pBool(p, 'showNodePlane', true)
        ? f.assign.nodeGeometry === 'between-nuclei'
          ? 1
          : f.assign.nodeGeometry === 'molecular-plane'
            ? 2
            : 0
        : 0;
      const bundle = glRef.current;
      const wantsVolume = f.render !== 'pointcloud' && path === 'volume' && bundle?.volume;

      if (wantsVolume && bundle) {
        const gl = bundle.gl;
        gl.viewport(0, 0, pw, ph);
        gl.clearColor(0.016, 0.02, 0.036, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        const prog = bundle.volume as GpuProgram;
        gl.useProgram(prog.program);
        gl.bindVertexArray(null);
        prog.v3('uCamPos', cam.pos);
        prog.v3('uRight', cam.right);
        prog.v3('uUp', cam.up);
        prog.v3('uFwd', cam.fwd);
        prog.f('uFocal', FOCAL);
        prog.f('uAspect', pw / Math.max(1, ph));
        prog.f('uHalfR', f.R / 2);
        prog.f('uZeta', f.zeta);
        prog.f('uSign', f.sign);
        prog.i('uKind', f.kind === '1s' ? 0 : f.kind === '2pz' ? 1 : 2);
        prog.f('uNorm', f.st.N);
        prog.f('uPeak', f.peak);
        prog.f('uBound', f.bound);
        prog.f('uExposure', exposure);
        prog.f('uGamma', gamma);
        prog.f('uIso', iso);
        prog.i('uMode', f.render === 'isosurface' ? 1 : 0);
        prog.i('uMono', mono);
        prog.i('uPalette', pal);
        prog.i('uShowNuclei', nuclei);
        prog.i('uNodeMode', node);
        prog.f('uTime', elapsed);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return;
      }

      if (bundle?.cloud) {
        const gl = bundle.gl;
        const prog = bundle.cloud;
        gl.viewport(0, 0, pw, ph);
        gl.clearColor(0.016, 0.02, 0.036, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(prog.program);
        if (bundle.vao) gl.bindVertexArray(bundle.vao);
        const n = f.cloud.count;
        if (bundle.uploaded !== f.cloud && n > 0) {
          const pos = prog.attr('aPos');
          const val = prog.attr('aVal');
          if (bundle.posBuf && pos >= 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, bundle.posBuf);
            gl.bufferData(gl.ARRAY_BUFFER, f.cloud.positions, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(pos);
            gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 0, 0);
          }
          if (bundle.valBuf && val >= 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, bundle.valBuf);
            gl.bufferData(gl.ARRAY_BUFFER, f.cloud.values, gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(val);
            gl.vertexAttribPointer(val, 1, gl.FLOAT, false, 0, 0);
          }
          bundle.uploaded = f.cloud;
        }
        prog.v3('uCamPos', cam.pos);
        prog.v3('uRight', cam.right);
        prog.v3('uUp', cam.up);
        prog.v3('uFwd', cam.fwd);
        prog.f('uFocal', FOCAL);
        prog.f('uAspect', pw / Math.max(1, ph));
        prog.f('uPix', ph);
        prog.f('uSize', Math.max(0.06, (0.19 * 1.2) / Math.max(f.zeta, 0.4)));
        prog.f('uPeakAmp', Math.sqrt(f.peak));
        prog.i('uMono', mono);
        prog.i('uPalette', pal);
        prog.f('uExposure', exposure);
        prog.f('uGamma', gamma);
        if (n > 0) gl.drawArrays(gl.POINTS, 0, n);
        if (bundle.vao) gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
        return;
      }

      let ctx = ctx2dRef.current;
      if (!ctx) {
        ctx = cpuRef.current?.getContext('2d') ?? null;
        ctx2dRef.current = ctx;
      }
      if (ctx) drawCpuCloud(ctx, pw, ph, cam, f.cloud, f.R, f.zeta, nuclei, mono, exposure);
    },
    [slug, path],
  );

  useAnimationClock(({ elapsed }) => draw(elapsed));

  /* ----------------------------- interaction ---------------------------- */

  const onPointer = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, phase: 'down' | 'move' | 'up') => {
      const p = useSimStore.getState().params[slug] ?? {};
      if (phase === 'down') {
        interruptDemo();
        dragRef.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          az: pNum(p, 'camAz', 0.5),
          el: pNum(p, 'camEl', 0.22),
        };
        e.currentTarget.setPointerCapture?.(e.pointerId);
        return;
      }
      const drag = dragRef.current;
      if (phase === 'up') {
        dragRef.current = null;
        return;
      }
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      setParam(slug, 'camAz', Math.round((drag.az - dx * 0.008) * 1000) / 1000);
      setParam(slug, 'camEl', Math.round(Math.max(-1.4, Math.min(1.4, drag.el + dy * 0.006)) * 1000) / 1000);
    },
    [interruptDemo, setParam, slug],
  );

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      const p = useSimStore.getState().params[slug] ?? {};
      const step = e.deltaY === 0 ? 0 : Math.sign(e.deltaY);
      const next = Math.max(8, Math.min(60, pNum(p, 'camDist', 18) * (1 + step * 0.08)));
      interruptDemo();
      setParam(slug, 'camDist', Math.round(next * 10) / 10);
    },
    [interruptDemo, setParam, slug],
  );

  const showCurve = pBool(params, 'showCurve', true);
  const isCpu = path === 'cpu-cloud';

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 overflow-hidden bg-obsidian"
      style={{ touchAction: 'none', cursor: 'grab' }}
      onPointerDown={(e) => onPointer(e, 'down')}
      onPointerMove={(e) => onPointer(e, 'move')}
      onPointerUp={(e) => onPointer(e, 'up')}
      onPointerCancel={(e) => onPointer(e, 'up')}
      onWheel={onWheel}
      role="application"
      aria-label={`${assign.label} molecular orbital at R = ${R.toFixed(2)} bohr`}
    >
      <canvas
        ref={stageRef}
        className="absolute inset-0 block"
        style={{ opacity: isCpu ? 0 : 1 }}
      />
      <canvas
        ref={cpuRef}
        className="absolute inset-0 block"
        style={{ opacity: isCpu ? 1 : 0, background: CPU_BACKGROUND }}
      />

      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-0.5 font-mono text-[10.5px] leading-tight text-ink-dim">
        <span className="text-[12px] text-ink">{assign.label}</span>
        <span>
          R = {R.toFixed(2)} a₀ · {auToPm(R).toFixed(0)} pm
        </span>
        <span>
          S = {st.S.toFixed(4)} · N = {st.N.toFixed(3)} · ζ = {zeta.toFixed(3)}
        </span>
        <span className="text-ink-faint">
          {path === 'volume'
            ? `WebGL2 raymarch · ${gpu.tier}`
            : path === 'gpu-cloud'
              ? `WebGL2 point cloud${fallbackReason ? ` · ${fallbackReason}` : ''}`
              : `CPU point cloud${fallbackReason ? ` · ${fallbackReason}` : ''}`}
        </span>
      </div>

      {showCurve ? (
        <CurveOverlay
          slug={slug}
          curve={curve}
          partner={partnerCurve}
          morse={morse}
          limit={limit}
          Z={Z}
          R={R}
          U={st.U}
          eq={eq}
          model={pStr(params, 'curveModel', 'morse')}
          mark={pBool(params, 'markEquilibrium', true)}
          accent={assign.starred ? '#fb7185' : '#f472b6'}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CPU fallback painter                                                */
/* ------------------------------------------------------------------ */

function drawCpuCloud(
  ctx: CanvasRenderingContext2D,
  pw: number,
  ph: number,
  cam: Camera,
  cloud: { positions: Float32Array; values: Float32Array; count: number },
  R: number,
  zeta: number,
  nuclei: number,
  mono: number,
  exposure: number,
): void {
  ctx.clearRect(0, 0, pw, ph);
  // Same projection the GL cloud vertex shader performs: ndc = (x·focal/aspect, y·focal)/z.
  const f = FOCAL * ph * 0.5;
  const cx = pw / 2;
  const cy = ph / 2;
  const n = cloud.count;
  const pos = cloud.positions;
  const val = cloud.values;
  let peakAmp = 1e-9;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(val[i]);
    if (a > peakAmp) peakAmp = a;
  }
  const size = Math.max(0.06, (0.19 * 1.2) / Math.max(zeta, 0.4));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let bucket = 0; bucket < 4; bucket++) {
    const lo = bucket / 4;
    const hi = (bucket + 1) / 4;
    const a = (0.05 + 0.055 * bucket) * Math.max(0.2, exposure);
    ctx.fillStyle =
      mono === 1
        ? `rgba(205,220,250,${a})`
        : bucket >= 2
          ? `rgba(120,176,255,${a})`
          : `rgba(255,128,148,${a})`;
    for (let i = 0; i < n; i++) {
      const v = val[i];
      const s = Math.abs(v) / peakAmp;
      if (s < lo || s >= hi) continue;
      const dx = pos[i * 3] - cam.pos[0];
      const dy = pos[i * 3 + 1] - cam.pos[1];
      const dz = pos[i * 3 + 2] - cam.pos[2];
      const zn = Math.max(0.1, dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2]);
      const xc = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
      const yc = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
      const sx = cx + (xc / zn) * f;
      const sy = cy - (yc / zn) * f;
      if (sx < -6 || sy < -6 || sx > pw + 6 || sy > ph + 6) continue;
      const rad = Math.max(0.6, (size * f) / zn);
      // The sign of ψ splits the cloud into the same two lobes the shader colours.
      ctx.fillStyle =
        mono === 1
          ? `rgba(${180 + bucket * 20},${200 + bucket * 14},250,${a})`
          : v >= 0
            ? `rgba(120,176,255,${a})`
            : `rgba(255,128,148,${a})`;
      ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2);
    }
  }
  ctx.restore();

  if (nuclei !== 1) return;
  const half = R / 2;
  const proj = (wx: number, wy: number, wz: number) => {
    const dx = wx - cam.pos[0];
    const dy = wy - cam.pos[1];
    const dz = wz - cam.pos[2];
    const zn = Math.max(0.1, dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2]);
    const xc = dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2];
    const yc = dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2];
    return [cx + (xc / zn) * f, cy - (yc / zn) * f, zn] as const;
  };
  const a = proj(0, 0, -half);
  const b = proj(0, 0, half);
  ctx.save();
  ctx.strokeStyle = 'rgba(251,191,36,0.55)';
  ctx.lineWidth = Math.max(1, ph / 420);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,226,170,0.95)';
  for (const q of [a, b]) {
    const rad = Math.max(2.4, (0.34 * f) / q[2]);
    ctx.beginPath();
    ctx.arc(q[0], q[1], rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Potential energy curve overlay                                      */
/* ------------------------------------------------------------------ */

interface CurveProps {
  slug: SimSlug;
  curve: CurvePoint[];
  partner: CurvePoint[];
  morse: MorseParams;
  limit: number;
  Z: number;
  R: number;
  U: number;
  eq: ReturnType<typeof equilibriumOf>;
  model: string;
  mark: boolean;
  accent: string;
}

const X0 = 0.4;
const X1 = 12;
const PAD = { l: 34, r: 10, t: 15, b: 17 };

function CurveOverlay({ slug, curve, partner, morse, limit, Z, R, U, eq, model, mark, accent }: CurveProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const setParam = useSimStore((s) => s.setParam);
  const interruptDemo = useSimStore((s) => s.interruptDemo);
  const morseActive = model === 'morse';

  const morseSeries = useMemo(() => curve.map((pt) => morseTotal(pt.R, morse, Z)), [curve, morse, Z]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      // Window: both parity curves plus the Morse model, clipped to a readable band.
      let yMin = Infinity;
      let yMax = -Infinity;
      const eat = (v: number) => {
        if (!Number.isFinite(v)) return;
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      };
      for (const pt of curve) eat(pt.U);
      for (const pt of partner) eat(pt.U);
      for (const v of morseSeries) eat(v);
      yMin = Math.max(yMin, limit - 0.45);
      yMax = Math.min(yMax, limit + 0.7);
      if (!(yMax > yMin)) {
        yMin = limit - 0.2;
        yMax = limit + 0.4;
      }
      yMin -= 0.03;
      yMax += 0.04;

      const px = (rv: number) => PAD.l + ((rv - X0) / (X1 - X0)) * (w - PAD.l - PAD.r);
      const py = (ev: number) => PAD.t + ((yMax - ev) / (yMax - yMin)) * (h - PAD.t - PAD.b);

      plotGrid(ctx, w, h, PAD, 4, 6);
      plotFrame(ctx, w, h, PAD);

      // Dissociation asymptote.
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(148,163,184,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, py(limit));
      ctx.lineTo(w - PAD.r, py(limit));
      ctx.stroke();
      ctx.restore();
      label(ctx, 'separated atoms', PAD.l + 3, py(limit) - 3.5, 'rgba(159,176,204,0.8)', 9);

      // Internuclear repulsion on its own — the wall the bond has to beat.
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(251,191,36,0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let begun = false;
      for (const pt of curve) {
        const ev = limit + (Z * Z) / pt.R;
        if (ev > yMax) {
          begun = false;
          continue;
        }
        const x = px(pt.R);
        const y = py(ev);
        if (!begun) {
          ctx.moveTo(x, y);
          begun = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
      label(ctx, 'Z²/R', px(3.4), py(Math.min(limit + Z * Z / 3.4, yMax - 0.04)) - 4, 'rgba(251,191,36,0.85)', 9);

      const line = (ys: number[], color: string, width: number, dash: number[] | null) => {
        ctx.save();
        ctx.lineWidth = width;
        ctx.strokeStyle = color;
        if (dash) ctx.setLineDash(dash);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < curve.length; i++) {
          const v = ys[i];
          if (!Number.isFinite(v) || v > yMax || v < yMin) {
            started = false;
            continue;
          }
          const x = px(curve[i].R);
          const y = py(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      };

      line(partner.map((pt) => pt.U), 'rgba(251,113,133,0.6)', 1.1, [4, 4]);
      if (morseActive) {
        line(curve.map((pt) => pt.U), 'rgba(94,234,212,0.55)', 1.2, [4, 3]);
        line(morseSeries, accent, 2.2, null);
      } else {
        line(morseSeries, 'rgba(129,140,248,0.6)', 1.2, [4, 3]);
        line(curve.map((pt) => pt.U), accent, 2.2, null);
      }

      if (mark && eq.bound) {
        const ex = px(eq.Re);
        const ey = py(Math.max(yMin, Math.min(yMax, eq.E0)));
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(232,238,252,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ex, py(limit));
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(232,238,252,0.95)';
        ctx.beginPath();
        ctx.arc(ex, ey, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        label(ctx, `R₀ ${eq.Re.toFixed(2)} a₀`, ex + 4, py(limit) + 9, 'rgba(232,238,252,0.85)', 9);
        label(ctx, `Dₑ ${eq.De.toFixed(4)} Ha`, ex + 4, (py(limit) + ey) / 2 - 2, 'rgba(94,234,212,0.95)', 9);
      }

      // Live cursor, synced to the R slider.
      const curX = px(Math.max(X0, Math.min(X1, R)));
      const shown = morseActive ? morseTotal(R, morse, Z) : U;
      const curY = py(Math.max(yMin, Math.min(yMax, shown)));
      ctx.save();
      ctx.strokeStyle = 'rgba(244,114,182,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(curX, PAD.t);
      ctx.lineTo(curX, h - PAD.b);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(curX, curY, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      label(
        ctx,
        `${shown.toFixed(3)} Ha`,
        Math.max(PAD.l, Math.min(w - 56, curX + 5)),
        PAD.t + 8,
        'rgba(232,238,252,0.95)',
        9.5,
      );

      label(ctx, 'E/Ha', 3, PAD.t + 2, 'rgba(107,125,153,0.9)', 8.5);
      label(ctx, 'R/a₀', w - PAD.r - 26, h - 3, 'rgba(107,125,153,0.9)', 8.5);
      for (const rv of [2, 4, 6, 8, 10, 12]) {
        label(ctx, String(rv), px(rv) - 3, h - PAD.b + 11, 'rgba(107,125,153,0.85)', 8.5);
      }
      label(ctx, limit.toFixed(2), 4, py(limit) + 8, 'rgba(107,125,153,0.85)', 8);
    },
    [curve, partner, morseSeries, morse, limit, Z, R, U, eq, mark, morseActive, accent],
  );

  const pickR = useCallback((clientX: number) => {
    const box = boxRef.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    const frac = (clientX - rect.left - PAD.l) / Math.max(1, rect.width - PAD.l - PAD.r);
    return Math.max(X0, Math.min(12, X0 + frac * (X1 - X0)));
  }, []);

  const onDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      interruptDemo();
      draggingRef.current = true;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const rv = pickR(e.clientX);
      if (rv !== null) setParam(slug, 'R', Math.round(rv * 100) / 100);
    },
    [interruptDemo, pickR, setParam, slug],
  );

  const onMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      e.stopPropagation();
      const rv = pickR(e.clientX);
      if (rv !== null) setParam(slug, 'R', Math.round(rv * 100) / 100);
    },
    [pickR, setParam, slug],
  );

  const onUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  return (
    <div
      ref={boxRef}
      className="glass absolute bottom-3 left-3 w-[min(340px,54vw)] rounded-xl border border-hairline bg-glass px-2 pb-1 pt-1.5 shadow-glass backdrop-blur-md"
      style={{ touchAction: 'none', cursor: 'ew-resize' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="group"
      aria-label="Potential energy curve — drag horizontally to set the bond length"
    >
      <div className="flex items-baseline justify-between px-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">
          Potential energy curve
        </span>
        <span className="font-mono text-[10px] text-ink-dim">{morseActive ? 'Morse' : 'LCAO E±(R)'}</span>
      </div>
      <PlotCanvas
        height={134}
        draw={draw}
        deps={[R, U, model, mark, curve, partner, eq.Re, eq.De, morseSeries, Z, limit, accent]}
      />
    </div>
  );
}
