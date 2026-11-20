import { Suspense } from 'react';
import Link from 'next/link';
import { SIM_LIST } from '@/simulations/registry';
import { CONCEPTS } from '@/content/concepts';
import { HomeStage } from '@/components/library/HomeStage';
import { SimulationGrid } from '@/components/library/SimulationGrid';

/**
 * Homepage — the PRD's three tiers, in order:
 *   1. the live Stage Container above the fold (client, dynamically chunked),
 *   2. the ten-simulation library grid grouped by track,
 *   3. the "why this works" learning section that feeds /learn.
 *
 * Only tier 1 and the grid's hover prefetch are client code; the prose and the
 * shell are server-rendered so the first HTML payload stays small.
 */

const REASONS: { title: string; body: string }[] = [
  {
    title: 'Exact solutions, not canned animation',
    body: 'The hydrogen tab evaluates the analytical hydrogenic wavefunctions — associated Laguerre radial parts and normalised spherical harmonics — for whichever n, ℓ and m you pick, up to n = 7. Node counts, ⟨r⟩ expectation values and transition wavelengths are derived from the same functions that draw the cloud, so the picture and the numbers cannot drift apart.',
  },
  {
    title: 'The solver runs where you are',
    body: 'Time-dependent problems are integrated with unitary schemes: Crank–Nicolson for the 1D Schrödinger equation in a Web Worker, split-step Fourier for tunneling, RK4 on floating-point framebuffers for the 2D interferometer. Nothing is precomputed on a server and streamed back, which is why dragging a slider re-solves the physics at sixty frames per second instead of buffering.',
  },
  {
    title: 'The URL is the save file',
    body: 'Quantum numbers, complex phasors rounded to three decimals, render mode and even camera orientation serialise into query parameters. Copy a link mid-lecture, hand it to a classmate, and they reopen the identical state — same superposition, same barrier, same frame. There is no account, no database and no server-side session behind it.',
  },
  {
    title: 'Guided tours that step aside',
    body: 'Each simulation ships keyframed auto-demos that tween parameters and camera while subtitling what is happening. Touch any control and the director yields immediately, with a resume pill — the difference between a video you watch and a bench you work on.',
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col gap-14 pb-4 pt-6 sm:gap-20 sm:pt-8">
      {/* ── Tier 1: the live stage ─────────────────────────────────────── */}
      <section aria-labelledby="hero-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-plasma">
              Live in your browser · zero backend
            </p>
            <h1
              id="hero-title"
              className="mt-1.5 text-[22px] font-semibold leading-tight tracking-tight text-ink sm:text-[26px]"
            >
              Quantum mechanics you can drag, measure and break
            </h1>
          </div>
          <p className="max-w-[46ch] text-[12.5px] leading-relaxed text-ink-dim">
            Orbitalis 3D is running below. Switch simulations from the chrome bar, open the
            inspector to change the state, or share a permalink that restores this exact
            wavefunction for someone else.
          </p>
        </div>

        <Suspense fallback={<StageFallback />}>
          <HomeStage />
        </Suspense>
      </section>

      {/* ── Tier 2: the library grid ───────────────────────────────────── */}
      <section id="simulations" aria-labelledby="library-title" className="scroll-mt-24">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="library-title" className="text-[19px] font-semibold tracking-tight text-ink">
            The library — {SIM_LIST.length} simulations
          </h2>
          <p className="text-[12px] text-ink-faint">
            Grouped into three tracks, from first-year intuition to research-level solvers.
          </p>
        </div>
        <SimulationGrid sims={SIM_LIST} />
      </section>

      {/* ── Tier 3: why it works, and where to read more ──────────────── */}
      <section id="concepts" aria-labelledby="why-title" className="scroll-mt-24">
        <h2 id="why-title" className="text-[19px] font-semibold tracking-tight text-ink">
          Why this works
        </h2>
        <div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {REASONS.map((reason) => (
            <article key={reason.title}>
              <h3 className="text-[13.5px] font-semibold text-ink">{reason.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">{reason.body}</p>
            </article>
          ))}
        </div>

        <div className="glass mt-10 rounded-[var(--radius-stage)] p-5 sm:p-6">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-faint">
            Concept library
          </h3>
          <p className="mt-2 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-dim">
            Six short reads that connect what the stage shows to the algebra behind it, each one
            ending with the simulations where the idea can be tested directly.
          </p>
          <ul className="mt-4 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {CONCEPTS.map((concept) => (
              <li key={concept.slug}>
                <Link
                  href={`/learn/${concept.slug}`}
                  className="group flex flex-col rounded-xl border border-hairline bg-obsidian-2/50 px-3.5 py-3 transition-colors hover:border-hairline-bright hover:bg-obsidian-2"
                >
                  <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-plasma">
                    {concept.eyebrow}
                  </span>
                  <span className="mt-1 text-[13px] font-medium leading-snug text-ink">
                    {concept.title}
                  </span>
                  <span className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                    {concept.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[12px]">
            <Link
              href="/learn"
              className="rounded-lg px-1 py-0.5 font-medium text-plasma hover:text-ink"
            >
              Browse the full concept library →
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

/** Matches the container's own chrome-bar height so nothing shifts on mount. */
function StageFallback() {
  return (
    <div className="stage-frame mx-auto flex h-[62vh] min-h-[420px] w-full max-w-[1440px] flex-col md:h-[78vh]">
      <div className="h-12 shrink-0 border-b border-hairline bg-obsidian-2/80" />
      <div className="flex flex-1 items-center justify-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-transparent border-t-plasma" />
        <span className="text-[12px] text-ink-dim">Booting the simulation stage…</span>
      </div>
    </div>
  );
}
