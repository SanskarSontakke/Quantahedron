import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SIM_SLUGS, getMeta, isSimSlug } from '@/simulations/registry';
import type { SimSlug } from '@/simulations/types';
import { SimulationContainer } from '@/components/stage/SimulationContainer';

/**
 * Dedicated simulation route (PRD §5.1). Static over the ten registered slugs,
 * 404 for anything else, and the stage mounts with `variant="route"` so the
 * container fills the page instead of sitting in the homepage flow.
 */

interface SimProse {
  explore: string;
  misconception: string;
}

const SIM_PROSE: Record<SimSlug, SimProse> = {
  'orbitalis-3d': {
    explore:
      'Start in the complex basis on 1s, then step to 2p with m = +1 and switch on the probability-current overlay: the density is rotationally symmetric but the current circulates, which is what a definite L̂_z actually means. Move to the real basis and the circulation disappears without the shape losing its nodal structure. Raise Z from 1 to 4 and the whole cloud contracts as a₀/Z while the binding energy grows as Z², so He⁺ and Li²⁺ are the same picture at a different scale. Finish by clicking a line on the spectroscopy ladder — it prepares the corresponding superposition and lets you watch the dipole beat.',
    misconception:
      'That an orbital is a path. Electrons do not travel along the loop you see; there is no trajectory inside the atom at all. What the surface encloses is a region where |ψ|² is large, and the phase colour encodes a complex angle that never corresponds to a direction of motion. The measurement mode makes this concrete: fire a few thousand single-electron detections and point-cloud structure emerges from positions that were individually unpredictable — the shape is a distribution, not an orbit.',
  },
  'de-broglie-ring': {
    explore:
      'Set the winding number to something non-integer, say 2.7, and watch the wave fail to close on itself: the phase mismatch accumulates around the ring and destructive interference eats the amplitude. Then slide towards 3 and see the pattern lock in the moment 2πr = nλ. Open the Scale Explorer next and walk from a thermal neutron (2.2 km/s, λ = 1.8 Å) through a 100 eV electron microscope beam (λ ≈ 0.12 nm) out to a 0.16 kg cricket ball at 30 m/s, where λ ≈ 10⁻³⁴ m — about twenty orders of magnitude smaller than a proton.',
    misconception:
      'That quantised orbits were an arbitrary rule Bohr invented to fit hydrogen. Here quantisation appears as an ordinary resonance condition: a standing wave closes on itself only for certain wavelengths, and λ = h/p does the rest. The same reasoning explains why nothing in daily life looks wavy — the de Broglie wavelength of a macroscopic object is not small by convention, it is absurdly, unmeasurably small.',
  },
  'tdse-1d': {
    explore:
      'Load the asymmetric double well, drop a Gaussian wavepacket into one side and slow the time scale: the packet tunnels across, refocuses, and comes back, with the norm pinned at 1.000 the whole way because Crank–Nicolson is unitary by construction. Then switch to the brush tool and draw your own V(x) — a box with a step, a triangular well, a crude crystal — and compare the eigenstate bar chart you get against the textbook spacing you expected.',
    misconception:
      'That ψ(x) is a material wave sloshing around like water, so a spread-out packet means the electron is "smeared" into pieces. The plot shows |ψ|², a probability density: a packet split between two wells is not half an electron in each, it is one electron that will be found whole on one side or the other. Norm conservation is the visual proof — the total area stays exactly one while the shape divides.',
  },
  'quantum-tunneling': {
    explore:
      'Set the incident energy to roughly half the barrier height and fire: the transmitted packet is faint but real, and the T(E) curve explains how faint. Sweep energy up through V₀ and watch transmission climb and then overshoot into oscillations. Then switch to the double-barrier configuration and step the well width until sharp unity-transmission peaks march across the plot — the resonances are exactly the half-integer wavelength condition.',
    misconception:
      'That the particle borrows energy from the vacuum to climb over the barrier, briefly violating conservation. Nothing is borrowed: the particle arrives with energy E < V₀ and leaves with the same E. The barrier region simply holds an evanescent solution rather than an oscillatory one, and a finite tail reaching the far side is enough to transmit. Measure the transmission and the energy balance stays exact.',
  },
  'double-slit-2d': {
    explore:
      'Run with the source attenuated so the detector records one electron at a time and leave the film accumulating. The individual dots are random; the band structure they build is not. Then widen the slit separation to compress the fringe spacing, check it against Δy ≈ λL/d, and finally switch on the which-path detector mid-run to watch the fringes dissolve into a two-hump classical pattern.',
    misconception:
      'That the interference comes from electrons pushing on one another, so firing them singly should destroy the pattern. It does not — one electron at a time still builds fringes, because each electron interferes with its own amplitude. What does destroy the pattern is a detector that can tell which slit was used: interference needs amplitudes that are indistinguishable in principle, not merely unseen in practice.',
  },
  'harmonic-oscillator': {
    explore:
      'Stack eigenstates from n = 0 upward and compare each |ψ|² against the classical probability density of a mass on the same spring: near the bottom the quantum curve has its maximum where the classical particle is fastest, and it leaks past the turning points where the classical one can never be. Push to n = 15 and the two agree, which is the Bohr correspondence principle in one picture. Then launch a coherent state and watch it oscillate without spreading.',
    misconception:
      'That the lowest energy state is a particle sitting still at the bottom of the well. A state at rest would have both definite position and zero momentum, which the uncertainty relation forbids; the ground state keeps ℏω/2 of kinetic energy no matter how cold the system gets. You can see that zero-point energy directly in the n = 0 curve — it has width, and width means momentum.',
  },
  'dipole-transitions': {
    explore:
      'Tune the laser onto the two-level resonance and watch the populations flop between ground and excited state at the Rabi frequency Ω = d·E₀/ℏ; halve the field amplitude and a π-pulse takes twice as long, because the rate is set by the coupling, not by the energy gap. Then pick a forbidden pair such as 1s → 2s and drive it as hard as you like — the dipole matrix element is zero, so nothing happens at all.',
    misconception:
      'That an atom soaks up energy gradually until it has enough to jump. Absorption is a transition between two stationary states with a coupling amplitude that grows coherently; detuning the laser away from ω₁₂ slows and then stops the transfer even though the field keeps delivering energy. The forbidden transitions make the point sharper still: selection rules come from the symmetry of ⟨f|r̂|i⟩, not from how much light is available.',
  },
  'stern-gerlach-spin': {
    explore:
      'Build the classic chain: SG_z, block the lower beam, then SG_x, then SG_z again. The final analyser splits fifty-fifty even though every atom entering the apparatus was prepared as spin-up along z. Rotate the middle magnet by an angle θ and the splitting follows cos²(θ/2), which you can read straight off the Bloch sphere as the spinor precesses. Add a third magnet along an arbitrary axis to see the same rule repeat.',
    misconception:
      'That the atom carries a pre-written answer for every axis and measurement merely reads it out. If that were true, the second SG_z would find only the up beam. What the x measurement does is project the state onto a new basis and destroy the previous z information — the apparatus does not look, it writes. And spin itself is not a little ball rotating: the magnitude is fixed at √3ℏ/2 for every electron, and only the projection is quantised.',
  },
  'molecular-orbitals': {
    explore:
      'Combine 1s + 1s on two nuclei and drag the separation. Density piles up between the nuclei, the energy curve falls to its minimum near R₀ ≈ 1.4 a₀ (about 0.74 Å, the real H₂ bond length) and then climbs as the nuclei repel. Switch to 1s − 1s and the nodal plane between the atoms removes exactly that buildup, giving a purely repulsive curve — which is why He₂ does not exist in its ground state.',
    misconception:
      'That a chemical bond is two electrons acting as glue between atoms. The bond exists because an electron in the bonding orbital has lower total energy than in either isolated 1s — spread-out wavelength, lower kinetic energy — and one electron in H₂⁺ already binds. Antisymmetric combinations matter just as much: filling an antibonding orbital cancels the bond, which is exactly what the energy curve shows when you toggle the basis.',
  },
  'uncertainty-lab': {
    explore:
      'Narrow the Gaussian in position space and watch the momentum spectrum widen, with the product Δx·Δp pinned to its floor. Switch to a square envelope and the side lobes appear — a truncated wave needs those extra momenta. Then add chirp: a quadratic phase sweep correlates position with momentum so the packet spreads fast in free evolution, while an unchirped Gaussian keeps its width for as long as possible.',
    misconception:
      'That the uncertainty principle is a statement about clumsy instruments — measure position and the disturbance kicks the momentum. It is not: the limit is a theorem about Fourier pairs. A state localised in x is a narrow superposition in k, and no improvement in apparatus changes that, because the same ψ cannot have both a sharp position and a sharp momentum. The gauge only turns green at ΔxΔp = ℏ/2 for a chirp-free Gaussian, which is the minimum the mathematics allows.',
  },
};

export function generateStaticParams(): { slug: SimSlug }[] {
  return SIM_SLUGS.map((slug) => ({ slug }));
}

// Only the registered slugs exist. Without this, an unlisted slug would be
// rendered on demand and served as a soft 200 instead of a real 404.
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const meta = getMeta(slug);
  if (!meta) return { title: 'Unknown simulation' };
  return {
    title: `${meta.name} — ${meta.tagline}`,
    description: `${meta.tagline}. ${meta.description}`,
    keywords: [...meta.tags, meta.track, meta.difficulty],
    openGraph: {
      type: 'website',
      title: `${meta.name} · Quantahedron`,
      description: meta.tagline,
      url: `/sim/${meta.slug}`,
    },
  };
}

export default async function SimPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isSimSlug(slug)) notFound();
  const meta = getMeta(slug);
  if (!meta) notFound();
  const prose = SIM_PROSE[slug];

  return (
    <div className="flex flex-col gap-8 pb-6 pt-6">
      <header className="flex flex-col gap-3">
        <Link
          href="/#simulations"
          className="w-fit rounded-lg text-[11.5px] text-ink-faint transition-colors hover:text-ink"
        >
          ← Library
        </Link>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink sm:text-[27px]">
            {meta.name}
          </h1>
          <p className="text-[13px] text-ink-dim">{meta.tagline}</p>
        </div>
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Simulation metadata">
          {[meta.track, meta.difficulty, meta.engine, `~${meta.exploreMinutes} min to explore`].map(
            (chip) => (
              <li
                key={chip}
                className="rounded-full border px-2.5 py-1 text-[10.5px]"
                style={{ borderColor: `${meta.accent}55`, color: meta.accent }}
              >
                {chip}
              </li>
            ),
          )}
        </ul>
      </header>

      <Suspense fallback={<div className="stage-frame h-[min(86vh,900px)] w-full" />}>
        <SimulationContainer slug={slug} variant="route" />
      </Suspense>

      <section aria-labelledby="explore-title" className="grid gap-6 sm:grid-cols-2">
        <article>
          <h2 id="explore-title" className="text-[15px] font-semibold text-ink">
            What to explore
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{prose.explore}</p>
        </article>
        <article>
          <h2 className="text-[15px] font-semibold text-ink">The misconception it kills</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">{prose.misconception}</p>
        </article>
      </section>
    </div>
  );
}
