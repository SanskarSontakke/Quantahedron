'use client';

/**
 * Tiny DPR-aware 2D plotting surface shared by every simulation's charts
 * (radial distribution, T(E), wavefunction slices, spectra, energy ladders).
 * It is deliberately imperative: a sim hands in a draw callback plus its state
 * dependencies, and the canvas repaints on change — no charting library, no
 * reflow, tabular-stable axes.
 */

import { memo, useEffect, useRef } from 'react';

export interface PlotSeries {
  /** Normalised [0,1] x values or absolute; axes are handled by the caller. */
  ys: number[];
  xs?: number[];
  color: string;
  width?: number;
  fill?: boolean;
  dashed?: boolean;
  alpha?: number;
}

export interface PlotCanvasProps {
  width?: number;
  height?: number;
  className?: string;
  /** Called with a ready-to-draw 2D context sized in CSS pixels. */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  deps: unknown[];
  background?: string;
}

export const PlotCanvas = memo(function PlotCanvas({
  width = 320,
  height = 140,
  className,
  draw,
  deps,
  background = 'transparent',
}: PlotCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const w = canvas.clientWidth || width;
    const h = canvas.clientHeight || height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
    }
    draw(ctx, w, h);
    // deps intentionally spread: the sim declares what invalidates the chart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, width, height, background, ...deps]);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: '100%', height, display: 'block' }}
      role="img"
    />
  );
});

/* ----------------------------- drawing helpers ---------------------------- */

export function plotFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: { l: number; r: number; t: number; b: number },
  color = 'rgba(148,163,184,0.22)',
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, h - pad.b);
  ctx.lineTo(w - pad.r, h - pad.b);
  ctx.stroke();
}

export function plotGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: { l: number; r: number; t: number; b: number },
  rows = 4,
  cols = 6,
) {
  ctx.strokeStyle = 'rgba(148,163,184,0.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i <= rows; i++) {
    const y = pad.t + ((h - pad.t - pad.b) * i) / rows;
    ctx.moveTo(pad.l, y);
    ctx.lineTo(w - pad.r, y);
  }
  for (let i = 1; i <= cols; i++) {
    const x = pad.l + ((w - pad.l - pad.r) * i) / cols;
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, h - pad.b);
  }
  ctx.stroke();
}

export function drawSeries(
  ctx: CanvasRenderingContext2D,
  series: PlotSeries,
  map: (i: number, series: PlotSeries) => [number, number],
  bounds: { x0: number; x1: number; y0: number; y1: number },
  toPx: (x: number, y: number) => [number, number],
) {
  const { x0, x1, y0, y1 } = bounds;
  ctx.save();
  ctx.lineWidth = series.width ?? 1.6;
  ctx.strokeStyle = series.color;
  ctx.globalAlpha = series.alpha ?? 1;
  if (series.dashed) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < series.ys.length; i++) {
    const [nx, ny] = map(i, series);
    const xv = series.xs ? series.xs[i] : nx;
    const [px, py] = toPx(
      x0 + (x1 - x0) * xv,
      y0 + (y1 - y0) * (Number.isFinite(ny) ? ny : 0),
    );
    if (!started) {
      ctx.moveTo(px, py);
      started = true;
    } else ctx.lineTo(px, py);
  }
  ctx.stroke();
  if (series.fill) {
    const [, base] = toPx(0, y0);
    ctx.lineTo(toPx(x1, y0)[0], base);
    ctx.lineTo(toPx(x0, y0)[0], base);
    ctx.closePath();
    ctx.globalAlpha = (series.alpha ?? 1) * 0.18;
    ctx.fillStyle = series.color;
    ctx.fill();
  }
  ctx.restore();
}

export function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color = 'rgba(148,163,184,0.75)',
  size = 9.5,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${size}px "JetBrains Mono", ui-monospace, monospace`;
  ctx.fillText(text, x, y);
  ctx.restore();
}
