'use client';

/**
 * WebGL2 engine for the 2D double-slit solver.
 *
 * Everything in this file runs only after a canvas element exists: no top-level
 * WebGL or DOM access, so importing it during SSR is free. `createGpuEngine`
 * returns `null` for *any* missing capability (no WebGL2, no renderable float
 * texture, failed shader compile, read-back that does not round-trip), which is
 * what lets the stage fall back to the CPU integrator instead of crashing.
 *
 * Storage: three RGBA float textures rotate through the roles ψ₀ / o1 / o2 for
 * the four Horner passes of one RK4 step — pass k reads state[i−1] plus the
 * frozen ψ₀ and writes the other scratch slot, so a full step needs no copies.
 * Preference order is RGBA32F → RGBA16F (half-float) → no GPU at all, matching
 * the PRD's mitigation for mobile GPUs without EXT_color_buffer_float.
 */

import { DS_PROGRAMS, DS_VERT } from '@/engine/shaders/doubleSlit';
import { MAX_BINS, type SlitConfig, type SlitDrawOptions, type SlitEngine } from './solver';

type GL = WebGL2RenderingContext;

/** Every program in the shader module except the vertex shader. */
type ProgramKey = Exclude<keyof typeof DS_PROGRAMS, 'vert'>;

const PROGRAM_KEYS: ProgramKey[] = ['step', 'emit', 'screen', 'reduce', 'render'];

/** Geometry uniforms live in the shared GLSL chunk, so most programs need them. */
const GEOM_UNIFORMS = [
  'uBarrierX',
  'uBarrierT',
  'uSlitW',
  'uSlitSep',
  'uBarrierV',
  'uSponge',
  'uSpongeW',
];

const UNIFORMS: Record<ProgramKey, string[]> = {
  step: ['uState', 'uBase', 'uN', 'uDt', 'uCoef', 'uFinal', ...GEOM_UNIFORMS],
  emit: ['uState', 'uInject', 'uSigma', 'uP', 'uAmp', 'uTagPhase', 'uTagSlit', ...GEOM_UNIFORMS],
  screen: ['uState', 'uN', 'uRows', 'uScreenX'],
  reduce: ['uState', 'uN', 'uBlock'],
  render: ['uState', 'uN', 'uContrast', 'uFieldAlpha', 'uPhaseColor', 'uPalette', 'uShowBarrier', 'uScreenX', ...GEOM_UNIFORMS],
};

interface Prog {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

interface GpuState {
  gl: GL;
  half: boolean;
  progs: Record<ProgramKey, Prog>;
  state: Target[];
  role: { s: number; o1: number; o2: number };
  strip: Target;
  reduce: Target;
  reduceBlock: number;
  N: number;
  readF32: Float32Array;
  readF16: Uint16Array;
}

function compile(gl: GL, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[double-slit-2d] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: GL, vs: WebGLShader, fragSrc: string, names: string[]): Prog | null {
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!fs) return null;
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(fs);
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[double-slit-2d] program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) uniforms[n] = gl.getUniformLocation(program, n);
  return { program, uniforms };
}

/* ----------------------------- GL state helpers ---------------------------- */

function f1(s: GpuState, p: Prog, name: string, v: number): void {
  const l = p.uniforms[name];
  if (l) s.gl.uniform1f(l, v);
}
function i1(s: GpuState, p: Prog, name: string, v: number): void {
  const l = p.uniforms[name];
  if (l) s.gl.uniform1i(l, v);
}
function f2(s: GpuState, p: Prog, name: string, a: number, b: number): void {
  const l = p.uniforms[name];
  if (l) s.gl.uniform2f(l, a, b);
}

function createTarget(gl: GL, w: number, h: number, half: boolean): Target | null {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const internal = half ? gl.RGBA16F : gl.RGBA32F;
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, half ? gl.HALF_FLOAT : gl.FLOAT, null);
  } catch {
    return null;
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!complete) return null;
  return { tex, fbo, w, h };
}

function deleteTarget(gl: GL, t: Target): void {
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

function bindTarget(s: GpuState, t: Target, w: number, h: number): void {
  const gl = s.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  gl.viewport(0, 0, w, h);
}

/** Draw the full-screen triangle; callers bind samplers first. */
function blit(s: GpuState, p: Prog): void {
  const gl = s.gl;
  gl.useProgram(p.program);
  i1(s, p, 'uState', 0);
  i1(s, p, 'uBase', 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function attach(s: GpuState, tex: WebGLTexture, unit: number): void {
  const gl = s.gl;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

/** Geometry uniforms for every program that includes the GLSL GEOMETRY chunk. */
function setGeometry(s: GpuState, p: Prog, cfg: SlitConfig): void {
  f1(s, p, 'uBarrierX', cfg.barrierX);
  f1(s, p, 'uBarrierT', cfg.barrierT);
  f1(s, p, 'uSlitW', cfg.slitW);
  f1(s, p, 'uSlitSep', cfg.sep);
  f1(s, p, 'uBarrierV', cfg.barrierV);
  f1(s, p, 'uSponge', cfg.sponge);
  f1(s, p, 'uSpongeW', cfg.spongeW);
}

/** IEEE 754 half → float without a Float16Array dependency. */
function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h & 0x7c00) >> 10;
  const frac = h & 0x03ff;
  if (exp === 0) return sign * frac * 5.960464477539063e-8;
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * (1 + frac / 1024) * Math.pow(2, exp - 15);
}

/** Read a float target into `out` (length w·h·4); false if the driver refuses. */
function readPixels(s: GpuState, t: Target, out: Float32Array): boolean {
  const gl = s.gl;
  const n = t.w * t.h * 4;
  const count = Math.min(n, out.length);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
  try {
    if (s.half) {
      const raw = s.readF16.length >= n ? s.readF16 : new Uint16Array(n);
      s.readF16 = raw;
      gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.HALF_FLOAT, raw);
      for (let i = 0; i < count; i++) out[i] = halfToFloat(raw[i << 2] ?? 0);
    } else {
      const raw = s.readF32.length >= n ? s.readF32 : new Float32Array(n);
      s.readF32 = raw;
      gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.FLOAT, raw);
      out.set(raw.subarray(0, count));
    }
  } catch {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return false;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return true;
}

/* -------------------------------- capability ------------------------------- */

/**
 * Gate the store's coarse capability flag through to something this solver can
 * actually use: float render targets are mandatory, not just a WebGL2 context.
 */
export function gpuCapable(gpu: { webgl2: boolean; floatTextures: boolean }): boolean {
  return gpu.webgl2 && gpu.floatTextures;
}

/* --------------------------------- engine --------------------------------- */

export function createGpuEngine(canvas: HTMLCanvasElement, N: number): SlitEngine | null {
  if (typeof window === 'undefined') return null;
  let gl: GL | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    }) as GL | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;

  const extFloat = gl.getExtension('EXT_color_buffer_float');
  const extHalf = gl.getExtension('EXT_color_buffer_half_float');
  if (!extFloat && !extHalf) return null;
  gl.getExtension('OES_texture_float_linear');
  gl.getExtension('OES_texture_half_float_linear');

  const vs = compile(gl, gl.VERTEX_SHADER, DS_VERT);
  if (!vs) return null;
  const progs = {} as Record<ProgramKey, Prog | null>;
  for (const key of PROGRAM_KEYS) progs[key] = link(gl, vs, DS_PROGRAMS[key], UNIFORMS[key]);
  gl.deleteShader(vs);
  const failed = PROGRAM_KEYS.filter((k) => !progs[k]);
  if (failed.length > 0) {
    for (const key of PROGRAM_KEYS) {
      const p = progs[key];
      if (p) gl.deleteProgram(p.program);
    }
    return null;
  }
  const linked = progs as Record<ProgramKey, Prog>;

  for (const half of extFloat ? [false, true] : [true]) {
    const engine = tryBuild(gl, N, half, linked);
    if (engine) return engine;
  }
  for (const key of PROGRAM_KEYS) gl.deleteProgram(linked[key].program);
  return null;
}

function tryBuild(
  gl: GL,
  N: number,
  half: boolean,
  progs: Record<ProgramKey, Prog>,
): SlitEngine | null {
  const size = Math.max(64, Math.min(N, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number));
  const state: Target[] = [];
  for (let i = 0; i < 3; i++) {
    const t = createTarget(gl, size, size, half);
    if (!t) {
      state.forEach((d) => deleteTarget(gl, d));
      return null;
    }
    state.push(t);
  }
  // Reduce target: one block per cell group, ≤ 8×8 taps per fragment (shader cap).
  const reduceBlock = Math.max(1, Math.min(8, Math.ceil(size / 64)));
  const reduceSide = Math.ceil(size / reduceBlock);
  const reduce = createTarget(gl, reduceSide, reduceSide, half);
  const strip = createTarget(gl, 1, MAX_BINS, half);
  if (!reduce || !strip) {
    deleteTarget(gl, state[0] as Target);
    deleteTarget(gl, state[1] as Target);
    deleteTarget(gl, state[2] as Target);
    if (reduce) deleteTarget(gl, reduce);
    return null;
  }

  const s: GpuState = {
    gl,
    half,
    progs,
    state,
    role: { s: 0, o1: 1, o2: 2 },
    strip,
    reduce,
    reduceBlock,
    N: size,
    readF32: new Float32Array(reduceSide * reduceSide * 4),
    readF16: new Uint16Array(reduceSide * reduceSide * 4),
  };

  // Round-trip probe: some drivers advertise float FBOs but read back garbage.
  const target0 = state[0] as Target;
  bindTarget(s, target0, size, size);
  gl.clearColor(0.25, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const probe = new Float32Array(4);
  const ok = readPixels(s, target0, probe) && Math.abs((probe[0] ?? 0) - 0.25) < (half ? 2e-3 : 1e-6);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!ok) {
    for (const t of state) deleteTarget(gl, t);
    deleteTarget(gl, reduce);
    deleteTarget(gl, strip);
    return null;
  }

  const cur = (): Target => state[s.role.s] as Target;
  /** Move the fresh result in `dst` into the live slot. */
  const adopt = (dst: number): void => {
    const prev = s.role.s;
    if (dst === s.role.o1) {
      s.role.s = s.role.o1;
      s.role.o1 = prev;
    } else {
      s.role.s = s.role.o2;
      s.role.o2 = prev;
    }
  };

  const step = (cfg: SlitConfig): void => {
    const p = progs.step;
    const base = cur();
    setGeometry(s, p, cfg);
    i1(s, p, 'uN', size);
    f1(s, p, 'uDt', cfg.dt);
    const coefs = [cfg.dt / 4, cfg.dt / 3, cfg.dt / 2, cfg.dt];
    const seq = [s.role.o1, s.role.o2, s.role.o1, s.role.o2];
    let src = s.role.s;
    for (let k = 0; k < 4; k++) {
      const dst = seq[k] as number;
      bindTarget(s, state[dst] as Target, size, size);
      attach(s, state[src] as Target, 0);
      attach(s, base, 1);
      f1(s, p, 'uCoef', coefs[k] as number);
      i1(s, p, 'uFinal', k === 3 ? 1 : 0);
      blit(s, p);
      src = dst;
    }
    adopt(seq[3] as number);
  };

  return {
    kind: 'gpu',
    N: size,

    reset(): void {
      for (const t of state) {
        bindTarget(s, t, t.w, t.h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      bindTarget(s, strip, strip.w, strip.h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },

    emit(cfg: SlitConfig, phase: number): void {
      const p = progs.emit;
      const dst = s.role.o1;
      bindTarget(s, state[dst] as Target, size, size);
      attach(s, cur(), 0);
      setGeometry(s, p, cfg);
      f2(s, p, 'uInject', cfg.injectX, cfg.packetY);
      f2(s, p, 'uSigma', cfg.sigmaX, cfg.sigmaD);
      f1(s, p, 'uP', cfg.momentum);
      f1(s, p, 'uAmp', cfg.amp);
      f1(s, p, 'uTagPhase', cfg.whichPath ? phase : 0);
      i1(s, p, 'uTagSlit', cfg.tagSlit);
      blit(s, p);
      adopt(dst);
    },

    advance(cfg: SlitConfig, steps: number): void {
      const n = Math.max(0, Math.min(200, Math.round(steps)));
      for (let i = 0; i < n; i++) step(cfg);
    },

    probe(cfg: SlitConfig, rows: number, density: Float32Array, flux: Float32Array): number {
      const rp = progs.reduce;
      bindTarget(s, s.reduce, s.reduce.w, s.reduce.h);
      attach(s, cur(), 0);
      i1(s, rp, 'uN', size);
      i1(s, rp, 'uBlock', s.reduceBlock);
      blit(s, rp);

      let norm = 0;
      const buf = s.readF32.length >= s.reduce.w * s.reduce.h * 4 ? s.readF32 : new Float32Array(s.reduce.w * s.reduce.h * 4);
      if (readPixels(s, s.reduce, buf)) {
        for (let i = 0; i < buf.length; i += 4) norm += buf[i] as number;
      }

      const want = Math.max(1, Math.min(rows, strip.h, density.length, flux.length));
      const sp = progs.screen;
      bindTarget(s, strip, 1, want);
      attach(s, cur(), 0);
      i1(s, sp, 'uN', size);
      i1(s, sp, 'uRows', want);
      f1(s, sp, 'uScreenX', cfg.screenX);
      blit(s, sp);

      const stripBuf = new Float32Array(want * 4);
      if (readPixels(s, { tex: strip.tex, fbo: strip.fbo, w: 1, h: want }, stripBuf)) {
        for (let r = 0; r < want; r++) {
          density[r] = stripBuf[r * 4] as number;
          flux[r] = stripBuf[r * 4 + 1] as number;
        }
        for (let r = want; r < rows; r++) {
          const src = r % want;
          density[r] = stripBuf[src * 4] as number;
          flux[r] = stripBuf[src * 4 + 1] as number;
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return norm;
    },

    draw(canvasEl: HTMLCanvasElement, cfg: SlitConfig, opts: SlitDrawOptions): void {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.max(1, Math.round(canvasEl.clientWidth * dpr));
      const ch = Math.max(1, Math.round(canvasEl.clientHeight * dpr));
      if (canvasEl.width !== cw || canvasEl.height !== ch) {
        canvasEl.width = cw;
        canvasEl.height = ch;
      }
      const p = progs.render;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      attach(s, cur(), 0);
      f1(s, p, 'uContrast', opts.contrast);
      f1(s, p, 'uFieldAlpha', opts.fieldAlpha);
      i1(s, p, 'uPhaseColor', opts.phaseColor ? 1 : 0);
      i1(s, p, 'uPalette', opts.palette);
      i1(s, p, 'uShowBarrier', opts.showBarrier ? 1 : 0);
      f1(s, p, 'uScreenX', cfg.screenX);
      i1(s, p, 'uN', size);
      setGeometry(s, p, cfg);
      blit(s, p);
    },

    dispose(): void {
      for (const t of state) deleteTarget(gl, t);
      deleteTarget(gl, reduce);
      deleteTarget(gl, strip);
      for (const key of PROGRAM_KEYS) gl.deleteProgram(progs[key].program);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    },
  };
}
