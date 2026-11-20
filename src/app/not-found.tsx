import Link from 'next/link';
import { SIM_LIST } from '@/simulations/registry';
import { CONCEPTS } from '@/content/concepts';

export default function NotFound() {
  return (
    <div className="flex flex-col gap-6 py-20">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-solar">404</p>
      <h1 className="text-[26px] font-semibold tracking-tight text-ink">
        This state does not exist
      </h1>
      <p className="max-w-[62ch] text-[13px] leading-relaxed text-ink-dim">
        The page you asked for is outside the app router tree. Everything on Quantahedron lives in
        two places: the simulation stage and the concept library.
      </p>
      <div className="flex flex-wrap gap-2.5">
        <Link
          href="/"
          className="glass rounded-full px-4 py-2 text-[12.5px] text-ink transition-colors hover:border-hairline-bright"
        >
          Go to the live stage
        </Link>
        <Link
          href="/learn"
          className="glass rounded-full px-4 py-2 text-[12.5px] text-ink-dim transition-colors hover:text-ink"
        >
          Browse concepts
        </Link>
      </div>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
            Simulations
          </h2>
          <ul className="mt-2 grid gap-1">
            {SIM_LIST.slice(0, 5).map((sim) => (
              <li key={sim.slug}>
                <Link
                  href={sim.route}
                  className="text-[12.5px] text-ink-dim transition-colors hover:text-ink"
                >
                  {sim.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
            Concepts
          </h2>
          <ul className="mt-2 grid gap-1">
            {CONCEPTS.slice(0, 5).map((concept) => (
              <li key={concept.slug}>
                <Link
                  href={`/learn/${concept.slug}`}
                  className="text-[12.5px] text-ink-dim transition-colors hover:text-ink"
                >
                  {concept.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
