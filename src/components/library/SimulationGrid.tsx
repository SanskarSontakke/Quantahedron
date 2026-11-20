'use client';

/**
 * Tier 2 — the simulation library grid.
 *
 * Client only because of the hover prefetch: warming a chunk on pointer-enter
 * is what makes the /sim route and the in-place quick-switch feel instant while
 * the first visit still downloads nothing but the flagship (PRD §5.3). The
 * markup itself is a plain list of links, so it is fully server-rendered on the
 * homepage and stays crawlable.
 */

import Link from 'next/link';
import { TRACKS } from '@/simulations/registry';
import type { SimMeta } from '@/simulations/types';
import { prefetchSim } from '@/hooks/useSimModule';
import { cx } from '@/components/ui/controls';

const DIFFICULTY_TONE: Record<SimMeta['difficulty'], string> = {
  Foundations: 'text-quantum border-quantum/40',
  Undergraduate: 'text-flux border-flux/40',
  // `border-collapse/40` would collide with Tailwind's table-layout utility, so
  // the Advanced badge keeps the neutral hairline and only tints the label.
  Advanced: 'text-collapse border-hairline-bright',
};

export function SimulationGrid({ sims }: { sims: SimMeta[] }) {
  return (
    <div className="grid gap-10">
      {TRACKS.map((track) => {
        const members = sims.filter((sim) => sim.track === track);
        if (!members.length) return null;
        return (
          <section key={track} aria-labelledby={`track-${slugify(track)}`}>
            <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-hairline pb-2">
              <h3
                id={`track-${slugify(track)}`}
                className="text-[15px] font-semibold tracking-tight text-ink"
              >
                {track}
              </h3>
              <span className="font-mono text-[11px] text-ink-faint">
                {members.length} {members.length === 1 ? 'simulation' : 'simulations'}
              </span>
            </div>

            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {members.map((sim) => (
                <li key={sim.slug}>
                  <Link
                    href={sim.route}
                    onMouseEnter={() => prefetchSim(sim.slug)}
                    onFocus={() => prefetchSim(sim.slug)}
                    className="glass group relative flex h-full flex-col gap-2.5 overflow-hidden rounded-[var(--radius-stage)] p-4 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-hairline-bright"
                    style={{
                      backgroundImage: `radial-gradient(120% 90% at 0% 0%, ${sim.accent}22, transparent 60%)`,
                    }}
                    aria-label={`Open ${sim.name}: ${sim.tagline}`}
                  >
                    <span
                      className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-60"
                      style={{ background: `linear-gradient(90deg, transparent, ${sim.accent}, transparent)` }}
                      aria-hidden
                    />
                    <span className="flex items-start justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <span
                          className="mt-0.5 h-2 w-2 shrink-0 rounded-full"
                          style={{ background: sim.accent, boxShadow: `0 0 12px ${sim.accent}` }}
                          aria-hidden
                        />
                        <span className="text-[14px] font-semibold leading-tight text-ink">
                          {sim.name}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                        {String(sim.order).padStart(2, '0')}
                      </span>
                    </span>

                    <span className="text-[12.5px] leading-snug text-ink-dim">{sim.tagline}</span>
                    <span className="text-[11.5px] leading-relaxed text-ink-faint">
                      {sim.description}
                    </span>

                    <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                      <span
                        className={cx(
                          'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                          DIFFICULTY_TONE[sim.difficulty],
                        )}
                      >
                        {sim.difficulty}
                      </span>
                      <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] text-ink-dim">
                        {sim.engine}
                      </span>
                      <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] text-ink-dim">
                        ~{sim.exploreMinutes} min
                      </span>
                      {sim.gpu ? (
                        <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[10px] text-ink-faint">
                          WebGL2
                        </span>
                      ) : null}
                    </span>

                    <span className="flex flex-wrap gap-1.5">
                      {sim.tags.map((tag) => (
                        <span key={tag} className="text-[10px] text-ink-faint">
                          #{tag}
                        </span>
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
