import type { Metadata } from 'next';
import Link from 'next/link';
import { CONCEPTS } from '@/content/concepts';
import { getMeta } from '@/simulations/registry';

export const metadata: Metadata = {
  title: 'Concept Library',
  description:
    'Six short reads on wavefunction phase, quantum numbers, superposition beats, tunneling, measurement and spin — each tied to the simulations that let you test it.',
  openGraph: {
    title: 'Concept Library · Quantahedron',
    description:
      'The physics behind the simulations, written for undergraduates and linked to the sandbox where each idea can be tested.',
    url: '/learn',
  },
};

export default function LearnPage() {
  return (
    <div className="flex flex-col gap-10 pb-6 pt-8">
      <header className="flex flex-col gap-3">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-plasma">
          Learn · concept library
        </p>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">
          Six ideas that make the simulations make sense
        </h1>
        <p className="max-w-[76ch] text-[13px] leading-relaxed text-ink-dim">
          Each entry is a short read: the argument in prose, the equations in display form, and the
          simulations where the claim can be checked by dragging a slider rather than trusting a
          diagram. Notation is atomic units (ℏ = mₑ = e = 4πε₀ = 1) with SI and eV values quoted
          wherever a number matters.
        </p>
      </header>

      <ul className="grid gap-5 lg:grid-cols-2">
        {CONCEPTS.map((concept, index) => (
          <li key={concept.slug}>
            <Link
              href={`/learn/${concept.slug}`}
              className="glass flex h-full flex-col gap-2 rounded-[var(--radius-stage)] p-5 transition-colors hover:border-hairline-bright"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-plasma">
                  {concept.eyebrow}
                </span>
                <span className="font-mono text-[10px] text-ink-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </span>
              <h2 className="text-[15.5px] font-semibold leading-snug text-ink">{concept.title}</h2>
              <p className="text-[12.5px] leading-relaxed text-ink-dim">{concept.summary}</p>
              <span className="mt-auto flex flex-wrap gap-1.5 pt-2">
                {concept.relatedSlugs.map((slug) => {
                  const sim = getMeta(slug);
                  if (!sim) return null;
                  return (
                    <span
                      key={slug}
                      className="flex items-center gap-1.5 rounded-full border border-hairline bg-obsidian/60 px-2 py-0.5 text-[10.5px] text-ink-faint"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: sim.accent }}
                        aria-hidden
                      />
                      {sim.name}
                    </span>
                  );
                })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
