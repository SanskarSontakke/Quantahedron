/**
 * Harmonic Oscillator — synchronized math drawer.
 *
 * The headline equations quote the live ω, |α⟩ and coefficient list, and the
 * derivations end in numbers the learner can read straight off the stage.
 */

import type { SimMathContent, SimParams } from '@/simulations/types';
import { pBool, pNum } from '@/store/useSimStore';
import {
  MAX_LEVELS,
  coherentDepth,
  evaluateWave,
  fmt,
  moments,
  psiNormLog,
  poissonWeights,
  stateCoeffs,
  turningAmplitude,
} from './physics';
import { is2D } from './controls';

export function oscillatorMath(p: SimParams): SimMathContent {
  const omega = pNum(p, 'omega', 1);
  const xMax = pNum(p, 'xMax', 7);
  const coherent = pBool(p, 'coherent', false);
  const c = stateCoeffs(p);
  const m = moments(c, omega);
  const A = turningAmplitude(m.energy, omega);
  const nMax = c.ns.length ? Math.max(...c.ns) : 0;
  const depth = coherent ? coherentDepth(c.absA, Math.round(pNum(p, 'levels', 8))) : c.ns.length;
  const alphaArg = Math.atan2(c.alphaIm, c.alphaRe);
  const twoD = is2D(p);

  // Largest eigenstate weight currently rendered, and where it sits.
  let best = 0;
  let bestN = 0;
  for (let i = 0; i < c.ns.length; i++) {
    const w = c.re[i] * c.re[i] + c.im[i] * c.im[i];
    if (w > best) {
      best = w;
      bestN = c.ns[i];
    }
  }
  const field = evaluateWave(c.ns, c.re, c.im, omega, 512, xMax);
  const normErr = Math.abs(field.mass - 1);

  const stackTex = coherent
    ? `|\\alpha\\rangle = e^{-|\\alpha|^2/2}\\sum_{n=0}^{\\infty}\\frac{\\alpha^{n}}{\\sqrt{n!}}\\,|n\\rangle,\\qquad \\alpha = ${c.alphaRe.toFixed(2)}${c.alphaIm >= 0 ? '+' : '-'} ${Math.abs(c.alphaIm).toFixed(2)}i`
    : `|\\psi\\rangle = \\sum_{n}c_n|n\\rangle,\\qquad \\sum_n |c_n|^2 = ${c.norm.toFixed(3)},\\quad \\langle n\\rangle = ${m.nbar.toFixed(3)}`;

  return {
    formula: [
      {
        tex: `V(x) = \\tfrac{1}{2}m\\omega^2 x^2 = \\tfrac{1}{2}\\,${omega.toFixed(2)}\\,x^2 \\quad (\\hbar = m = 1),\\qquad E_n = \\left(n+\\tfrac{1}{2}\\right)\\hbar\\omega`,
        display: true,
        note: twoD
          ? 'The 2D well is V = ½ω²(x²+y²), so E = (nₓ+n_y+1)ħω and every shell nₓ+n_y = const is degenerate.'
          : `Levels shown: n = 0 … ${Math.max(nMax, 1)}. ⟨E⟩ = ${m.units.toFixed(3)} ħω.`,
      },
      {
        tex: `\\psi_n(x) = \\left(\\frac{\\omega}{\\pi}\\right)^{1/4}\\frac{H_n(\\sqrt{\\omega}\\,x)}{\\sqrt{2^{n}n!}}\\,e^{-\\omega x^2/2},\\qquad \\ln\\frac{(\\omega/\\pi)^{1/4}}{\\sqrt{2^{${nMax}}\\,${nMax}!}} = ${psiNormLog(nMax, omega).toFixed(3)}`,
        display: true,
        note: `Everything is carried in log space. At the top of the ladder $2^{20}\\,20! = 2.55\\times10^{24}$ and $\\max|H_{20}|\\approx 8\\times10^{20}$, so dividing them straight in floating point throws away ~7 digits; with $\\ln\\sqrt{2^{n}n!}$ from lgamma and a Gaussian-damped recurrence, $\\int|\\psi_{20}|^2dx = 1.000000000000$ on a 4096-point grid.`,
      },
      {
        tex: stackTex,
        display: true,
        note: coherent
          ? `Truncated at n = ${depth - 1}; ${poissonWeights(c.absA, depth).reduce((s, v) => s + v, 0).toFixed(5)} of the Poisson series survives, dominant weight |${bestN}⟩ at ${best.toFixed(3)}.`
          : `Drag the phasor dials in the dock: ${c.ns.length} amplitudes are live.`,
      },
      {
        tex: `P_{\\mathrm{cl}}(x) = \\frac{1}{\\pi\\sqrt{A^2 - x^2}},\\qquad A = \\sqrt{\\frac{2E}{m\\omega^2}} = ${A.toFixed(3)}\\;\\ell`,
        display: true,
        note: 'The dashed amber curve on the stage: a classical particle spends most of its period near the turning points, so P_cl diverges there and is identically zero beyond ±A.',
      },
    ],
    readout: [
      { label: 'ω', value: `${omega.toFixed(3)}` },
      { label: 'highest n drawn', value: `${nMax}` },
      { label: '⟨n⟩', value: m.nbar.toFixed(3) },
      { label: '⟨E⟩ / ħω', value: m.units.toFixed(3) },
      { label: 'Δx', value: m.dx.toFixed(4) },
      { label: 'Δp', value: m.dp.toFixed(4) },
      { label: 'Δx·Δp / ħ', value: m.product.toFixed(4) },
      { label: coherent ? '|α|' : 'Σ|cₙ|²', value: coherent ? c.absA.toFixed(3) : c.norm.toFixed(3) },
      { label: 'turning point A', value: `${A.toFixed(3)} ℓ` },
      { label: '∫|ψ|²dx − 1', value: normErr.toExponential(1) },
    ],
    phaseLegend: twoD
      ? 'The 2D heatmap maps |Ψ(x,y)|² to brightness and arg Ψ to hue on the twilight wheel; for a real eigenstate combination the hue is binary (rose = positive lobe, indigo = negative lobe) and the boundaries between hues are exactly the nodal lines. The white cross tracks (⟨x⟩,⟨y⟩) of the packet centre.'
      : 'Hue is the local phase $\\arg\\psi$ read off the twilight wheel, brightness is $|\\psi|^2$ — so a colour that is frozen in place means a stationary state, while a colour that marches along $x$ means a genuinely travelling packet. The amber dashed curve is the *classical* density $P_{\\mathrm{cl}}$, the shaded band beyond $\\pm A$ is the classically forbidden region, and in the Re/Im channel the solid line is $\\mathrm{Re}\\,\\psi$ and the thin one is $\\mathrm{Im}\\,\\psi$.',
    intuition: twoD
      ? `Two independent oscillators share one centre, so the 2D spectrum is $E=(n_x+n_y+1)\\hbar\\omega$: swapping $n_x\\leftrightarrow n_y$ costs nothing. That degeneracy is what lets $\\cos\\theta\\,|n_x,n_y\\rangle+\\sin\\theta\\,|n_y,n_x\\rangle$ be a *stationary* state with a genuinely two-dimensional density — nodal grids that are not just two 1D patterns glued together. A coherent state with $\\alpha_y=-i\\alpha_x$ instead walks the whole pattern around the origin on a circle of radius $\\sqrt{2/\\omega}\\,|\\alpha|$ without ever changing shape.`
      : `The harmonic oscillator is where quantum mechanics visibly grows into classical mechanics. A single eigenstate $|n\\rangle$ is stationary and its $|\\psi_n|^2$ has $n+1$ lobes, but averaged over those lobes it reproduces $P_{\\mathrm{cl}}(x)$ almost exactly — by $n\\sim15$ the envelope and the classical curve are hard to tell apart, and the leakage past the turning points is only a few percent. What actually behaves like a mass on a spring is not an eigenstate at all but a *superposition*: the Glauber state $|\\alpha\\rangle$, whose coefficients are Poisson-distributed, whose $\\Delta x\\Delta p$ sits exactly on the Heisenberg floor forever, and whose centre obeys $\\langle x\\rangle=\\sqrt{2/\\omega}\\,|\\alpha|\\cos(\\omega t+\\arg\\alpha)$ — Ehrenfest's theorem made visible. Turn on the coherent state and watch the packet leave the well wall and come back without spreading a pixel.`,
    derivation: [
      {
        title: 'Ladder operators ⇒ Eₙ = (n+½)ħω',
        steps: [
          {
            text: 'Rescale position and momentum to dimensionless x̂ and p̂ with [x̂, p̂] = i (ħ = m = 1), then factor the Hamiltonian.',
            math: [
              {
                tex: '\\hat a = \\sqrt{\\tfrac{\\omega}{2}}\\,\\hat x + \\frac{i\\,\\hat p}{\\sqrt{2\\omega}},\\qquad [\\hat a,\\hat a^{\\dagger}] = 1,\\qquad \\hat H = \\hbar\\omega\\left(\\hat a^{\\dagger}\\hat a + \\tfrac{1}{2}\\right)',
                display: true,
              },
            ],
          },
          {
            text: 'The number operator N = â†â has non-negative eigenvalues, because ⟨ψ|N|ψ⟩ = ‖â|ψ⟩‖² ≥ 0. Applying â lowers the energy and â† raises it, each by exactly one quantum.',
            math: [
              { tex: '\\hat H\\,\\hat a^{\\dagger}|n\\rangle = (E_n + \\hbar\\omega)\\,\\hat a^{\\dagger}|n\\rangle,\\qquad \\hat a^{\\dagger}|n\\rangle = \\sqrt{n+1}\\,|n+1\\rangle,\\quad \\hat a|n\\rangle = \\sqrt{n}\\,|n-1\\rangle', display: true },
            ],
          },
          {
            text: 'The ladder must stop — otherwise the energy would fall below any bound — so the ground state is killed by â. That terminal condition fixes the zero-point energy ½ħω, and no normalisable state exists below it.',
            math: [
              { tex: '\\hat a|0\\rangle = 0 \\;\\Rightarrow\\; \\left(\\sqrt{\\tfrac{\\omega}{2}}x + \\tfrac{1}{\\sqrt{2\\omega}}\\tfrac{d}{dx}\\right)\\psi_0 = 0 \\;\\Rightarrow\\; \\psi_0 = \\left(\\tfrac{\\omega}{\\pi}\\right)^{1/4}e^{-\\omega x^2/2},\\qquad E_0 = \\tfrac{1}{2}\\hbar\\omega', display: true },
            ],
          },
          {
            text: 'Applying â† n times builds every level, and normalisation forces the √(n!) that the drawer hides inside a logarithm. Node count follows from the degree of Hₙ.',
            math: [
              { tex: `|n\\rangle = \\frac{(\\hat a^{\\dagger})^{n}}{\\sqrt{n!}}|0\\rangle \\;\\Rightarrow\\; E_n = \\left(n+\\tfrac12\\right)\\hbar\\omega,\\qquad \\psi_n = \\left(\\tfrac{\\omega}{\\pi}\\right)^{1/4}\\frac{H_n(\\sqrt{\\omega}x)e^{-\\omega x^2/2}}{\\sqrt{2^{n}n!}}`, display: true },
              { tex: `\\text{screen: } n_{\\max} = ${nMax},\\quad E_{${nMax}} = ${(nMax + 0.5).toFixed(1)}\\,\\hbar\\omega = ${((nMax + 0.5) * omega).toFixed(3)}`, display: true, note: `Current ⟨E⟩ = ${m.units.toFixed(3)} ħω sits between n = ${Math.floor(m.nbar)} and n = ${Math.floor(m.nbar) + 1}.` },
            ],
          },
          {
            text: 'Because x̂ = (â + â†)/√(2ω), every moment is a single overlap — no numerical quadrature is needed. That is where the ΔxΔp = ½ on the stage comes from.',
            math: [
              { tex: '\\langle x\\rangle = \\sqrt{\\tfrac{2}{\\omega}}\\,\\mathrm{Re}\\langle\\hat a\\rangle,\\quad \\langle x^2\\rangle = \\frac{2\\mathrm{Re}\\langle\\hat a^2\\rangle + 2\\langle N\\rangle + 1}{2\\omega},\\quad \\langle p^2\\rangle = \\frac{\\omega}{2}\\left(2\\langle N\\rangle + 1 - 2\\mathrm{Re}\\langle\\hat a^2\\rangle\\right)', display: true },
            ],
          },
        ],
      },
      {
        title: 'The coherent state: â|α⟩ = α|α⟩ ⇒ Poisson',
        steps: [
          {
            text: 'Demand that the state be an eigenstate of the *non-Hermitian* lowering operator, with a complex eigenvalue α. Expand in the number basis and let â shift the index.',
            math: [{ tex: '\\hat a\\sum_n c_n|n\\rangle = \\sum_n c_n\\sqrt{n}\\,|n-1\\rangle = \\alpha\\sum_n c_n|n\\rangle', display: true }],
          },
          {
            text: 'Match coefficients of |n⟩: a three-term-free recursion that fixes the whole state from c₀ alone.',
            math: [{ tex: `c_{n+1} = \\frac{\\alpha}{\\sqrt{n+1}}c_n \\;\\Rightarrow\\; c_n = c_0\\frac{\\alpha^{n}}{\\sqrt{n!}}`, display: true }],
          },
          {
            text: 'Normalise with Σ|α|^{2n}/n! = e^{|α|²}. The resulting weights are exactly a Poisson distribution with mean |α|² — variance equal to the mean, hence a Fano factor of 1.',
            math: [
              { tex: '|\\alpha\\rangle = e^{-|\\alpha|^2/2}\\sum_n \\frac{\\alpha^{n}}{\\sqrt{n!}}|n\\rangle,\\qquad |c_n|^2 = e^{-|\\alpha|^2}\\frac{|\\alpha|^{2n}}{n!},\\qquad \\langle n\\rangle = |\\alpha|^2 = ${(c.absA * c.absA).toFixed(3)},\\;\\frac{\\mathrm{Var}}{\\langle n\\rangle} = 1', display: true },
              { tex: `\\text{on screen: } |\\alpha| = ${c.absA.toFixed(3)},\\ \\arg\\alpha = ${alphaArg.toFixed(3)}\\ \\mathrm{rad},\\ \\mathrm{Fano} = ${fmt(c.fano, 4)}`, display: true, note: 'Any deviation from 1 in the read-out is pure basis truncation: only ' + depth + ' of the Poisson series are carried.' },
            ],
          },
          {
            text: 'Each |n⟩ picks up e^{−i(n+½)ωt}, so α simply rotates: â|α(t)⟩ = αe^{−iωt}|α(t)⟩. The packet keeps its shape (Δx = 1/√ω for every α) while its centre executes the classical motion.',
            math: [
              { tex: `\\langle x\\rangle(t) = \\sqrt{\\tfrac{2}{\\omega}}\\,|\\alpha|\\cos(\\omega t + \\arg\\alpha) = ${(Math.sqrt(2 / omega) * c.absA).toFixed(3)}\\,\\cos(${omega.toFixed(2)}t + ${alphaArg.toFixed(2)})`, display: true },
              { tex: `\\Delta x\\,\\Delta p = ${m.product.toFixed(6)}\\,\\hbar \\quad\\text{for all } t`, display: true, note: `Amplitude √(2/ω)|α| = ${(Math.sqrt(2 / omega) * c.absA).toFixed(4)} ℓ — for |α| = 2 and ω = 1 that is √2·2 = 2.828 ℓ, and the phase-space orbit is a circle of radius |α| = ${c.absA.toFixed(2)}.` },
            ],
          },
        ],
      },
      {
        title: 'Correspondence limit',
        steps: [
          {
            text: 'For a classical oscillator of energy E the time spent in dx is inversely proportional to its speed, giving the density below — with its integrable singularity at ±A.',
            math: [{ tex: `P_{\\mathrm{cl}}(x) = \\frac{1}{Tv(x)} = \\frac{1}{\\pi\\sqrt{A^2 - x^2}},\\qquad A = \\sqrt{\\tfrac{2E}{m\\omega^2}} = ${A.toFixed(3)}\\,\\ell`, display: true }],
          },
          {
            text: 'The quantum |ψₙ|² oscillates with local wavenumber k(x) = √(2(Eₙ − V))/ħ; averaging over one fringe reproduces P_cl everywhere inside the well, and the fringe spacing shrinks like 1/√n.',
            math: [{ tex: `\\overline{\\psi_n^2} \\approx \\frac{2}{\\pi\\sqrt{A_n^2 - x^2}}\\sin^2\\!\\left(\\int k\\,dx\\right) \\;\\longrightarrow\\; \\tfrac12 \\cdot \\frac{2}{\\pi\\sqrt{A^2-x^2}}`, display: true }],
          },
          {
            text: 'Beyond ±A the classical density is exactly zero while the quantum one decays into the wall — that tail, not the oscillations, is what stays visibly quantum at large n. It shrinks only as the cube root of n, so it never really disappears.',
            math: [{ tex: `\\int_{|x|>A}|\\psi_n|^2\\,dx \\approx \\frac{0.134}{n^{1/3}}`, display: true, note: 'Measured on this exact grid: 15.730 % at n = 0 (the analytic erfc(1) = 15.7299 %), 5.84 % at n = 11, 4.84 % at n = 20, and P·n^⅓ climbs to 0.1335 by n = 160. The shaded band on the stage shows the same quantity read straight off the plotted ψ.' },
            ],
          },
        ],
      },
    ],
    challenge: [
      {
        question: twoD
          ? `In 2D, find a pair (nₓ, n_y) whose density has exactly four nodal lines and the same energy as |2,0⟩. What is that energy in ħω?`
          : `Raise "Basis size" to n = ${Math.min(MAX_LEVELS - 1, 12)} and switch on the classical overlay. How many lobes does |ψ|² show, and where does the amber curve diverge?`,
        hint: twoD
          ? 'Nodal lines of a product state are the zeros in x plus the zeros in y, so nₓ+n_y is the count. Degeneracy means any pair with the same sum shares an energy — try mix2D to make them interfere.'
          : `ψₙ has exactly n nodes and n+1 lobes. The classical density diverges at ±A = ±√(2Eₙ)/ω with Eₙ = ${Math.min(MAX_LEVELS - 1, 12) + 0.5} ħω.`,
        answer: twoD
          ? '|0,2⟩: two nodal lines in each direction... precisely nₓ+n_y = 2 gives 2+2 = 4 zeros counted over both axes (each |n⟩ has n nodes), and E = (0+2+1)ħω = 3 ħω — the same shell as |2,0⟩ and |1,1⟩. With mix2D = 1 you see the degenerate partner interfere, which is only possible because they are exactly degenerate.'
          : `n = ${Math.min(MAX_LEVELS - 1, 12)} gives ${Math.min(MAX_LEVELS - 1, 12) + 1} lobes and ${Math.min(MAX_LEVELS - 1, 12)} nodes; A = √(2·${Math.min(MAX_LEVELS - 1, 12) + 0.5})/${omega.toFixed(2)} = ${(turningAmplitude(Math.min(MAX_LEVELS - 1, 12) + 0.5, omega)).toFixed(3)} ℓ. Push the exposure slider to see the fringes crowd towards ±A exactly as P_cl does.`,
        paramKey: twoD ? 'ny2' : 'levels',
      },
      {
        question: `With the coherent state switched on, set |α| = 2 (Re α = 2, Im α = 0) and ω = ${omega.toFixed(2)}. What amplitude does ⟨x⟩ swing through, and what does the phase-space plot trace?`,
        hint: '⟨x⟩ = √(2/ω)|α|cos(ωt). Because Δx = 1/√ω is independent of α, the packet stays as compact as the ground state while its centre moves.',
        answer: `Amplitude √(2/ω)·|α| = √(2/${omega.toFixed(2)})·2 = ${(Math.sqrt(2 / omega) * 2).toFixed(4)} ℓ (√2·2 = 2.828 ℓ at ω = 1). In phase space (⟨x⟩,⟨p⟩) traces a circle of radius √2|α| = ${(Math.sqrt(2) * 2).toFixed(3)} in x-units — equivalently |α| = 2 in the rescaled (a,a†) plane — at exactly the classical frequency ω, with ΔxΔp pinned at 0.500 ħ the whole way round.`,
        paramKey: 'alphaRe',
      },
    ],
  };
}
