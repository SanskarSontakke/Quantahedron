/**
 * render.ts — Canvas2D drawing for the Stern–Gerlach beam bench.
 *
 * The bench is drawn in a fixed axonometric projection of the real 3D geometry:
 * the silver beam flies along +ŷ, ẑ is "up" on screen and x̂ comes toward the
 * viewer, so a z-analyser splits vertically, an x-analyser splits sideways and a
 * y-analyser (parallel to the flight) bends the beam along its own path — exactly
 * what a student has to see to believe that only the *transverse* field gradient
 * separates the beams.
 *
 * Every thickness, count and bar in here comes from the engine:
 * `buildBench()` turns the block-free splitting tree into polylines whose weights
 * are |P±χ|², and the detector numbers are the Monte-Carlo accumulator.
 */

import { vCross, vNormalize, v3, type ChainResult, type Vec3 } from '@/engine/physics/blochSpin';
import { channelKey, portLabel, type SGModel } from './chain';
import type { Counter, LiveSpin } from './live';

const UP = '94,234,212';
const DOWN = '251,113,133';
const ACCENT = '96,165,250';
const INK = '232,238,252';
const FAINT = '148,163,184';
const WARN = '251,191,36';

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ */
/* Axonometric projection                                              */
/* ------------------------------------------------------------------ */

/** World axes mapped to raw (u, v) screen axes before fitting. */
const AX_UB = [-0.31, 0.94, 0.02] as const;
const AX_VB = [0.25, 0.2, -1] as const;

interface Proj {
  k: number;
  ox: number;
  oy: number;
}

interface XY {
  x: number;
  y: number;
}

function rawOf(v: Vec3): [number, number] {
  return [v[0] * AX_UB[0] + v[1] * AX_UB[1] + v[2] * AX_UB[2], v[0] * AX_VB[0] + v[1] * AX_VB[1] + v[2] * AX_VB[2]];
}

/** Fit a set of world points into a box with padding, keeping aspect. */
function fitProj(pts: Vec3[], x: number, y: number, w: number, h: number, pad: number): Proj {
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of pts) {
    const [u, v] = rawOf(p);
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  const su = Math.max(1e-3, u1 - u0);
  const sv = Math.max(1e-3, v1 - v0);
  const k = Math.min((w - pad * 2) / su, (h - pad * 2) / sv);
  return { k, ox: x + pad + (w - pad * 2 - su * k) / 2 - u0 * k, oy: y + pad + (h - pad * 2 - sv * k) / 2 - v0 * k };
}

function put(p: Vec3, pr: Proj, out: XY): XY {
  const [u, v] = rawOf(p);
  out.x = pr.ox + u * pr.k;
  out.y = pr.oy + v * pr.k;
  return out;
}

/* ------------------------------------------------------------------ */
/* Bench geometry                                                      */
/* ------------------------------------------------------------------ */

export interface BenchRay {
  path: number[];
  weight: number;
  pts: Vec3[];
  blocked: boolean;
  /** Screen-space-independent exit direction of the last segment. */
  exitDir: Vec3;
}

export interface BenchGeom {
  rays: BenchRay[];
  /** Longitudinal position of each analyser. */
  ys: number[];
  /** Detector plane position. */
  detY: number;
  /** Transverse deflection per unit length. */
  slope: number;
}

const vAdd = (a: Vec3, b: Vec3): Vec3 => v3(a[0] + b[0], a[1] + b[1], a[2] + b[2]);
const vMul = (a: Vec3, s: number): Vec3 => v3(a[0] * s, a[1] * s, a[2] * s);

/**
 * Turn the block-free splitting tree into polylines. A ray whose path runs into a
 * closed port stops at that port's beam block, so blocked beams stay visible.
 */
export function buildBench(m: SGModel, open: ChainResult): BenchGeom {
  const n = m.stages.length;
  const ys: number[] = [];
  for (let i = 0; i < n; i++) ys.push(0.95 + i * 1.05);
  const detY = (ys[n - 1] ?? 0.95) + 1.3;
  const slope = 0.34 * m.gradient * (0.5 / Math.max(0.14, m.magnetGap));
  const rays: BenchRay[] = [];

  const seen = new Set<string>();
  for (const r of open.rays) {
    if (!r.path.length) continue;
    let blockAt = -1;
    for (let i = 0; i < r.path.length; i++) {
      const st = m.stages[i];
      if (!st) break;
      if ((r.path[i] === 1 && st.blockUp) || (r.path[i] === -1 && st.blockDown)) {
        blockAt = i;
        break;
      }
    }
    // A beam stopped by a plug is drawn only as far as that plug. Several leaves of
    // the block-free tree share one dead prefix, so the truncated path is emitted
    // once and carries the prefix weight (the probability of being absorbed there).
    const cut = blockAt >= 0 ? blockAt + 1 : r.path.length;
    const path = r.path.slice(0, cut);
    const key = channelKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    let weight = 1;
    for (let i = 0; i < cut; i++) {
      const p = path[i] === 1 ? (r.split[i] ?? 0) : 1 - (r.split[i] ?? 0);
      weight *= p;
    }

    const pts: Vec3[] = [v3(0, 0, 0)];
    let pos: Vec3 = v3(0, 0, 0);
    // The beam always advances along +ŷ at unit speed; an analyser only adds a
    // transverse drift, so `vel` carries both — otherwise the polyline never leaves
    // the source plane.
    let vel: Vec3 = v3(0, 1, 0);
    let lastY = 0;
    let exitDir: Vec3 = v3(0, 1, 0);
    for (let i = 0; i < path.length; i++) {
      pos = vAdd(pos, vMul(vel, ys[i] - lastY));
      pts.push(v3(pos[0], pos[1], pos[2]));
      const axis = m.stages[i].axis;
      const dir = axisVectorDir(axis);
      const sgn = path[i];
      if (i === blockAt) {
        const stub = vAdd(pos, vMul(dir, sgn * 0.36));
        pts.push(stub);
        exitDir = vMul(dir, sgn);
        break;
      }
      vel = v3(dir[0] * sgn * slope, 1, dir[2] * sgn * slope);
      exitDir = vel;
      lastY = ys[i];
    }
    if (blockAt < 0) pts.push(vAdd(pos, vMul(vel, detY - lastY)));
    rays.push({ path, weight, pts, blocked: blockAt >= 0, exitDir });
  }
  rays.sort((a, b) => b.weight - a.weight);
  return { rays, ys, detY, slope };
}

/** Unit transverse direction of an analyser, falling back to ẑ for a parallel axis. */
function axisVectorDir(axis: Vec3): Vec3 {
  // The beam travels along +ŷ; only the component of n̂ perpendicular to ŷ is
  // visible as a split, but the *state* still measures the full n̂.
  const perp = v3(axis[0], 0, axis[2]);
  return vNormalize(perp, axis[1] < 0 ? v3(0, 0, -1) : v3(0, 0, 1));
}

/* ------------------------------------------------------------------ */
/* Bench drawing                                                       */
/* ------------------------------------------------------------------ */

function mono(ctx: CanvasRenderingContext2D, size = 9.5): void {
  ctx.font = `600 ${size}px "JetBrains Mono", ui-monospace, monospace`;
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  color: string,
  align: CanvasTextAlign = 'left',
  size = 9.5,
): void {
  mono(ctx, size);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

function quad(ctx: CanvasRenderingContext2D, pr: Proj, pts: Vec3[], fill: string, stroke: string, lw = 1): void {
  const o: XY = { x: 0, y: 0 };
  ctx.beginPath();
  pts.forEach((p, i) => {
    put(p, pr, o);
    if (i === 0) ctx.moveTo(o.x, o.y);
    else ctx.lineTo(o.x, o.y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** Draw one magnet: two pole faces separated along n̂, joined by a yoke. */
function drawMagnet(
  ctx: CanvasRenderingContext2D,
  pr: Proj,
  m: SGModel,
  i: number,
  g: BenchGeom,
): void {
  const st = m.stages[i];
  const n̂ = st.axis;
  const y = g.ys[i];
  const half = 0.16 + 0.5 * m.magnetGap;
  const side = vNormalize(vCross(n̂, v3(0, 1, 0)), v3(1, 0, 0));
  const face = vNormalize(vCross(n̂, side), v3(1, 0, 0));
  const rA = 0.3 + 0.16 * m.gradient;
  const corner = (sign: number, a: number, b: number): Vec3 =>
    v3(
      n̂[0] * sign * half + side[0] * a + face[0] * b,
      y + n̂[1] * sign * half + side[1] * a + face[1] * b,
      n̂[2] * sign * half + side[2] * a + face[2] * b,
    );

  // yoke bar through the beam
  const o0: XY = { x: 0, y: 0 };
  const o1: XY = { x: 0, y: 0 };
  put(corner(-1, 0, 0), pr, o0);
  put(corner(1, 0, 0), pr, o1);
  ctx.save();
  ctx.strokeStyle = `rgba(${INK},0.22)`;
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(o0.x, o0.y);
  ctx.lineTo(o1.x, o1.y);
  ctx.stroke();
  ctx.restore();

  // pole faces: the sharp (+) pole is drawn smaller, like the real sawtooth tip
  const signs: [number, string][] = [
    [1, UP],
    [-1, DOWN],
  ];
  for (const [sign, rgb] of signs) {
    const rr = sign === 1 ? rA * 0.8 : rA;
    quad(
      ctx,
      pr,
      [corner(sign, rr, rr), corner(sign, -rr, rr), corner(sign, -rr, -rr), corner(sign, rr, -rr)],
      `rgba(${rgb},0.1)`,
      `rgba(${rgb},0.55)`,
      1.2,
    );
    const c: XY = { x: 0, y: 0 };
    put(corner(sign, 0, 0), pr, c);
    text(ctx, sign === 1 ? '+' : '−', c.x, c.y + 3, `rgba(${rgb},0.9)`, 'center', 11);
  }
  const lab: XY = { x: 0, y: 0 };
  put(v3(0, y, 0), pr, lab);
  text(ctx, `SG${i + 1}`, lab.x, lab.y - 6, `rgba(${INK},0.8)`, 'center', 10);
  text(ctx, st.kind === 'custom' ? `az ${st.azDeg.toFixed(0)}° el ${st.elDeg.toFixed(0)}°` : `${st.kind}̂`, lab.x, lab.y + 15, `rgba(${FAINT},0.8)`, 'center', 9);
}

/** Source oven + collimating slit at y ≈ −0.4. */
function drawSource(ctx: CanvasRenderingContext2D, pr: Proj): void {
  const box: Vec3[] = [
    v3(-0.26, -0.75, -0.26),
    v3(0.26, -0.75, -0.26),
    v3(0.26, -0.75, 0.26),
    v3(-0.26, -0.75, 0.26),
  ];
  quad(ctx, pr, box, `rgba(${FAINT},0.12)`, `rgba(${FAINT},0.5)`, 1.2);
  const a: XY = { x: 0, y: 0 };
  const b: XY = { x: 0, y: 0 };
  put(v3(0, -0.75, -0.3), pr, a);
  put(v3(0, -0.75, 0.3), pr, b);
  ctx.strokeStyle = `rgba(${WARN},0.5)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  text(ctx, 'Ag oven', a.x, a.y + 12, `rgba(${FAINT},0.75)`, 'center', 9);
  text(ctx, 'collimator', b.x, b.y - 6, `rgba(${FAINT},0.6)`, 'center', 9);
}

/** Detector plane plus the impact spots sized by analytic weight, numbered by counts. */
function drawDetector(
  ctx: CanvasRenderingContext2D,
  pr: Proj,
  g: BenchGeom,
  rays: BenchRay[],
  counter: Counter,
): void {
  const R = 0.95;
  quad(
    ctx,
    pr,
    [v3(-R, g.detY, -R), v3(R, g.detY, -R), v3(R, g.detY, R), v3(-R, g.detY, R)],
    `rgba(${FAINT},0.06)`,
    `rgba(${FAINT},0.4)`,
    1,
  );
  const o: XY = { x: 0, y: 0 };
  put(v3(-R, g.detY, R), pr, o);
  text(ctx, 'detector', o.x, o.y + 12, `rgba(${FAINT},0.7)`, 'left', 9);

  for (const r of rays) {
    if (r.blocked) continue;
    const end = r.pts[r.pts.length - 1];
    put(end, pr, o);
    const w = Math.max(2.4, Math.min(13, 4 + r.weight * 16));
    ctx.beginPath();
    ctx.arc(o.x, o.y, w, 0, TAU);
    ctx.fillStyle = `rgba(${r.path[r.path.length - 1] === 1 ? UP : DOWN},${(0.18 + 0.5 * r.weight).toFixed(3)})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${r.path[r.path.length - 1] === 1 ? UP : DOWN},0.85)`;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    const c = counter.counts.get(channelKey(r.path));
    text(
      ctx,
      `${portLabel(r.path)} ${r.weight.toFixed(4)}${c === undefined ? '' : `  n=${c}`}`,
      o.x + w + 4,
      o.y + 3,
      `rgba(${INK},0.8)`,
      'left',
      9,
    );
  }
}

/** A travelling packet: dots sliding along each polyline, so flow is visible. */
function drawPackets(
  ctx: CanvasRenderingContext2D,
  pr: Proj,
  rays: BenchRay[],
  live: LiveSpin,
  count: number,
): void {
  const o: XY = { x: 0, y: 0 };
  for (const r of rays) {
    if (r.weight < 0.002) continue;
    const seg: number[] = [];
    let total = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const a = rawOf(r.pts[i - 1]);
      const b = rawOf(r.pts[i]);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      seg.push(L);
      total += L;
    }
    for (let j = 0; j < count; j++) {
      const u = (live.phase + j / count + (r.blocked ? 0 : 0.5 * j)) % 1;
      let d = u * total * (r.blocked ? 0.86 : 1);
      let i = 0;
      while (i < seg.length && d > seg[i]) {
        d -= seg[i];
        i++;
      }
      if (i >= seg.length) continue;
      const a = r.pts[i];
      const b = r.pts[i + 1];
      const f = seg[i] > 1e-6 ? d / seg[i] : 0;
      put(v3(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f), pr, o);
      const rad = 1.2 + Math.min(3.4, r.weight * 5.5);
      ctx.beginPath();
      ctx.arc(o.x, o.y, rad, 0, TAU);
      ctx.fillStyle = `rgba(${INK},${(0.35 + 0.45 * r.weight).toFixed(3)})`;
      ctx.fill();
    }
  }
}

/** Phase wheel: the Larmor spoke drawn in the drift space between two analysers. */
function drawPhaseWheel(
  ctx: CanvasRenderingContext2D,
  pr: Proj,
  y: number,
  turns: number,
  label: string,
): void {
  const R = 0.2;
  const o: XY = { x: 0, y: 0 };
  const a: XY = { x: 0, y: 0 };
  const b: XY = { x: 0, y: 0 };
  put(v3(0, y, 0), pr, o);
  put(v3(R, y, 0), pr, a);
  ctx.beginPath();
  ctx.arc(o.x, o.y, Math.max(6, Math.abs(a.x - o.x)), 0, TAU);
  ctx.strokeStyle = `rgba(${ACCENT},0.32)`;
  ctx.lineWidth = 1;
  ctx.stroke();
  const ang = TAU * turns;
  put(v3(Math.cos(ang) * R, y, Math.sin(ang) * R), pr, b);
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = `rgba(${ACCENT},0.9)`;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  text(ctx, label, o.x, o.y - Math.max(8, Math.abs(a.x - o.x)) - 4, `rgba(${ACCENT},0.8)`, 'center', 8.5);
}

/**
 * The bench viewport: source → up to three rotated magnets → detector, with beam
 * thickness = |P±χ|², cut-off stubs for blocked ports and live packet flow.
 */
export function drawBench(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  m: SGModel,
  g: BenchGeom,
  live: LiveSpin,
  counter: Counter,
): void {
  const pts: Vec3[] = [v3(0, -0.8, 0), v3(0, g.detY, 0), v3(-1, g.detY, 1), v3(1, g.detY, -1)];
  for (const r of g.rays) for (const p of r.pts) pts.push(p);
  const pr = fitProj(pts, 6, 18, w - 12, h - 26, 22);

  // optical bench grid on the z = 0 plane
  ctx.save();
  ctx.strokeStyle = `rgba(${FAINT},0.1)`;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 6; i++) {
    const y = -0.8 + (i * (g.detY + 0.8)) / 6;
    const a: XY = { x: 0, y: 0 };
    const b: XY = { x: 0, y: 0 };
    put(v3(-1.05, y, 0), pr, a);
    put(v3(1.05, y, 0), pr, b);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();

  drawSource(ctx, pr);
  for (let i = 0; i < m.stages.length; i++) drawMagnet(ctx, pr, m, i, g);

  // beam axis
  const o: XY = { x: 0, y: 0 };
  const e: XY = { x: 0, y: 0 };
  put(v3(0, -0.4, 0), pr, o);
  put(v3(0, g.detY, 0), pr, e);
  ctx.save();
  ctx.strokeStyle = `rgba(${INK},0.16)`;
  ctx.setLineDash([2, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(e.x, e.y);
  ctx.stroke();
  ctx.restore();

  // rays
  for (const r of g.rays) {
    if (r.weight < 1e-4) continue;
    const sign = r.path[r.path.length - 1] === 1 ? UP : DOWN;
    const lw = 0.7 + Math.min(9, Math.sqrt(r.weight) * 9);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (r.blocked) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = `rgba(${sign},0.34)`;
    } else {
      ctx.strokeStyle = `rgba(${sign},${(0.14 + 0.3 * r.weight).toFixed(3)})`;
      ctx.lineWidth = lw + 3;
      ctx.beginPath();
      r.pts.forEach((p, i) => {
        put(p, pr, o);
        if (i === 0) ctx.moveTo(o.x, o.y);
        else ctx.lineTo(o.x, o.y);
      });
      ctx.stroke();
    }
    ctx.lineWidth = lw;
    ctx.beginPath();
    r.pts.forEach((p, i) => {
      put(p, pr, o);
      if (i === 0) ctx.moveTo(o.x, o.y);
      else ctx.lineTo(o.x, o.y);
    });
    ctx.stroke();
    ctx.restore();

    if (r.blocked) {
      const end = r.pts[r.pts.length - 1];
      put(end, pr, o);
      const side = vNormalize(vCross(r.exitDir, v3(0, 1, 0)), v3(1, 0, 0));
      const c1 = vAdd(vMul(end, 1), vMul(side, 0.16));
      const c2 = vSubLocal(end, side, 0.16);
      const q1: XY = { x: 0, y: 0 };
      const q2: XY = { x: 0, y: 0 };
      put(c1, pr, q1);
      put(c2, pr, q2);
      ctx.strokeStyle = `rgba(${WARN},0.85)`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(q1.x, q1.y);
      ctx.lineTo(q2.x, q2.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(o.x, o.y, 2.6, 0, TAU);
      ctx.fillStyle = `rgba(${WARN},0.75)`;
      ctx.fill();
      text(ctx, `blocked ${r.weight.toFixed(4)}`, o.x + 6, o.y - 6, `rgba(${WARN},0.85)`, 'left', 8.5);
    }
  }

  drawDetector(ctx, pr, g, g.rays, counter);
  if (m.showTrajectories) drawPackets(ctx, pr, g.rays, live, 3);

  if (m.larmorMT > 0) {
    const ys = [-0.1, ...g.ys];
    for (let i = 0; i < ys.length - 1; i++) {
      drawPhaseWheel(ctx, pr, (ys[i] + ys[i + 1]) / 2, live.turns, `φ = ${(TAU * live.turns).toFixed(2)} rad`);
    }
  }
}

function vSubLocal(a: Vec3, b: Vec3, s: number): Vec3 {
  return v3(a[0] - b[0] * s, a[1] - b[1] * s, a[2] - b[2] * s);
}

/* ------------------------------------------------------------------ */
/* Per-stage probability bars                                          */
/* ------------------------------------------------------------------ */

/**
 * Exact bookkeeping for each analyser: how much weight arrives, how it splits into
 * the two ports (|P+χ|² / |P−χ|²) and how much actually leaves after the blocks.
 */
export function drawStageBookkeeping(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  m: SGModel,
  open: ChainResult,
  chain: ChainResult,
): void {
  const padL = 46;
  const padR = 10;
  const rowH = (h - 20) / Math.max(1, m.stages.length);
  const bw = w - padL - padR;
  ctx.save();
  ctx.strokeStyle = `rgba(${FAINT},0.14)`;
  ctx.lineWidth = 1;
  ctx.strokeRect(padL - 0.5, 9.5, bw + 1, h - 20 + 1);
  ctx.restore();

  m.stages.forEach((st, i) => {
    const cs = chain.stages[i];
    const os = open.stages[i];
    const cy = 12 + rowH * (i + 0.5);
    const inc = os ? os.incident : 0;
    const up = os ? os.up : 0;
    const dn = os ? os.down : 0;
    const out = cs ? cs.transmitted : 0;
    const barH = Math.min(15, rowH - 9);
    const x = (v: number) => padL + Math.max(0, Math.min(1, v)) * bw;

    ctx.fillStyle = `rgba(${FAINT},0.1)`;
    ctx.fillRect(padL, cy - barH / 2, bw, barH);
    ctx.fillStyle = `rgba(${UP},0.65)`;
    ctx.fillRect(padL, cy - barH / 2, x(up) - padL, barH);
    ctx.fillStyle = `rgba(${DOWN},0.6)`;
    ctx.fillRect(x(up), cy - barH / 2, x(up + dn) - x(up), barH);
    if (st.blockUp || st.blockDown) {
      ctx.fillStyle = `rgba(${WARN},0.22)`;
      const cut = (st.blockUp ? up : 0) + (st.blockDown ? dn : 0);
      ctx.fillRect(padL, cy - barH / 2, x(cut) - padL, barH);
    }
    ctx.strokeStyle = `rgba(${INK},0.55)`;
    ctx.lineWidth = 1;
    ctx.strokeRect(padL, cy - barH / 2, x(out) - padL, barH);

    text(ctx, `SG${i + 1}`, 6, cy + 3, `rgba(${INK},0.85)`, 'left', 9.5);
    text(
      ctx,
      `+${up.toFixed(4)}  −${dn.toFixed(4)}  → ${out.toFixed(4)}${inc > 0 && Math.abs(inc - 1) > 1e-6 ? `  (in ${inc.toFixed(3)})` : ''}`,
      padL + 4,
      cy - barH / 2 - 2.5,
      `rgba(${FAINT},0.85)`,
      'left',
      8.5,
    );
  });
}

/** Small legend for the beam colours and the spinor currently in flight. */
export function drawBenchLegend(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  m: SGModel,
  live: LiveSpin,
): void {
  text(ctx, 'σ·n̂ = + beam', 6, h - 6, `rgba(${UP},0.9)`, 'left', 9);
  text(ctx, '− beam', 6 + 62, h - 6, `rgba(${DOWN},0.9)`, 'left', 9);
  text(
    ctx,
    `in flight: ⟨σ⃗⟩ = (${live.bloch[0].toFixed(3)}, ${live.bloch[1].toFixed(3)}, ${live.bloch[2].toFixed(3)})`,
    6 + 118,
    h - 6,
    `rgba(${INK},0.75)`,
    'left',
    9,
  );
  text(
    ctx,
    m.larmorMT > 0
      ? `γ_e·B·t_flight = ${(m.trueAngleRad / TAU).toFixed(1)} turns, ×${m.slowMotion.toExponential(1)} slow`
      : 'no guide field — the state is static between analysers',
    w - 6,
    h - 6,
    `rgba(${ACCENT},0.8)`,
    'right',
    9,
  );
}
