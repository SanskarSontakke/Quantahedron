'use client';

/**
 * Studio-Glass UI primitives: the only form vocabulary the whole platform uses,
 * so ten simulations share one control language instead of ten ad-hoc ones.
 */

import { memo, useId, type ReactNode } from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------------------------------- Slider -------------------------------- */

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  log?: boolean;
  format?: (v: number) => string;
  help?: string;
  accent?: string;
  onChange: (v: number) => void;
  /** Called on any interaction so the Demo Director can yield control. */
  onInteract?: () => void;
}

const toLinear = (v: number, min: number, max: number) =>
  Math.log(Math.max(v, 1e-12) - min + 1) / Math.log(max - min + 1);
const fromLinear = (t: number, min: number, max: number) =>
  min + Math.pow(max - min + 1, t) - 1;

export const Slider = memo(function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  log = false,
  format,
  help,
  accent = 'var(--color-plasma)',
  onChange,
  onInteract,
}: SliderProps) {
  const id = useId();
  const shown = format ? format(value) : fmt(value);
  const handle = (raw: number) => {
    onInteract?.();
    onChange(clamp(raw, min, max));
  };
  return (
    <div className="py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[11px] uppercase tracking-wide text-ink-faint">
          {label}
        </label>
        <span className="font-mono text-[11px] text-ink" data-telemetry>
          {shown}
          {unit ? <span className="text-ink-faint"> {unit}</span> : null}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={log ? 0 : min}
        max={log ? 1 : max}
        step={log ? 0.001 : step}
        value={log ? toLinear(value, min, max) : value}
        onChange={(e) => {
          const t = Number(e.target.value);
          handle(log ? fromLinear(t, min, max) : t);
        }}
        onPointerDown={() => onInteract?.()}
        className="q-range mt-1.5 w-full"
        style={{ ['--q-accent' as string]: accent }}
        aria-label={label}
        title={help}
      />
    </div>
  );
});

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return v.toFixed(Math.max(0, digits - Math.floor(Math.log10(a || 1)) - 1) || 2);
}

/* ---------------------------------- Toggle -------------------------------- */

export const Toggle = memo(function Toggle({
  label,
  checked,
  onChange,
  help,
  accent = 'var(--color-plasma)',
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  help?: string;
  accent?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={help}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-1.5 text-left"
    >
      <span className="text-[12px] text-ink-dim">{label}</span>
      <span
        className={cx(
          'relative h-[18px] w-[32px] shrink-0 rounded-full border transition-colors',
          checked ? 'border-transparent' : 'border-hairline-bright bg-obsidian-2',
        )}
        style={checked ? { background: accent } : undefined}
      >
        <span
          className={cx(
            'absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all',
            checked ? 'left-[17px] bg-obsidian' : 'left-[3px] bg-ink-faint',
          )}
        />
      </span>
    </button>
  );
});

/* ---------------------------------- Select -------------------------------- */

export const Segmented = memo(function Segmented({
  label,
  value,
  options,
  onChange,
  columns,
}: {
  label?: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  columns?: number;
}) {
  return (
    <div className="py-1.5">
      {label ? (
        <div className="mb-1 text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      ) : null}
      <div
        className="grid gap-1 rounded-xl border border-hairline bg-obsidian-2/60 p-1"
        style={{ gridTemplateColumns: `repeat(${columns ?? Math.min(options.length, 3)}, minmax(0,1fr))` }}
        role="radiogroup"
        aria-label={label}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded-lg px-1.5 py-1 text-[11px] leading-tight transition-colors',
              value === o.value
                ? 'bg-plasma/15 text-plasma'
                : 'text-ink-faint hover:bg-white/5 hover:text-ink-dim',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
});

/* --------------------------------- Buttons -------------------------------- */

export function PillButton({
  children,
  onClick,
  active,
  title,
  className,
  tone = 'default',
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  className?: string;
  tone?: 'default' | 'accent' | 'warn';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cx(
        'glass inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] transition-colors',
        active
          ? tone === 'warn'
            ? 'text-collapse'
            : 'text-plasma'
          : 'text-ink-dim hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-1 mt-3 flex items-center justify-between first:mt-0">
      <h4 className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
        {children}
      </h4>
      {right}
    </div>
  );
}

/* ------------------------------ Range styling ----------------------------- */

export const rangeCss = `
.q-range { -webkit-appearance: none; appearance: none; height: 18px; background: transparent; cursor: pointer; }
.q-range::-webkit-slider-runnable-track { height: 3px; border-radius: 999px; background: linear-gradient(90deg, var(--q-accent, #5eead4) var(--q-fill, 50%), rgba(148,163,184,0.22) var(--q-fill, 50%)); }
.q-range::-moz-range-track { height: 3px; border-radius: 999px; background: rgba(148,163,184,0.22); }
.q-range::-moz-range-progress { height: 3px; border-radius: 999px; background: var(--q-accent, #5eead4); }
.q-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; margin-top: -5px; border-radius: 999px; background: #0b1220; border: 2px solid var(--q-accent, #5eead4); box-shadow: 0 0 0 3px rgba(94,234,212,0.10); transition: transform .12s ease; }
.q-range:active::-webkit-slider-thumb { transform: scale(1.18); }
.q-range::-moz-range-thumb { width: 12px; height: 12px; border-radius: 999px; background: #0b1220; border: 2px solid var(--q-accent, #5eead4); }
.q-range:focus-visible { outline: none; }
.q-range:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px rgba(94,234,212,0.35); }
`;
