'use client';

/**
 * CPU engine for the 2D double-slit solver — the fallback when WebGL2 or float
 * render targets are missing. It runs the *same* discretisation as the shaders
 * (see `solver.ts`: RK4 as a Horner-factored polynomial in −i·dt·Ĥ) on plain
 * Float32Array planes, at a reduced lattice (`cpuGridRes`), and renders through
 * a 2D canvas so the simulation is still correct with software rendering,
 * `gpu: 'cpu'`, or a blocked context. Nothing here touches WebGL.
 *
 * The canvas y axis points down while the lattice/`uv` axis points up, so rows
 * are read flipped — that keeps the two engines pixel-for-pixel comparable.
 */

import { phaseColor } from '@/lib/colorMap';
import {
  type SlitConfig,
  type SlitDrawOptions,
  type SlitEngine,
  clearField,
  createBuffers,
  emitPacket,
  fieldNorm,
  readStrip,
  rk4Step,
} from './solver';

/** Tone-map constants shared with DS_RENDER_FRAG. */
const BG_R = 0.024;
const BG_G = 0.031;
const BG_B = 0.051;
const MAX_SIDE = 320;

interface Scratch {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  px: Uint8ClampedArray;
  side: number;
}

function makeScratch(side: number): Scratch | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return null;
  const img = ctx.createImageData(side, side);
  return { canvas, ctx, img, px: img.data, side };
}

/** Lattice → RGBA image, on the shader's log tone map with the platform wheel. */
function paint(scratch: Scratch, re: Float32Array, im: Float32Array, N: number, opts: SlitDrawOptions): void {
  const side = scratch.side;
  const px = scratch.px;
  const contrast = Math.max(0.01, opts.contrast);
  const denom = Math.log(1 + 900 * contrast);
  const palette = opts.palette === 1 ? 'cividis' : 'twilight';
  const step = N / side;
  const alpha = opts.fieldAlpha;
  let o = 0;
  for (let jj = 0; jj < side; jj++) {
    const j = N - 1 - Math.min(N - 1, Math.floor((jj + 0.5) * step));
    const row = j * N;
    for (let ii = 0; ii < side; ii++) {
      const i = Math.min(N - 1, Math.floor((ii + 0.5) * step));
      const idx = row + i;
      const a = re[idx] ?? 0;
      const b = im[idx] ?? 0;
      const rho = a * a + b * b;
      let lum = Math.log(1 + rho * 900 * contrast) / denom;
      lum = lum < 0 ? 0 : lum > 1 ? 1 : lum;
      const glow = Math.pow(lum, 1.6) * 1.35;
      let cr = 0.62;
      let cg = 0.85;
      let cb = 1.0;
      if (opts.phaseColor) {
        const col = phaseColor(Math.atan2(b, a), palette);
        cr = col.r;
        cg = col.g;
        cb = col.b;
      }
      px[o++] = ((BG_R + cr * glow) * 255 * alpha + 255 * BG_R * (1 - alpha)) | 0;
      px[o++] = ((BG_G + cg * glow) * 255 * alpha + 255 * BG_G * (1 - alpha)) | 0;
      px[o++] = ((BG_B + cb * glow) * 255 * alpha + 255 * BG_B * (1 - alpha)) | 0;
      px[o++] = 255;
    }
  }
  scratch.ctx.putImageData(scratch.img, 0, 0);
}

/** Barrier slab, apertures and detector line as a vector overlay. */
function overlay(ctx: CanvasRenderingContext2D, w: number, h: number, cfg: SlitConfig, opts: SlitDrawOptions): void {
  if (opts.showBarrier) {
    const x0 = (cfg.barrierX - cfg.barrierT / 2) * w;
    const tw = Math.max(1, cfg.barrierT * w);
    ctx.fillStyle = 'rgba(19, 22, 31, 0.92)';
    ctx.fillRect(x0, 0, tw, h);
    ctx.strokeStyle = 'rgba(150, 200, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, 0.5, tw, h);
    ctx.fillStyle = 'rgba(8, 10, 16, 1)';
    for (const cy of [cfg.slitY0, cfg.slitY1]) {
      ctx.fillRect(x0, (1 - cy - cfg.slitW / 2) * h, tw, Math.max(1, cfg.slitW * h));
    }
  }
  const sx = cfg.screenX * w;
  ctx.strokeStyle = 'rgba(90, 242, 194, 0.55)';
  ctx.lineWidth = Math.max(1, w / 420);
  ctx.beginPath();
  ctx.moveTo(sx, 0);
  ctx.lineTo(sx, h);
  ctx.stroke();
}

/**
 * Build the CPU engine. `canvas` must be a canvas whose 2D context has not been
 * taken by anything else; returns null if 2D is unavailable too, so the stage
 * degrades to telemetry instead of crashing.
 */
export function createCpuEngine(canvas: HTMLCanvasElement, N: number): SlitEngine | null {
  if (typeof window === 'undefined') return null;
  const side = Math.max(48, Math.min(Math.round(N), MAX_SIDE));
  const ctx = canvas.getContext('2d', { alpha: false });
  const scratch = makeScratch(side);
  if (!ctx || !scratch) return null;

  const buf = createBuffers(side);

  return {
    kind: 'cpu',
    N: side,

    reset(): void {
      clearField(buf.state);
      clearField(buf.tmp1);
      clearField(buf.tmp2);
    },

    emit(cfg: SlitConfig, phase: number): void {
      emitPacket(buf.state, cfg, phase);
    },

    advance(cfg: SlitConfig, steps: number): void {
      const n = Math.max(0, Math.min(60, Math.round(steps)));
      for (let i = 0; i < n; i++) rk4Step(buf, cfg);
    },

    probe(cfg: SlitConfig, rows: number, density: Float32Array, flux: Float32Array): number {
      readStrip(buf.state, cfg, rows, density, flux);
      return fieldNorm(buf.state);
    },

    draw(el: HTMLCanvasElement, cfg: SlitConfig, opts: SlitDrawOptions): void {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      paint(scratch, buf.state.re, buf.state.im, side, opts);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scratch.canvas, 0, 0, w, h);
      overlay(ctx, w, h, cfg, opts);
    },

    dispose(): void {
      clearField(buf.state);
      clearField(buf.tmp1);
      clearField(buf.tmp2);
    },
  };
}
