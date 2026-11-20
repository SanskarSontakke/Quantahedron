'use client';

/**
 * Interactive complex-amplitude grid — the modern successor to Falstad's bottom
 * state table. Each cell is a glowing phasor dial: drag *outward* to raise |cᵢ|,
 * drag *around* the centre to set arg(cᵢ). Normalise / Clear / Random act on the
 * whole superposition at once.
 *
 * It is deliberately generic: any simulation whose state is a set of parallel
 * amplitude arrays (Orbitalis 3D's |n ℓ m⟩, the harmonic oscillator's |n⟩) can
 * mount it by naming its keys.
 */

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { pArr, useSimStore } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';

export interface PhasorBasisCell {
  n: number;
  l: number;
  m: number;
  label: string;
}

export interface PhasorMatrixProps {
  slug: SimSlug;
  /** Parallel-array param keys holding the superposition. */
  nKey: string;
  lKey: string;
  mKey: string;
  ampKey: string;
  phaseKey: string;
  /** Which |basis⟩ cells the grid offers. */
  cells: PhasorBasisCell[];
  maxSlots?: number;
  title?: string;
  className?: string;
  /** Fires whenever the learner edits a dial (used to interrupt auto-demos). */
  onInteract?: () => void;
}

interface CellState {
  n: number;
  l: number;
  m: number;
  amp: number;
  phase: number;
  index: number;
}

export const PhasorMatrix = memo(function PhasorMatrix({
  slug,
  nKey,
  lKey,
  mKey,
  ampKey,
  phaseKey,
  cells,
  maxSlots = 8,
  title = 'Superposition',
  className,
  onInteract,
}: PhasorMatrixProps) {
  const params = useSimStore((s) => s.params[slug]);
  const setParams = useSimStore((s) => s.setParams);
  const [dragging, setDragging] = useState<number | null>(null);
  const svgRefs = useRef(new Map<number, SVGSVGElement>());

  const ns = pArr(params, nKey);
  const ls = pArr(params, lKey);
  const ms = pArr(params, mKey);
  const amps = pArr(params, ampKey);
  const phases = pArr(params, phaseKey);

  const occupied = useMemo(() => {
    const map = new Map<string, CellState>();
    for (let i = 0; i < amps.length; i++) {
      map.set(`${ns[i]}|${ls[i]}|${ms[i]}`, {
        n: ns[i] ?? 1,
        l: ls[i] ?? 0,
        m: ms[i] ?? 0,
        amp: amps[i] ?? 0,
        phase: phases[i] ?? 0,
        index: i,
      });
    }
    return map;
  }, [ns, ls, ms, amps, phases]);

  const total = useMemo(() => amps.reduce((s, a) => s + a * a, 0), [amps]);

  const write = useCallback(
    (next: { n: number[]; l: number[]; m: number[]; amp: number[]; phase: number[] }) => {
      setParams(slug, {
        [nKey]: next.n,
        [lKey]: next.l,
        [mKey]: next.m,
        [ampKey]: next.amp.map((v) => Math.round(v * 1000) / 1000),
        [phaseKey]: next.phase.map((v) => Math.round(v * 1000) / 1000),
      });
      onInteract?.();
    },
    [slug, nKey, lKey, mKey, ampKey, phaseKey, setParams, onInteract],
  );

  const snapshot = useCallback(() => {
    const list = cells.map((c) => {
      const hit = occupied.get(`${c.n}|${c.l}|${c.m}`);
      return {
        n: c.n,
        l: c.l,
        m: c.m,
        amp: hit?.amp ?? 0,
        phase: hit?.phase ?? 0,
      };
    });
    return list;
  }, [cells, occupied]);

  const setCell = useCallback(
    (cell: PhasorBasisCell, amp: number, phase: number) => {
      const list = snapshot();
      const idx = list.findIndex((s) => s.n === cell.n && s.l === cell.l && s.m === cell.m);
      if (idx < 0) return;
      if (amp < 0.02) list.splice(idx, 1);
      else list[idx] = { ...list[idx], amp: Math.min(1.6, amp), phase };
      const trimmed = list.slice(0, maxSlots);
      write({
        n: trimmed.map((s) => s.n),
        l: trimmed.map((s) => s.l),
        m: trimmed.map((s) => s.m),
        amp: trimmed.map((s) => s.amp),
        phase: trimmed.map((s) => s.phase),
      });
    },
    [snapshot, write, maxSlots],
  );

  const handlePointer = useCallback(
    (cell: PhasorBasisCell, ev: React.PointerEvent<SVGSVGElement>) => {
      const svg = svgRefs.current.get(cell.n * 1000 + cell.l * 100 + cell.m + 500);
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = ev.clientX - (rect.left + rect.width / 2);
      const dy = ev.clientY - (rect.top + rect.height / 2);
      const r = Math.hypot(dx, dy);
      const amp = Math.min(1.6, r / (rect.width * 0.42));
      const phase = Math.atan2(-dy, dx);
      setCell(cell, amp, phase);
    },
    [setCell],
  );

  const normalize = () => {
    const list = snapshot().filter((s) => s.amp > 0.02);
    const norm = Math.sqrt(list.reduce((s, a) => s + a.amp * a.amp, 0));
    if (norm < 1e-6) return;
    const scaled = list.map((s) => ({ ...s, amp: s.amp / norm }));
    write({
      n: scaled.map((s) => s.n),
      l: scaled.map((s) => s.l),
      m: scaled.map((s) => s.m),
      amp: scaled.map((s) => s.amp),
      phase: scaled.map((s) => s.phase),
    });
  };

  const clear = () =>
    write({ n: [], l: [], m: [], amp: [], phase: [] });

  const random = () => {
    const live = cells.slice(0, Math.min(cells.length, 24));
    const picks: CellState[] = [];
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const c = live[Math.floor(Math.random() * live.length)];
      if (picks.some((p) => p.n === c.n && p.l === c.l && p.m === c.m)) continue;
      picks.push({ n: c.n, l: c.l, m: c.m, amp: 0.3 + Math.random() * 0.7, phase: Math.random() * Math.PI * 2, index: i });
    }
    const norm = Math.sqrt(picks.reduce((s, a) => s + a.amp * a.amp, 0)) || 1;
    write({
      n: picks.map((s) => s.n),
      l: picks.map((s) => s.l),
      m: picks.map((s) => s.m),
      amp: picks.map((s) => s.amp / norm),
      phase: picks.map((s) => s.phase),
    });
  };

  return (
    <div className={className}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-faint">{title}</span>
        <span className="font-mono text-[10px] text-ink-faint" data-telemetry>
          Σ|c|² = {total.toFixed(3)}
        </span>
        <div className="ml-auto flex gap-1">
          <button
            type="button"
            onClick={normalize}
            className="rounded-md border border-hairline px-1.5 py-0.5 text-[10px] text-ink-dim hover:border-plasma/40 hover:text-plasma"
          >
            Normalize
          </button>
          <button
            type="button"
            onClick={random}
            className="rounded-md border border-hairline px-1.5 py-0.5 text-[10px] text-ink-dim hover:border-flux/40 hover:text-flux"
          >
            Random
          </button>
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-hairline px-1.5 py-0.5 text-[10px] text-ink-dim hover:border-collapse/40 hover:text-collapse"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {cells.map((cell) => {
          const st = occupied.get(`${cell.n}|${cell.l}|${cell.m}`);
          const amp = st?.amp ?? 0;
          const phase = st?.phase ?? 0;
          const key = cell.n * 1000 + cell.l * 100 + cell.m + 500;
          const active = amp > 0.02;
          const size = 46;
          const cx0 = size / 2;
          const rMax = size / 2 - 5;
          const tipX = cx0 + Math.cos(phase) * rMax * Math.min(1, amp);
          const tipY = cx0 - Math.sin(phase) * rMax * Math.min(1, amp);
          const hue = ((phase * 180) / Math.PI + 360) % 360;
          return (
            <svg
              key={key}
              width={size}
              height={size + 12}
              viewBox={`0 0 ${size} ${size + 12}`}
              ref={(el) => {
                if (el) svgRefs.current.set(key, el);
              }}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setDragging(key);
                handlePointer(cell, e);
              }}
              onPointerMove={(e) => {
                if (dragging === key) handlePointer(cell, e);
              }}
              onPointerUp={() => setDragging(null)}
              onPointerCancel={() => setDragging(null)}
              className={active ? 'cursor-grab touch-none' : 'cursor-pointer touch-none'}
              role="slider"
              tabIndex={0}
              aria-label={`${cell.label} amplitude ${amp.toFixed(2)} phase ${phase.toFixed(2)}`}
              aria-valuenow={Math.round(amp * 100)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp') setCell(cell, Math.min(1.5, amp + 0.08), phase);
                if (e.key === 'ArrowDown') setCell(cell, Math.max(0, amp - 0.08), phase);
                if (e.key === 'ArrowLeft') setCell(cell, amp || 0.5, phase + Math.PI / 12);
                if (e.key === 'ArrowRight') setCell(cell, amp || 0.5, phase - Math.PI / 12);
              }}
            >
              <circle
                cx={cx0}
                cy={cx0}
                r={rMax}
                fill={active ? `hsla(${hue}, 80%, 60%, 0.12)` : 'rgba(148,163,184,0.05)'}
                stroke={active ? `hsla(${hue}, 85%, 68%, 0.9)` : 'rgba(148,163,184,0.22)'}
                strokeWidth={active ? 1.4 : 1}
              />
              <circle cx={cx0} cy={cx0} r={rMax * 0.5} fill="none" stroke="rgba(148,163,184,0.14)" />
              {active ? (
                <>
                  <line
                    x1={cx0}
                    y1={cx0}
                    x2={tipX}
                    y2={tipY}
                    stroke={`hsl(${hue}, 90%, 72%)`}
                    strokeWidth={1.8}
                    strokeLinecap="round"
                  />
                  <circle cx={tipX} cy={tipY} r={2.6} fill={`hsl(${hue}, 95%, 76%)`} />
                </>
              ) : (
                <circle cx={cx0} cy={cx0} r={1.6} fill="rgba(148,163,184,0.4)" />
              )}
              <text
                x={cx0}
                y={size + 8}
                textAnchor="middle"
                className="fill-ink-faint font-mono"
                style={{ fontSize: 8.5 }}
              >
                {cell.label}
              </text>
            </svg>
          );
        })}
      </div>
    </div>
  );
});
