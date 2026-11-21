import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CONCEPTS, CONCEPT_SLUGS, getConcept } from '@/content/concepts';
import { getMeta } from '@/simulations/registry';
import { MathText, Tex } from '@/lib/math';

/**
 * Concept deep-dive route. Server component: the prose is static, and `MathText`
 * / `Tex` are the only client islands (KaTeX renders on the server too, so the
 * equations are in the prerendered HTML with no layout shift).
 */

export function generateStaticParams(): { topic: string }[] {
  return CONCEPT_SLUGS.map((topic) => ({ topic }));
}

// Same reason as the simulation route: unlisted topics must 404, not soft-200.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topic: string }>;
}): Promise<Metadata> {
  const { topic } = await params;
  const concept = getConcept(topic);
  if (!concept) return { title: 'Unknown concept' };
  return {
    title: concept.title,
    description: concept.summary,
    keywords: [concept.eyebrow, ...concept.relatedSlugs],
    openGraph: {
      type: 'article',
      title: `${concept.title} · Quantahedron`,
      description: concept.summary,
      url: `/learn/${concept.slug}`,
    },
  };
}

export default async function LearnTopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  const concept = getConcept(topic);
  if (!concept) notFound();
  const index = CONCEPTS.findIndex((item) => item.slug === concept.slug);
  const next = index >= 0 ? CONCEPTS[index + 1] : undefined;

  return (
    <article className="mx-auto flex w-full max-w-[860px] flex-col gap-9 pb-8 pt-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href="/learn"
            className="rounded-lg text-[11.5px] text-ink-faint transition-colors hover:text-ink"
          >
            ← Concept library
          </Link>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-plasma">
            {concept.eyebrow}
          </span>
        </div>
        <h1 className="text-[25px] font-semibold leading-tight tracking-tight text-ink sm:text-[30px]">
          {concept.title}
        </h1>
        <p className="text-[14px] leading-relaxed text-ink-dim">
          <MathText text={concept.summary} />
        </p>
      </header>

      {concept.math?.length ? (
        <section
          aria-label="Key equations"
          className="glass rounded-[var(--radius-stage)] px-5 py-4"
        >
          {concept.math.map((tex) => (
            <Tex key={tex} tex={tex} display className="text-[15px]" />
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-7">
        {concept.sections.map((section) => (
          <div key={section.h2} className="flex flex-col gap-2">
            <h2 className="text-[16px] font-semibold tracking-tight text-ink">{section.h2}</h2>
            <p className="text-[14px] leading-[1.75] text-ink-dim">
              <MathText text={section.body} />
            </p>
          </div>
        ))}
      </section>

      <section aria-labelledby="try-title" className="border-t border-hairline pt-6">
        <h2 id="try-title" className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
          Test it in the simulations
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2.5">
          {concept.relatedSlugs.map((slug) => {
            const sim = getMeta(slug);
            if (!sim) return null;
            return (
              <li key={slug}>
                <Link
                  href={sim.route}
                  className="glass flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px] text-ink-dim transition-colors hover:text-ink"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: sim.accent, boxShadow: `0 0 10px ${sim.accent}` }}
                    aria-hidden
                  />
                  {sim.name}
                  <span className="text-ink-faint">{sim.difficulty}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <nav
        aria-label="More concepts"
        className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-6 text-[12.5px]"
      >
        <Link href="/learn" className="rounded-lg text-ink-faint transition-colors hover:text-ink">
          All concepts
        </Link>
        {next ? (
          <Link
            href={`/learn/${next.slug}`}
            className="rounded-lg text-plasma transition-colors hover:text-ink"
          >
            Next: {next.title} →
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
