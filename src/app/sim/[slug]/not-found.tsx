import Link from 'next/link';
import { SIM_LIST } from '@/simulations/registry';

/** Segment-level 404 for an unknown `/sim/<slug>`, with the catalogue as the way out. */
export default function SimNotFound() {
  return (
    <div className="flex flex-col gap-6 py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-solar">404 · no such simulation</p>
      <h1 className="text-[24px] font-semibold tracking-tight text-ink">
        That simulation is not in the registry
      </h1>
      <p className="max-w-[64ch] text-[13px] leading-relaxed text-ink-dim">
        Simulation routes come from <span className="font-mono text-ink">src/simulations/registry.ts</span>,
        so a typo in the slug has nothing to render. Pick one of the ten below instead.
      </p>
      <ul className="flex flex-wrap gap-2">
        {SIM_LIST.map((sim) => (
          <li key={sim.slug}>
            <Link
              href={sim.route}
              className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] text-ink-dim transition-colors hover:text-ink"
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: sim.accent }}
                aria-hidden
              />
              {sim.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
