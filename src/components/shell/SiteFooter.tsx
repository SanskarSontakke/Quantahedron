/**
 * Site footer: the one claim that must stay true — everything the learner sees
 * is computed in their own browser, so the deployment stays on free-tier static
 * hosting.
 */

import Link from 'next/link';
import { SIM_LIST, TRACKS } from '@/simulations/registry';
import { CONCEPTS } from '@/content/concepts';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-hairline bg-abyss/60">
      <div className="mx-auto grid max-w-[1440px] gap-8 px-4 py-10 sm:grid-cols-3 sm:px-6">
        <div>
          <p className="text-[13px] font-semibold text-ink">Quantahedron</p>
          <p className="mt-2 max-w-[38ch] text-[12px] leading-relaxed text-ink-dim">
            Interactive quantum physics, solved in real time. Every wavefunction, solver and
            renderer runs entirely in your browser — no backend, no accounts, no server compute.
            A shared URL is the only thing that persists.
          </p>
        </div>

        <nav aria-label="Simulations in the footer">
          <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
            {TRACKS.length} tracks · {SIM_LIST.length} simulations
          </h2>
          <ul className="mt-3 grid gap-1.5">
            {SIM_LIST.slice(0, 6).map((sim) => (
              <li key={sim.slug}>
                <Link
                  href={sim.route}
                  className="text-[12px] text-ink-dim transition-colors hover:text-ink"
                >
                  {sim.name}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/#simulations"
                className="text-[12px] text-plasma transition-colors hover:text-ink"
              >
                Full catalogue
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Concepts in the footer">
          <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
            Concept library
          </h2>
          <ul className="mt-3 grid gap-1.5">
            {CONCEPTS.slice(0, 6).map((concept) => (
              <li key={concept.slug}>
                <Link
                  href={`/learn/${concept.slug}`}
                  className="text-[12px] text-ink-dim transition-colors hover:text-ink"
                >
                  {concept.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-5 text-[11px] text-ink-faint sm:px-6">
        <p>Atomic units throughout: ℏ = mₑ = e = 4πε₀ = 1. Solver output is exact, not mocked.</p>
        <p className="font-mono">Built with Next.js App Router · deployable to Vercel</p>
      </div>
    </footer>
  );
}
