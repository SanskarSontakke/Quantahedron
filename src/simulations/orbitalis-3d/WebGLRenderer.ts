/**
 * Orbitalis 3D — WebGL2 renderer.
 *
 * Responsibilities, in the order the PRD asks for them:
 *  · upload one 3D texture per eigenstate slot (RGBA16F, or packed RGBA8 when the
 *    device cannot sample half-float — the §7 mitigation),
 *  · evaluate Ψ(x,t) by recombination in the fragment shader (uniforms only, so
 *    amplitude/phase/field/time edits never touch the bake),
 *  · present it as an absorption–emission volume, a shaded isosurface with an
 *    octant cutaway, a planar slice, or a Born-rule sampling cloud,
 *  · overlay probability-current streamlines and measurement dots.
 *
 * The class owns no React state and no store; the Canvas component drives it.
 */

import {
  FULLSCREEN_VS,
  ISOSURFACE_FRAG,
  LINE_FS,
  LINE_VS,
  POINTS_FS,
  POINTS_VS,
  SLICE_FRAG,
  VOLUME_FRAGS,
} from './shaders';
import type { BakeData, FrameState } from './types';
import { POINT_STRIDE } from './sampler';

type Mat4 = Float32Array;
type VolumeTier = 'high' | 'balanced' | 'low';

const SLOT_COUNT = 4;
const FOV = (42 * Math.PI) / 180;

/* ------------------------------- mat4 ----------------------------------- */

function mat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function perspective(out: Mat4, fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function lookAt(out: Mat4, eye: [number, number, number], up: [number, number, number]): Mat4 {
  // Always looking at the origin, which is where the nucleus is.
  let zx = eye[0], zy = eye[1], zz = eye[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function invert(out: Mat4, m: Mat4): Mat4 {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) {
    out.set(mat4());
    return out;
  }
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/* ----------------------------- shader utils ------------------------------ */

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[orbitalis] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram | null {
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn('[orbitalis] program link failed:', gl.getProgramInfoLog(p));
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

type ProgramKind = 'volume' | 'iso' | 'slice' | 'points' | 'lines';

interface ProgramEntry {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

export interface PointDraw {
  buffer: Float32Array;
  count: number;
  tint: [number, number, number];
}

export interface LineDraw {
  buffer: Float32Array;
  count: number;
  color: [number, number, number];
}

export class OrbitalisRenderer {
  readonly gl: WebGL2RenderingContext;
  /** True when the device cannot sample half-float 3D textures → RGBA8 packing. */
  readonly packed: boolean;
  readonly tier: VolumeTier;

  private canvas: HTMLCanvasElement;
  private programs = new Map<string, ProgramEntry>();
  private emptyVao: WebGLVertexArrayObject;
  private pointVao: WebGLVertexArrayObject;
  private pointBuf: WebGLBuffer;
  private pointCap = 0;
  private lineVao: WebGLVertexArrayObject;
  private lineBuf: WebGLBuffer;
  private lineCap = 0;
  private textures: (WebGLTexture | null)[] = [null, null, null, null];
  private textureRes = [0, 0, 0, 0];
  private blank: WebGLTexture;
  private view = mat4();
  private proj = mat4();
  private vp = mat4();
  private invVp = mat4();
  private scratch = new Float32Array(SLOT_COUNT * 3);
  private disposed = false;
  viewport = { w: 1, h: 1 };

  constructor(canvas: HTMLCanvasElement, tier: VolumeTier = 'balanced') {
    this.canvas = canvas;
    this.tier = tier;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.packed = !this.supportsHalfFloat();
    this.emptyVao = gl.createVertexArray()!;
    this.pointVao = gl.createVertexArray()!;
    this.pointBuf = gl.createBuffer()!;
    this.lineVao = gl.createVertexArray()!;
    this.lineBuf = gl.createBuffer()!;
    this.blank = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, this.blank);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }

  /** Probe: upload + sample one half-float 3D texel (float-linear is core in ES3). */
  private supportsHalfFloat(): boolean {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) return false;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    const data = new Uint16Array(4); // a zero half-float
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, 1, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, data);
    const ok = gl.getError() === gl.NO_ERROR;
    gl.deleteTexture(tex);
    gl.bindTexture(gl.TEXTURE_3D, null);
    return ok;
  }

  private getProgram(kind: ProgramKind): ProgramEntry | null {
    const key = `${kind}:${this.packed ? 1 : 0}:${this.tier}`;
    const cached = this.programs.get(key);
    if (cached) return cached;
    let vs = FULLSCREEN_VS;
    let fs: string | null = null;
    if (kind === 'volume') fs = VOLUME_FRAGS[this.tier](this.packed);
    else if (kind === 'iso') fs = ISOSURFACE_FRAG(this.packed);
    else if (kind === 'slice') fs = SLICE_FRAG(this.packed);
    else if (kind === 'points') {
      vs = POINTS_VS;
      fs = POINTS_FS;
    } else {
      vs = LINE_VS;
      fs = LINE_FS;
    }
    const program = link(this.gl, vs, fs);
    if (!program) return null;
    const entry: ProgramEntry = { program, uniforms: new Map() };
    this.programs.set(key, entry);
    return entry;
  }

  private uniform(entry: ProgramEntry, name: string): WebGLUniformLocation | null {
    const cached = entry.uniforms.get(name);
    if (cached !== undefined) return cached;
    const loc = this.gl.getUniformLocation(entry.program, name);
    entry.uniforms.set(name, loc);
    return loc;
  }

  /* ------------------------------ textures ------------------------------- */

  uploadSlot(index: number, data: BakeData | null) {
    const gl = this.gl;
    if (this.disposed || index < 0 || index >= SLOT_COUNT) return;
    if (!data) {
      this.textures[index] = null;
      this.textureRes[index] = 0;
      return;
    }
    const tex = this.textures[index] ?? gl.createTexture();
    if (!tex) return;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    if (this.textureRes[index] !== data.res) {
      // Resolution change means a fresh allocation; LINEAR filtering both ways.
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    }
    if (data.packed) {
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, data.res, data.res, data.res, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.gpu as Uint8Array);
    } else {
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, data.res, data.res, data.res, 0, gl.RGBA, gl.HALF_FLOAT, data.gpu as Uint16Array);
    }
    this.textures[index] = tex;
    this.textureRes[index] = data.res;
    this.lastFrame = null;
  }

  /** Invalidate the per-frame uniform memo so the next draw re-uploads slots. */
  private lastFrame: string | null = null;
  private lastRes = 0;

  /* ------------------------------- sizing -------------------------------- */

  /** `scale` is the dynamic-resolution factor (1 = native DPR, <1 when hot). */
  resize(cssWidth: number, cssHeight: number, dpr: number, scale = 1) {
    const gl = this.gl;
    const w = Math.max(1, Math.round(cssWidth * dpr * scale));
    const h = Math.max(1, Math.round(cssHeight * dpr * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.viewport = { w, h };
    gl.viewport(0, 0, w, h);
  }

  /* ------------------------------- drawing ------------------------------- */

  private camera(frame: FrameState) {
    const el = Math.max(-1.5, Math.min(1.5, frame.camEl));
    const dist = Math.max(frame.rBox * 1.2, frame.camDist);
    const eye: [number, number, number] = [
      dist * Math.cos(el) * Math.cos(frame.camAz),
      dist * Math.sin(el),
      dist * Math.cos(el) * Math.sin(frame.camAz),
    ];
    const aspect = this.viewport.w / Math.max(1, this.viewport.h);
    const near = Math.max(0.05, dist * 0.02);
    const far = dist + frame.rBox * 4;
    perspective(this.proj, FOV, aspect, near, far);
    lookAt(this.view, eye, [0, 1, 0]);
    multiply(this.vp, this.proj, this.view);
    invert(this.invVp, this.vp);
    return eye;
  }

  render(frame: FrameState, points?: PointDraw, lines?: LineDraw) {
    const gl = this.gl;
    if (this.disposed) return;
    const eye = this.camera(frame);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0.008, 0.011, 0.02, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const kind: ProgramKind =
      frame.mode === 'isosurface' ? 'iso' : frame.mode === 'slice' ? 'slice' : 'volume';
    const entry = frame.mode === 'pointcloud' ? null : this.getProgram(kind);

    if (entry) {
      gl.useProgram(entry.program);
      gl.bindVertexArray(this.emptyVao);
      gl.uniformMatrix4fv(this.uniform(entry, 'uInvViewProj'), false, this.invVp);
      gl.uniform3f(this.uniform(entry, 'uCamPos'), eye[0], eye[1], eye[2]);
      gl.uniform2f(this.uniform(entry, 'uResolution'), this.viewport.w, this.viewport.h);
      gl.uniform1f(this.uniform(entry, 'uRBox'), frame.rBox);
      gl.uniform1f(this.uniform(entry, 'uTime'), frame.time);
      gl.uniform1f(this.uniform(entry, 'uExposure'), frame.exposure);
      gl.uniform1f(this.uniform(entry, 'uGamma'), frame.gamma);
      gl.uniform1f(this.uniform(entry, 'uIsoLevel'), frame.isoLevel);
      gl.uniform1f(this.uniform(entry, 'uDensity'), frame.density);
      gl.uniform1f(this.uniform(entry, 'uSliceOffset'), frame.sliceOffset);
      gl.uniform1i(this.uniform(entry, 'uSliceAxis'), frame.sliceAxis === 'xy' ? 0 : frame.sliceAxis === 'xz' ? 1 : 2);
      gl.uniform1i(this.uniform(entry, 'uOctant'), frame.octant ? 1 : 0);
      gl.uniform1i(this.uniform(entry, 'uMonochrome'), frame.monochrome ? 1 : 0);
      gl.uniform1i(this.uniform(entry, 'uShowAxes'), frame.showAxes ? 1 : 0);
      gl.uniform1i(this.uniform(entry, 'uPalette'), frame.palette);

      const token = `${frame.count}|${frame.omega.join(',')}|${frame.amps.join(',')}|${frame.phases.join(',')}`;
      if (token !== this.lastFrame || this.lastRes !== frame.rBox) {
        gl.uniform1i(this.uniform(entry, 'uCount'), Math.min(SLOT_COUNT, Math.max(0, frame.count)));
        const om = this.scratch.subarray(0, SLOT_COUNT);
        const am = this.scratch.subarray(SLOT_COUNT, SLOT_COUNT * 2);
        const ph = this.scratch.subarray(SLOT_COUNT * 2, SLOT_COUNT * 3);
        for (let i = 0; i < SLOT_COUNT; i++) {
          om[i] = frame.omega[i] ?? 0;
          am[i] = frame.amps[i] ?? 0;
          ph[i] = frame.phases[i] ?? 0;
        }
        gl.uniform1fv(this.uniform(entry, 'uOmega[0]'), om);
        gl.uniform1fv(this.uniform(entry, 'uAmp[0]'), am);
        gl.uniform1fv(this.uniform(entry, 'uPhase[0]'), ph);
        this.lastFrame = token;
        this.lastRes = frame.rBox;
      }

      for (let i = 0; i < SLOT_COUNT; i++) {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_3D, this.textures[i] ?? this.blank);
        gl.uniform1i(this.uniform(entry, `uTex[${i}]`), i);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    if (lines && lines.count > 0) this.drawLines(lines, frame);
    if (points && points.count > 0) this.drawPoints(points, frame);
    gl.bindVertexArray(null);
  }

  private drawPoints(draw: PointDraw, frame: FrameState) {
    const gl = this.gl;
    const entry = this.getProgram('points');
    if (!entry) return;
    const needed = draw.buffer.byteLength;
    gl.bindVertexArray(this.pointVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    if (needed > this.pointCap) {
      gl.bufferData(gl.ARRAY_BUFFER, needed, gl.DYNAMIC_DRAW);
      this.pointCap = needed;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, draw.buffer);
    const stride = POINT_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
    gl.useProgram(entry.program);
    gl.uniformMatrix4fv(this.uniform(entry, 'uViewProj'), false, this.vp);
    gl.uniform1f(this.uniform(entry, 'uScale'), this.viewport.h / 420);
    gl.uniform3f(this.uniform(entry, 'uTint'), draw.tint[0], draw.tint[1], draw.tint[2]);
    gl.uniform1i(this.uniform(entry, 'uPalette'), frame.palette);
    gl.uniform1i(this.uniform(entry, 'uMonochrome'), frame.monochrome ? 1 : 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, draw.count);
    gl.disable(gl.BLEND);
  }

  private drawLines(draw: LineDraw, frame: FrameState) {
    const gl = this.gl;
    const entry = this.getProgram('lines');
    if (!entry) return;
    const needed = draw.buffer.byteLength;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    if (needed > this.lineCap) {
      gl.bufferData(gl.ARRAY_BUFFER, needed, gl.DYNAMIC_DRAW);
      this.lineCap = needed;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, draw.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
    gl.useProgram(entry.program);
    gl.uniformMatrix4fv(this.uniform(entry, 'uViewProj'), false, this.vp);
    gl.uniform3f(this.uniform(entry, 'uColor'), draw.color[0], draw.color[1], draw.color[2]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.drawArrays(gl.LINES, 0, draw.count);
    gl.disable(gl.BLEND);
    void frame;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    for (const entry of this.programs.values()) gl.deleteProgram(entry.program);
    this.programs.clear();
    for (const tex of this.textures) if (tex) gl.deleteTexture(tex);
    this.textures = [null, null, null, null];
    gl.deleteTexture(this.blank);
    gl.deleteBuffer(this.pointBuf);
    gl.deleteBuffer(this.lineBuf);
    gl.deleteVertexArray(this.pointVao);
    gl.deleteVertexArray(this.lineVao);
    gl.deleteVertexArray(this.emptyVao);
  }
}

/** Static capability check used before mounting the renderer. */
export function webgl2Available(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    return Boolean(gl);
  } catch {
    return false;
  }
}
