/**
 * Quantahedron concept library (§2 Tier 3, `/learn`).
 *
 * Pure data — no React, no client code — so both the learn index and the topic
 * route stay Server Components. Body prose uses inline `$...$` TeX which
 * `MathText` from `src/lib/math.tsx` renders through KaTeX; `math` entries are
 * display-mode equations rendered with `Tex`.
 *
 * Physics is written in atomic units (ℏ = mₑ = e = 4πε₀ = 1) with SI/eV values
 * quoted wherever a learner would want to check them against a textbook.
 */

import type { SimSlug } from '@/simulations/types';

export interface ConceptSection {
  h2: string;
  body: string;
}

export interface Concept {
  slug: string;
  title: string;
  eyebrow: string;
  summary: string;
  sections: ConceptSection[];
  /** Display-mode TeX blocks, rendered in order after the prose. */
  math?: string[];
  /** Simulations that let the learner test the idea directly. */
  relatedSlugs: SimSlug[];
}

export const CONCEPTS: Concept[] = [
  {
    slug: 'wavefunction-and-phase',
    title: 'The Wavefunction and What Its Phase Means',
    eyebrow: 'Foundations',
    summary:
      'ψ is a complex number attached to every point in space. Its magnitude gives probabilities, its phase gives interference — and only the relative phase is ever visible.',
    sections: [
      {
        h2: 'Two numbers per point, not one',
        body:
          'A classical wave carries a single real amplitude: the water surface is 2 mm high or it is not. A quantum state carries a complex amplitude $\\psi(x) = \\mathrm{Re}(\\psi) + i\\,\\mathrm{Im}(\\psi)$, which means every point of space holds a pair of numbers — equivalently a magnitude $|\\psi|$ and an angle $\\arg\\psi$. Nothing in the theory asks you to picture both at once; the payoff comes from the algebra. Probability density is $|\\psi|^2$, and probabilities stay real and positive even though $\\psi$ itself wanders around the complex plane. Every visualisation on Quantahedron uses the same encoding contract: hue = $\\arg\\psi$, luminance and opacity = $|\\psi|^2$. When you see a teal lobe next to a rose lobe in the same orbital, you are looking at a $\\pi$ phase difference, not at two different elements.',
      },
      {
        h2: 'Global phase is invisible, relative phase is everything',
        body:
          'Multiplying a whole state by $e^{i\\gamma}$ changes no measurement outcome whatsoever — the expectation value $\\langle\\psi|\\hat{A}|\\psi\\rangle$ is invariant because the factor cancels against its own conjugate. That is why the store keeps phases as differences between components. Split the same state into a superposition, though, and the phase between the two parts is directly observable: it sets where interference fringes land, which way a probability current circulates, and whether a dipole oscillates along $+x$ or along $-x$. Two states that differ only in relative phase are physically different states, and the phasor dock at the bottom of every stage exists precisely so you can dial that angle instead of guessing it.',
      },
      {
        h2: 'Phase evolution is the clock of quantum mechanics',
        body:
          'Each energy eigenstate rotates its phase at its own rate, $\\psi_n(t) = \\psi_n(0)\\,e^{-iE_n t/\\hbar}$. A stationary state therefore looks frozen — $|\\psi|^2$ is constant, which is exactly what "stationary" means — while a superposition of two energies keeps a beating density, because the relative phase sweeps the full circle at frequency $\\Delta E / h$. In atomic units ($\\hbar = m_e = e = 4\\pi\\varepsilon_0 = 1$) one hartree of energy corresponds to one radian per atomic time unit, $2.4189\\times10^{-17}$ s, so the hydrogen $1s \\to 2p$ beat at $\\Delta E = 10.2$ eV completes a cycle in about 0.4 femtoseconds. The simulations slow this down by a display time-scale factor; the physics stays exactly the same, only the animation rate changes.',
      },
    ],
    math: [
      'i\\hbar\\,\\frac{\\partial \\psi}{\\partial t} \\;=\\; \\left[-\\frac{\\hbar^{2}}{2m}\\nabla^{2} + V(\\mathbf{r})\\right]\\psi',
      '\\rho(\\mathbf{r}) = |\\psi|^{2} = \\psi^{*}\\psi, \\qquad \\arg(\\psi) \\in [-\\pi,\\pi] \\;\\mapsto\\; \\text{hue}',
      '\\psi_n(t) = \\psi_n(0)\\,e^{-iE_n t/\\hbar}, \\qquad \\omega_{21} = \\frac{E_2 - E_1}{\\hbar}',
    ],
    relatedSlugs: ['orbitalis-3d', 'tdse-1d', 'uncertainty-lab'],
  },
  {
    slug: 'quantum-numbers',
    title: 'Quantum Numbers: Size, Shape, Orientation',
    eyebrow: 'Atomic structure',
    summary:
      'n, ℓ and m are not arbitrary labels — they are the three integer bookkeeping entries that survive from the boundary conditions of the hydrogen atom, and they fix energy, shape, nodes and orientation.',
    sections: [
      {
        h2: 'Where the integers come from',
        body:
          'Solving the hydrogenic Schrödinger equation in spherical coordinates separates $\\psi$ into a radial part $R_{n\\ell}(r)$ and an angular part $Y_\\ell^m(\\theta,\\varphi)$. Three conditions appear, and each one quantises something. Square-integrability of the radial solution forces the principal quantum number $n = 1, 2, 3\\dots$. Requiring the angular solution to be single-valued around the polar axis forces the magnetic quantum number $m$ to be an integer. Requiring it to be well behaved at the poles forces the orbital number $\\ell$ to be a non-negative integer. Nothing is postulated: the integers are what is left when you demand a sane wavefunction.',
      },
      {
        h2: 'The hierarchy and the node count',
        body:
          'The rules are strict: $1 \\le n$, $0 \\le \\ell \\le n-1$, and $-\\ell \\le m \\le +\\ell$. So a given shell $n$ contains $n^2$ orbital states without spin — $n=3$ gives 3s, 3p (three orientations) and 3d (five orientations), i.e. $1+3+5 = 9 = n^2$. The number $\\ell$ counts angular nodes, flat or conical nodal surfaces through the nucleus; $n-\\ell-1$ counts radial nodes, spherical shells where the wavefunction crosses zero. The total is always $n-1$, which is a fast self-check while dragging the quantum-number steppers. For hydrogen the energy depends on $n$ alone, $E_n = -Z^2 \\times 13.6057\\,\\mathrm{eV}/n^2$, so all nine $n=3$ states are degenerate; in many-electron atoms the $\\ell$ dependence reappears and 3s drops below 3p below 3d.',
      },
      {
        h2: 'Complex eigenstates versus chemistry orbitals',
        body:
          '$Y_\\ell^m$ is an eigenstate of $\\hat{L}_z$ with eigenvalue $m\\hbar$, and it carries a circulating phase $e^{im\\varphi}$ — that is the state physics prefers, and the one that shows a swirling probability current for $m \\neq 0$. Chemistry textbooks instead draw $p_x, p_y, d_{z^2}, d_{x^2-y^2}$: real combinations obtained by adding and subtracting $\\pm m$ pairs, e.g. $p_x \\propto (Y_1^{-1} - Y_1^{+1})/\\sqrt{2}$. Both bases span the same subspace and give the same energies, but only the complex basis has a definite $\\hat{L}_z$. Toggle between them in Orbitalis 3D: the density keeps its shell and node structure while the lobes stop rotating, which is a good lesson in what a "basis" actually is.',
      },
    ],
    math: [
      '\\psi_{n\\ell m}(r,\\theta,\\phi) = R_{n\\ell}(r)\\,Y_{\\ell}^{m}(\\theta,\\phi), \\qquad 1\\le n,\\; 0\\le\\ell\\le n-1,\\; -\\ell\\le m\\le\\ell',
      'E_n = -\\frac{Z^{2}\\,\\mathrm{Ry}}{n^{2}} = -Z^{2}\\,\\frac{13.6057\\ \\mathrm{eV}}{n^{2}} = -\\frac{Z^{2}}{2n^{2}}\\ E_h',
      '\\text{radial nodes} = n-\\ell-1, \\qquad \\text{angular nodes} = \\ell, \\qquad \\langle r \\rangle_{n\\ell} = \\frac{a_0}{2Z}\\left[3n^{2}-\\ell(\\ell+1)\\right]',
    ],
    relatedSlugs: ['orbitalis-3d', 'de-broglie-ring', 'molecular-orbitals'],
  },
  {
    slug: 'superposition-and-beats',
    title: 'Superposition, Phasors and Quantum Beats',
    eyebrow: 'Dynamics',
    summary:
      'Any normalised combination of eigenstates is a legal state. Its energy is fuzzy, its dipole oscillates at the Bohr frequency, and that oscillation is the mechanism behind light emission.',
    sections: [
      {
        h2: 'Building a state from eigenstates',
        body:
          'Write $|\\Psi\\rangle = \\sum_i c_i |i\\rangle$. The single requirement is normalisation, $\\sum_i |c_i|^2 = 1$, because total probability must be one. Each $c_i$ is complex, so the phasor dock gives you two knobs per state: radius for $|c_i|$ and angle for $\\arg c_i$. The measured energy is not a new average value sitting in the cloud — a measurement returns exactly one of the $E_i$ with weight $|c_i|^2$, and only the expectation value $\\langle E \\rangle = \\sum_i |c_i|^2 E_i$ moves smoothly as you drag sliders. That distinction between "the average is continuous" and "the outcome is sharp" is the single most common point of confusion in introductory quantum mechanics, and it is why every stage shows both the ket and $\\langle E \\rangle$.',
      },
      {
        h2: 'Beats: the density breathes',
        body:
          'Take an equal superposition of hydrogen $1s$ and $2p_z$. The two parts rotate at different rates, so the cross term survives when you compute $|\\Psi|^2$ and you get an interference contribution proportional to $\\cos(\\omega_{21} t)$ with $\\omega_{21} = (E_2 - E_1)/\\hbar$. The cloud physically sloshes from the nucleus towards $+z$ and back, once every $2\\pi/\\omega_{21}$. For the $1s$–$2p$ pair in hydrogen, $\\Delta E = 10.2$ eV, so the period is $h/\\Delta E \\approx 0.41$ fs and the matching photon is the Lyman-alpha line at $121.6$ nm. Set the two phasors to equal length and phase, then spin the relative angle: you rotate the sloshing axis without changing the beat frequency.',
      },
      {
        h2: 'Why an oscillating dipole radiates',
        body:
          'An asymmetric charge distribution has an electric dipole moment $\\mathbf{d}(t) = -e\\langle\\mathbf{r}\\rangle(t)$ that oscillates at exactly the Bohr frequency of the participating pair. Classical electrodynamics then demands radiation at that frequency, and quantum theory supplies the photons one at a time: the spontaneous decay rate scales as $|\\langle f|\\hat{\\mathbf{r}}|i\\rangle|^2 \\omega^3$. This is why transitions with $\\langle f|\\hat{\\mathbf{r}}|i\\rangle = 0$ — such as $2s \\to 1s$, forbidden by $\\Delta\\ell = \\pm 1$ — do not merely slow down, they take a completely different route: the hydrogen $2s$ state lives about $0.12$ s because it must shed its energy as two photons at once. Superposition is not a mathematical curiosity; it is the emitting antenna.',
      },
    ],
    math: [
      '|\\Psi\\rangle = \\sum_i c_i |i\\rangle, \\qquad \\sum_i |c_i|^{2} = 1, \\qquad \\langle E \\rangle = \\sum_i |c_i|^{2} E_i',
      '|\\Psi|^{2} \\;\\supset\\; 2\\,\\mathrm{Re}\\!\\left[c_1^{*}c_2\\,\\psi_1^{*}\\psi_2\\,e^{-i\\omega_{21}t}\\right], \\qquad \\omega_{21} = \\frac{E_2-E_1}{\\hbar}',
      '|\\alpha\\rangle = e^{-|\\alpha|^{2}/2}\\sum_{n=0}^{\\infty}\\frac{\\alpha^{n}}{\\sqrt{n!}}\\,|n\\rangle \\quad\\text{(Glauber coherent state)}',
    ],
    relatedSlugs: ['orbitalis-3d', 'harmonic-oscillator', 'dipole-transitions'],
  },
  {
    slug: 'tunneling',
    title: 'Tunneling: Walking Through a Wall',
    eyebrow: 'Barrier physics',
    summary:
      'Below the barrier top the wavefunction does not stop, it decays exponentially — and because the decay is finite, probability leaks to the far side. This single fact powers nuclear fusion, tunnel diodes and atomic-scale microscopy.',
    sections: [
      {
        h2: 'The evanescent tail',
        body:
          'Inside a region where $E < V_0$ the kinetic energy would be negative, so the spatial solution of the Schrödinger equation is not oscillatory but exponential: $\\psi \\propto e^{-\\kappa x}$ with $\\kappa = \\sqrt{2m(V_0-E)}/\\hbar$. Matching $\\psi$ and its derivative at both faces of a barrier of width $a$ gives, for $\\kappa a \\gg 1$, a transmission probability $T \\approx 16(E/V_0)(1-E/V_0)\\,e^{-2\\kappa a}$. The exponential dominates everything else. For an electron facing a $1$ eV energy deficit, $\\kappa \\approx 0.51\\ \\text{\\AA}^{-1}$, so each extra ångström of barrier costs a factor of about $2.8$; at a $4$ eV metal work function it costs roughly a decade per ångström.',
      },
      {
        h2: 'Resonances when the barrier is not alone',
        body:
          'Exponential suppression is the generic case, not the whole story. Two barriers separated by a well form a cavity: if the well fits an integer number of half-wavelengths, $ka = n\\pi$, the multiple reflections inside interfere constructively and the transmission reaches exactly one at those energies. This is resonant tunneling, the same physics as a Fabry-Perot etalon for light. Even a single barrier shows the effect in reverse: for certain combinations of height and width above the barrier, transmission returns to unity when the wavelength matches the barrier width — the Ramsauer-Townsend effect, first measured in low-energy electron scattering off xenon, where a $0.7$ eV electron sees a xenon atom as almost perfectly transparent.',
      },
      {
        h2: 'From a formula to a microscope',
        body:
          'Because $T$ depends exponentially on separation, a conducting tip held a nanometre above a surface produces a current that changes by roughly an order of magnitude for each ångström of height change. Scanning tunneling microscopes regulate that current and thereby map surface topography to a fraction of an ångström — imaging individual atoms with nothing but quantum leakage. The STM mode in the tunneling simulation uses the same equation, so the exponential you see drawn in the $T(E)$ plot is literally the contrast mechanism of the instrument.',
      },
    ],
    math: [
      '\\kappa = \\frac{\\sqrt{2m(V_0-E)}}{\\hbar} \\;=\\; 0.512\\,\\sqrt{V_0-E\\ [\\mathrm{eV}]}\\ \\text{\\AA}^{-1}',
      'T \\;\\approx\\; 16\\,\\frac{E}{V_0}\\left(1-\\frac{E}{V_0}\\right)e^{-2\\kappa a} \\quad (\\kappa a \\gg 1)',
      'I_{\\mathrm{STM}} \\propto e^{-2\\kappa d}, \\qquad \\frac{I(d)}{I(d+1\\ \\text{\\AA})} \\approx 10 \\ \\;\\text{at}\\; \\Phi \\approx 4\\ \\mathrm{eV}',
    ],
    relatedSlugs: ['quantum-tunneling', 'tdse-1d', 'harmonic-oscillator'],
  },
  {
    slug: 'measurement-and-collapse',
    title: 'Measurement, Probability and Collapse',
    eyebrow: 'Interpretation made operational',
    summary:
      'A measurement returns an eigenvalue and leaves the system in the matching eigenstate. That update rule is testable, it is what the engine implements, and it explains why prior knowledge of a different observable is destroyed.',
    sections: [
      {
        h2: 'The Born rule is the whole predictive content',
        body:
          'For an observable $\\hat{A}$ with eigenstates $|a_i\\rangle$, the probability of outcome $a_i$ is $P(a_i) = |\\langle a_i | \\Psi \\rangle|^2$. Nothing about the machinery of a detector appears in the formula, which is why measurement is the one place quantum mechanics forces you to state what you assume. In practice you compute an overlap: project the state onto the eigenstate you asked about, take the squared modulus, and normalise the remainder. In Orbitalis 3D the measurement mode draws electron positions from $|\\Psi|^2$ one click at a time; after a few thousand samples the point cloud has rebuilt the very orbital you started from, which is the Born rule as an experiment rather than a slogan.',
      },
      {
        h2: 'State update, and why order matters',
        body:
          'After obtaining $a_i$ the state is projected: $|\\Psi\\rangle \\to |a_i\\rangle$, up to normalisation. Because the update is a projection and not a gentle read-out, two observables that do not share eigenstates cannot both keep their values. Send a beam prepared in spin-up along $z$ through an $x$-oriented Stern-Gerlach magnet and it splits fifty-fifty; feed only the $+x$ output into a second $z$-magnet and it splits fifty-fifty again, even though every atom entering it was known to be $|{+z}\\rangle$ a moment earlier. Measuring $S_x$ erased the $S_z$ record, because $[\\hat{S}_x, \\hat{S}_z] \\neq 0$. Sequences like this are the operational definition of "incompatible"; no philosophy is required.',
      },
      {
        h2: 'Collapse versus decoherence',
        body:
          'Textbooks postulate a discontinuous jump; real apparatus produce it by entangling the system with an enormous number of uncontrolled degrees of freedom. Once which-path information has leaked into the environment, the cross terms in $|\\Psi|^2$ average to zero for all practical purposes and the interference pattern vanishes — exactly what the which-path detector in the double-slit simulation does when you switch it on. The distinction between "the wavefunction really collapsed" and "the phases became inaccessible" is a genuine interpretational question; the distinction between "interference survives" and "interference is gone" is an experimental one, and only the second is needed to predict the screen.',
      },
    ],
    math: [
      'P(a_i) = |\\langle a_i | \\Psi \\rangle|^{2}, \\qquad |\\Psi\\rangle \\longrightarrow \\frac{|a_i\\rangle\\langle a_i|\\Psi\\rangle}{\\sqrt{P(a_i)}}',
      'P(+_z \\mid +_x) = |\\langle +_z | +_x \\rangle|^{2} = \\cos^{2}\\!\\left(\\frac{\\Delta\\theta}{2}\\right) = \\tfrac{1}{2}',
      '[\\hat{S}_x, \\hat{S}_z] = -i\\hbar \\hat{S}_y \\;\\Rightarrow\\; S_x \\text{ and } S_z \\text{ cannot both be sharp}',
    ],
    relatedSlugs: ['orbitalis-3d', 'stern-gerlach-spin', 'double-slit-2d'],
  },
  {
    slug: 'spin-and-quantisation',
    title: 'Spin and Space Quantisation',
    eyebrow: 'Angular momentum',
    summary:
      'An electron carries an intrinsic angular momentum that has no classical analogue, is always the same size, and can point in only two allowed directions relative to any axis you choose.',
    sections: [
      {
        h2: 'Fixed magnitude, two projections',
        body:
          'Spin-$\\tfrac12$ means the total spin obeys $\\hat{S}^2|\\chi\\rangle = s(s+1)\\hbar^2|\\chi\\rangle$ with $s = 1/2$, so the magnitude is always $\\sqrt{3}\\hbar/2$ — never $\\hbar$, and never zero. Along any chosen axis the measurement yields exactly two results, $S_z = \\pm\\hbar/2$. That is the whole content of the Stern-Gerlach experiment: a silver beam passing one inhomogeneous magnet splits into two spots and only two spots, and passing a second magnet oriented the same way splits nothing further. Quantisation is not an artefact of one particular axis; whichever axis you build the apparatus along, you get the same two-outcome structure.',
      },
      {
        h2: 'The Bloch sphere and the spinor',
        body:
          'Any pure spin state can be written $|\\chi\\rangle = \\cos(\\theta/2)|{\\uparrow}\\rangle + e^{i\\phi}\\sin(\\theta/2)|{\\downarrow}\\rangle$, and the pair $(\\theta, \\phi)$ is a point on the Bloch sphere. The half-angle is not a convention: a rotation by $2\\pi$ returns the state to itself only up to an overall sign, and it takes $4\\pi$ to remove it. Because the spinor lives in a two-dimensional complex space, it transforms under $SU(2)$ rather than $SO(3)$, with the Pauli matrices as generators. The simulation drives the state vector through exactly those matrices, so blocking a beam is a projection and tilting a magnet is a rotation, both visible in one figure.',
      },
      {
        h2: 'Spin in a magnetic field',
        body:
          'The magnetic moment is $\\boldsymbol{\\mu} = -g\\mu_B\\hat{\\mathbf{S}}/\\hbar$ with the electron $g$-factor $g \\approx 2.0023$ and the Bohr magneton $\\mu_B = 9.2740\\times10^{-24}\\ \\mathrm{J\\,T^{-1}} = 5.7884\\times10^{-5}\\ \\mathrm{eV\\,T^{-1}}$. A field $B$ along $z$ therefore splits the two spin orientations by $\\Delta E = g\\mu_B B$, which for $B = 1$ T is $1.16\\times10^{-4}$ eV — and drives Larmor precession at $\\omega_L = g\\mu_B B/\\hbar$, i.e. $28.0$ GHz per tesla, the number electron-spin-resonance spectrometers are built around. The same splitting appears as the anomalous Zeeman structure of atomic lines, and it is why the orbital simulation advances $m$-dependent phases at slightly different rates when you raise the field.',
      },
    ],
    math: [
      '\\hat{S}^{2}|\\chi\\rangle = s(s+1)\\hbar^{2}|\\chi\\rangle, \\quad s=\\tfrac12 \\;\\Rightarrow\\; |\\mathbf{S}| = \\tfrac{\\sqrt{3}}{2}\\hbar, \\qquad S_z = \\pm\\tfrac{\\hbar}{2}',
      '|\\chi\\rangle = \\cos\\tfrac{\\theta}{2}\\,|\\!\\uparrow\\rangle + e^{i\\phi}\\sin\\tfrac{\\theta}{2}\\,|\\!\\downarrow\\rangle',
      '\\Delta E = g\\mu_B B, \\quad g \\approx 2.0023, \\quad \\mu_B = 5.7884\\times10^{-5}\\ \\mathrm{eV\\,T^{-1}}, \\qquad \\omega_L = \\frac{g\\mu_B B}{\\hbar} \\approx 28.0\\ \\mathrm{GHz\\,T^{-1}}',
    ],
    relatedSlugs: ['stern-gerlach-spin', 'dipole-transitions', 'orbitalis-3d'],
  },
];

export const CONCEPT_SLUGS: string[] = CONCEPTS.map((c) => c.slug);

export function getConcept(slug: string | null | undefined): Concept | undefined {
  if (!slug) return undefined;
  return CONCEPTS.find((c) => c.slug === slug);
}
