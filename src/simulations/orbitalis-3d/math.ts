/**
 * Orbitalis 3D — synchronised mathematics drawer content.
 *
 * Everything the learner sees in the drawer is generated from the *live*
 * parameters, so the TeX on screen is the equation the renderer is actually
 * evaluating this frame (same Z, same node counts, same phases).
 */

import type { SimMathContent, SimParams } from '@/simulations/types';
import { SUBSHELL_LETTERS, transitionWavelengthNm, seriesName } from '@/engine/physics/constants';
import {
  angularNodes,
  energyEv,
  energyHa,
  radialNodes,
  rExpectation,
  rMostProbable,
} from '@/engine/physics/hydrogen';
import { pBool, pNum, pStr } from '@/store/useSimStore';
import { ampsFromParams, displayOmega, buildOrbitalState, shortLabel } from './state';

function ketTex(a: { n: number; l: number; m: number }, amp: number, phase: number): string {
  const coef =
    Math.abs(amp - 1) < 1e-3
      ? ''
      : `\\left(${amp.toFixed(2)}${Math.abs(phase) > 1e-3 ? `\\,e^{i${(phase / Math.PI).toFixed(2)}\\pi}` : ''}\\right)`;
  return `${coef}\\,\\lvert ${a.n}\\,${SUBSHELL_LETTERS[a.l]}${a.m >= 0 ? `\\,^{${a.m}}` : `\\,^{${a.m}}`}\\rangle`;
}

export function orbitalisMath(p: SimParams): SimMathContent {
  const amps = ampsFromParams(p);
  const state = buildOrbitalState(p);
  const Z = state.Z;
  const head = amps[0] ?? { n: 1, l: 0, m: 0 };
  const omegaVis = displayOmega(state);
  const beat =
    amps.length > 1 && omegaVis.length > 1
      ? (2 * Math.PI) / Math.abs(omegaVis[0] - omegaVis[1])
      : null;
  const rBar = rExpectation(head.n, head.l, Z);
  const rPeak = rMostProbable(head.n, head.l, Z);
  const B = pNum(p, 'zeemanB', 0);
  const F = pNum(p, 'starkE', 0);
  const series = pStr(p, 'series', 'balmer');
  const nLo = series === 'lyman' ? 1 : series === 'balmer' ? 2 : 3;
  const nHi = Math.max(nLo + 1, Math.round(pNum(p, 'transitionHi', nLo + 1)));
  const lambda = transitionWavelengthNm(nHi, nLo, Z);

  const expansion = amps.map((a) => ketTex(a, a.amp, a.phase)).join(' + ');

  return {
    formula: [
      {
        tex: 'i\\hbar\\,\\frac{\\partial \\Psi}{\\partial t}=\\left[-\\frac{\\hbar^{2}}{2m_{e}}\\nabla^{2}-\\frac{Ze^{2}}{4\\pi\\varepsilon_{0}r}\\right]\\Psi',
        display: true,
        note: 'The hydrogenic Schrödinger equation — solved analytically, never numerically, so every node and energy on screen is exact.',
      },
      {
        tex: `\\Psi(x,t)=\\sum_{k} c_{k}\\,e^{-iE_{k}t/\\hbar}\\,\\psi_{n_k \\ell_k m_k}(x),\\qquad |\\Psi\\rangle = ${expansion}`,
        display: true,
        note: 'This is precisely the superposition the fragment shader recombines every frame from the baked eigenstate textures.',
      },
      {
        tex: `\\psi_{n\\ell m}=R_{n\\ell}(Zr)\\,Y_{\\ell}^{m}(\\theta,\\varphi),\\qquad E_{n}=-\\frac{Z^{2}}{2n^{2}}\\,\\text{Ha}=${energyHa(head.n, Z).toFixed(4)}\\ \\text{Ha}=${energyEv(head.n, Z).toFixed(2)}\\ \\text{eV}`,
        display: true,
        note: `Currently showing the ${shortLabel(head)} component (n=${head.n}, ℓ=${head.l}, m=${head.m}) at Z=${Z}.`,
      },
      {
        tex: `\\Delta t_{\\text{beat}}=\\frac{2\\pi}{|E_{1}-E_{2}|/\\hbar}=${beat ? beat.toFixed(1) : '\\infty'}\\ \\text{s (display scale)}`,
        display: true,
        note: 'Atomic-unit time is 2.42·10⁻¹⁷ s; the visual clock is rescaled (see the legend) while the energies above stay exact.',
      },
    ],

    readout: [
      { label: 'Energy (state 1)', value: `${energyHa(head.n, Z).toFixed(5)} Ha` },
      { label: 'Binding', value: `${Math.abs(energyEv(head.n, Z)).toFixed(3)} eV` },
      { label: 'Radial nodes', value: `${radialNodes(head.n, head.l)}` },
      { label: 'Angular nodes', value: `${angularNodes(head.l)}` },
      { label: '⟨r⟩', value: `${rBar.toFixed(3)} a₀` },
      { label: 'r most probable', value: `${rPeak.toFixed(3)} a₀` },
      { label: 'Components', value: `${amps.length}` },
      { label: `L_${series === 'lyman' ? 'α' : series === 'balmer' ? 'α' : 'α'}`, value: `${lambda.toFixed(1)} nm` },
      {
        label: 'Zeeman split',
        value: B > 0 ? `${(Math.abs(amps[0]?.m ?? 0) * 5.788381806e-5 * B).toFixed(5)} eV` : 'off',
      },
      { label: 'Stark field', value: F > 0 ? `${F.toFixed(2)}·10⁹ V/m` : 'off' },
    ],

    phaseLegend: pBool(p, 'monochrome', false)
      ? 'Monochrome mode: brightness encodes |Ψ|² only. Switch phase colour back on to see the winding.'
      : `Hue is the sign and value of the complex phase arg Ψ (twilight colour wheel: warm = positive real, cool = negative). Because ψ_{nℓm} ∝ e^{imφ}, the colour makes exactly ${head.m === 0 ? 'no' : Math.abs(head.m)} full turn${Math.abs(head.m) === 1 ? '' : 's'} around the z axis — that winding IS the angular momentum projection L_z = ${head.m}ℏ. Nodes are where the hue flips and brightness drops to zero.`,

    intuition: [
      `**There is no such thing as an electron orbit.** The cloud you are looking at is a standing wave of probability: $\Psi$ is a complex field filling space, and $|\\Psi|^2$ is what a position measurement returns. The ${shortLabel(head)} state has ${radialNodes(head.n, head.l)} radial node${radialNodes(head.n, head.l) === 1 ? '' : 's'} (spherical shells of zero probability) and ${angularNodes(head.l)} angular node${angularNodes(head.l) === 1 ? '' : 's'} (flat or conical surfaces), which together explain every visible gap.`,
      `**Phase is not decoration.** Two regions with the same density but opposite phase interfere destructively where they meet — that is what a node *is*. Watch a superposition of $2s$ and $2p_z$: the cloud sloshes along $z$ because the relative phase rotates at $\\Delta E/\\hbar$. The sloshing is the oscillating dipole that makes light emission possible.`,
      `**Quantisation is a boundary condition**, not a postulate. Only certain standing waves fit: the polynomial part of $R_{n\\ell}$ must terminate, which forces $E_n=-Z^2/2n^2$. Raising $Z$ squeezes the cloud as $1/Z$ and deepens the energy as $Z^2$ — try it and measure the radius change in the read-out.`,
      B > 0
        ? `**The magnetic field lifts the $m$ degeneracy** by $\\Delta E=m\\mu_BB$. States with different $m$ now drift apart in phase, so a cloud that was frozen starts to precess — Larmor precession, visible as the colour wheel rotating.`
        : `**Degeneracy is a symmetry statement.** With $B=0$ the $m$-sublevels share one energy, so the probability density is static no matter what you mix — turn on the field to break the tie and set the cloud rotating.`,
    ].join('\n\n'),

    derivation: [
      {
        title: 'Separation in spherical coordinates',
        steps: [
          {
            text: 'The Coulomb potential is central, so write Ψ = R(r)·Y(θ,φ) and separate the angular momentum operator out of the Laplacian.',
            math: [{ tex: '\\nabla^{2}=\\frac{1}{r^{2}}\\partial_{r}\\left(r^{2}\\partial_{r}\\right)-\\frac{\\hat L^{2}}{\\hbar^{2}r^{2}}', display: true }],
          },
          {
            text: 'The angular eigenvalue problem ĤL²Y = ℓ(ℓ+1)ℏ²Y is solved by the spherical harmonics, single-valued only for integer ℓ and m.',
            math: [
              { tex: 'Y_{\\ell}^{m}(\\theta,\\varphi)=(-1)^{m}\\sqrt{\\frac{2\\ell+1}{4\\pi}\\frac{(\\ell-m)!}{(\\ell+m)!}}\\,P_{\\ell}^{m}(\\cos\\theta)\\,e^{im\\varphi}', display: true },
              { tex: `\\text{now: }\\ell=${head.l},\\ m=${head.m}\\ \\Rightarrow\\ \\text{norm }\\sqrt{\\tfrac{2\\ell+1}{4\\pi}}=\\sqrt{${((2 * head.l + 1) / (4 * Math.PI)).toFixed(4)}}`, display: false },
            ],
          },
          {
            text: 'The radial equation, with ρ = 2Zr/n, becomes the associated Laguerre equation. Normalisability forces the series to truncate at degree n−ℓ−1 — that truncation is the quantisation of energy.',
            math: [
              { tex: 'R_{n\\ell}(r)=\\sqrt{\\left(\\frac{2Z}{na_0}\\right)^{3}\\frac{(n-\\ell-1)!}{2n\\,(n+\\ell)!}}\\;e^{-\\rho/2}\\,\\rho^{\\ell}\\,L_{n-\\ell-1}^{2\\ell+1}(\\rho)', display: true },
              { tex: `L_{n-\\ell-1}^{2\\ell+1}=L_{${radialNodes(head.n, head.l)}}^{${2 * head.l + 1}}\\quad\\Rightarrow\\quad\\text{${radialNodes(head.n, head.l)} radial node${radialNodes(head.n, head.l) === 1 ? '' : 's'}}`, display: false },
            ],
          },
        ],
      },
      {
        title: 'Time dependence of a superposition',
        steps: [
          {
            text: 'Each eigenstate only acquires a phase, so |Ψ|² of a single state never changes — a stationary state really is static.',
            math: [{ tex: '\\psi_k(t)=\\psi_k(0)\\,e^{-iE_kt/\\hbar}\\;\\Rightarrow\\;|\\psi_k|^2=\\text{const}', display: true }],
          },
          {
            text: 'With two components a cross term survives, oscillating at the Bohr frequency of the pair. That is the whole content of "quantum beats".',
            math: [
              { tex: '|\\Psi|^{2}=\\sum_k|c_k\\psi_k|^{2}+2\\sum_{k<j}|c_kc_j\\psi_k\\psi_j|\\cos\\!\\left(\\frac{E_j-E_k}{\\hbar}t-\\Delta\\varphi_{kj}\\right)', display: true },
              { tex: `\\omega_{12}=\\frac{|E_{${amps[0]?.n ?? 1}}-E_{${amps[1]?.n ?? amps[0]?.n ?? 1}}|}{\\hbar}=${amps.length > 1 ? Math.abs(energyHa(amps[0].n, Z) - energyHa(amps[1].n, Z)).toExponential(3) : '0'}\\ \\text{a.u.}`, display: false },
            ],
          },
          {
            text: 'Because a global phase is unobservable, the renderer subtracts the mean energy before rotating the slots — the density is unchanged and the arithmetic stays in float32 range.',
            math: [{ tex: 'e^{-iE_kt}\\rightarrow e^{-i(E_k-\\bar E)t}', display: true }],
          },
        ],
      },
      {
        title: 'Fields and spectra',
        steps: [
          {
            text: 'Orbital Zeeman effect: the m-sublevels split linearly, and the gyromagnetic ratio for orbital motion is exactly one Bohr magneton per ℏ.',
            math: [{ tex: '\\Delta E_{Z}=m\\,\\mu_{B}B,\\qquad \\mu_B=5.788\\cdot10^{-5}\\;\\text{eV/T}', display: true }],
          },
          {
            text: 'In the degenerate n = 2 manifold the Stark perturbation is off-diagonal, so degenerate perturbation theory gives the ±3Ze a₀F/2 pair — the linear Stark effect hydrogen is famous for.',
            math: [{ tex: '\\hat H_1=eFz,\\qquad \\langle 2s|eFz|2p_0\\rangle=-3ea_0F,\\qquad \\Delta E^{(1)}=\\pm\\tfrac{3}{2}eFa_0', display: true }],
          },
          {
            text: 'Every emission line is a difference of two eigenenergies; the Rydberg formula falls straight out.',
            math: [
              { tex: '\\frac{1}{\\lambda}=R_\\infty Z^{2}\\left(\\frac{1}{n_{\\text{lo}}^{2}}-\\frac{1}{n_{\\text{hi}}^{2}}\\right)', display: true },
              { tex: `\\text{${seriesName(nLo)} series: }\\ n_{\\text{lo}}=${nLo},\\ n_{\\text{hi}}=${nHi}\\ \\Rightarrow\\ \\lambda=${lambda.toFixed(1)}\\ \\text{nm}`, display: false },
            ],
          },
        ],
      },
    ],

    challenge: [
      {
        question: 'Find the state with exactly two spherical nodal shells and no angular nodes.',
        hint: 'Angular nodes = ℓ, so you need ℓ = 0. Radial nodes = n − ℓ − 1.',
        answer: 'n = 3, ℓ = 0: the 3s orbital. Set n = 3, ℓ = 0, m = 0 and count the bright rings in the Slice view.',
        paramKey: 'n',
      },
      {
        question: 'Make the cloud rotate even though every density by itself is stationary.',
        hint: 'A single eigenstate is always static. You need two different energies AND different angular dependence.',
        answer: 'Mix 2s with 2p₀ (or apply a B field to split m-sublevels). The density then beats at ΔE/ℏ.',
        paramKey: 'ampsAmp',
      },
      {
        question: 'Turn the four-leaf d_xy clover into two lobes without changing n or ℓ.',
        hint: 'Same shell, different m — a different linear combination of the degenerate states.',
        answer: 'Take m = 0 in the real basis: d_{z²} has two lobes plus a torus. Switch Basis to real and set ℓ = 2, m = 0.',
        paramKey: 'm',
      },
      {
        question: 'Squeeze the 1s cloud to a quarter of its radius and predict the new binding energy.',
        hint: 'Lengths scale as 1/Z, energies as Z².',
        answer: 'Z = 4 (Be³⁺) gives ⟨r⟩ = 0.25 a₀ and E = −16 × 13.6 eV ≈ −217.7 eV.',
        paramKey: 'Z',
      },
    ],
  };
}

export default orbitalisMath;
