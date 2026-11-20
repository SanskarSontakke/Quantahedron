'use client';

/**
 * Quantum Telemetry Pill (§3.3, top-left). Normalized Dirac ket, ⟨E⟩, |L|, L_z —
 * whatever the active simulation declares — refreshed from the live store slice.
 */

import { memo } from 'react';
import { useSimStore } from '@/store/useSimStore';
import type { SimModule, SimSlug } from '@/simulations/types';

const TONE: Record<string, string> = {
  default: 'text-ink',
  good: 'text-quantum',
  warn: 'text-solar',
  accent: 'text-plasma',
};

export const TelemetryPill = memo(function TelemetryPill({
  slug,
  module,
}: {
  slug: SimSlug;
  module: SimModule;
}) {
  const params = useSimStore((s) => s.params[slug]);
  const items = module.telemetry?.(params) ?? [];
  if (items.length === 0) return null;

  return (
    <div
      className="glass pointer-events-none absolute left-3 top-3 z-20 max-w-[min(92%,560px)] rounded-xl px-3 py-2"
      data-telemetry
    >
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        {items.map((it, i) => (
          <div key={i} className="leading-none">
            <span className="mr-1 text-[9.5px] uppercase tracking-wide text-ink-faint">
              {it.label}
            </span>
            <span className={`font-mono text-[12px] ${TONE[it.tone ?? 'default']}`}>{it.value}</span>
            {it.hint ? <span className="ml-1 text-[9.5px] text-ink-faint">{it.hint}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
});
