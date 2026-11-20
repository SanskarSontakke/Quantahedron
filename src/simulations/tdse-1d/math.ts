/**
 * Sim 3 — synchronized math drawer content.
 *
 * Three tabs: intuition, a four-step derivation that ends at the exact statement
 * "the propagator is a Cayley transform, therefore ‖ψ‖ cannot drift", and two
 * challenges whose answers are reachable with the sliders on the left.
 */

import type { SimMathContent, SimParams } from '@/simulations/types';
import { pNum, pStr } from '@/store/useSimStore';
import { BOX_AU, gridNOf } from './model';

export function tdseMath(p: SimParams): SimMathContent {
  const n = gridNOf(p);
  const dx = BOX_AU / n;
  const dt = pNum(p, 'dt', 0.0004);
  const a = dt / (4 * dx * dx); // ℏ = m = 1 ⇒ a = Δt/4dx²  (the CN off-diagonal)
  const k = pNum(p, 'k0', 60) / BOX_AU;
  const sigma = pNum(p, 'sigma', 0.05) * BOX_AU;
  const kind = pStr(p, 'potential', 'double');

  return {
    formula: [
      {
        tex: 'i\\hbar\\,\\partial_t \\psi(x,t) = \\hat H\\psi = \\left[-\\frac{\\hbar^2}{2m}\\partial_x^2 + V(x)\\right]\\psi(x,t)',
        display: true,
        note: 'The equation being integrated, with ℏ = m = 1 on a uniform grid of ' + `${n} cells spanning ${BOX_AU} a.u.`,
      },
      {
        tex: '\\left(1 + \\tfrac{i\\Delta t}{2}\\hat H\\right)\\psi^{n+1} = \\left(1 - \\tfrac{i\\Delta t}{2}\\hat H\\right)\\psi^{n}',
        display: true,
        note: 'Crank–Nicolson: the trapezoidal rule on $\\hat H\\psi$, evaluated at the midpoint $\\tfrac12(\\psi^{n}+\\psi^{n+1})$.',
      },
      {
        tex: `U_{\\mathrm{CN}} = \\left(\\hat 1 + \\tfrac{i\\Delta t}{2}\\hat H\\right)^{-1}\\left(\\hat 1 - \\tfrac{i\\Delta t}{2}\\hat H\\right) = \\frac{1 - i\\Delta t\\hat H/2}{1 + i\\Delta t\\hat H/2} \\xrightarrow{\\;\\Delta t\\to 0\\;} e^{-i\\Delta t\\hat H}`,
        display: true,
        note: 'The Cayley ([1/1] Padé) form of the exponential — a rational function of $\\hat H$, not a truncated series.',
      },
      {
        tex: 'r_j = i\\,a\\,\\psi^{n}_{j-1} + \\bigl(1 - i(2a + b_j)\\bigr)\\psi^{n}_{j} + i\\,a\\,\\psi^{n}_{j+1},\\qquad a = \\frac{\\hbar\\,\\Delta t}{4m\\,\\Delta x^2},\\quad b_j = \\frac{\\Delta t\\,V_j}{2\\hbar}',
        display: true,
        note: `Explicit right-hand side built from $\\psi^{n}$ ($a = ${a.toExponential(2)}$, $b_j = \\Delta t\\,V_j/2\\hbar$). Missing neighbours are dropped at the ends — that *is* the Dirichlet wall $\\psi = 0$.`,
      },
      {
        tex: `\\begin{bmatrix} d_0 & c_0 & & \\\\ b_0 & d_1 & c_1 & \\\\ & \\ddots & \\ddots & \\ddots \\\\ && b_{N-2} & d_{N-1} \\end{bmatrix} \\begin{bmatrix} \\psi^{n+1}_0 \\\\ \\psi^{n+1}_1 \\\\ \\vdots \\\\ \\psi^{n+1}_{N-1} \\end{bmatrix} = \\begin{bmatrix} r_0 \\\\ r_1 \\\\ \\vdots \\\\ r_{N-1} \\end{bmatrix}, \\qquad \\begin{aligned} d_j &= 1 + i\\,(2a + b_j) \\\\ b_j = c_j &= -\\,i\\,a \\end{aligned}`,
        display: true,
        note: 'Tridiagonal (banded) system: one forward elimination plus one back substitution, $O(N)$. No pivoting is ever needed because $|d_j| = \\sqrt{1 + (2a + b_j)^2} > 2a = |b_j| + |c_j|$ in every row — strict diagonal dominance.',
      },
      {
        tex: '\\psi \\;\\leftarrow\\; e^{-\\Delta t\\,W(x)/\\hbar}\\,\\psi, \\qquad W(x) = W_0\\left(\\frac{x - x_{\\text{edge}}}{L_{\\text{sponge}}}\\right)^{2}\\Theta(|x| - x_{\\text{edge}})',
        display: true,
        note: 'Complex absorbing potential: the missing $-iW$ term makes $\\hat H$ non-Hermitian only inside the sponge, so outgoing norm decays instead of reflecting.',
      },
      {
        tex: '\\|\\psi\\|^2 = \\sum_j |\\psi_j|^2\\,\\Delta x, \\qquad \\langle \\hat O \\rangle = \\frac{\\sum_j \\psi_j^{*}\\,(\\hat O\\psi)_j\\,\\Delta x}{\\sum_j |\\psi_j|^2\\,\\Delta x}',
        display: true,
        note: 'The discrete inner product every diagnostic in this sim uses.',
      },
    ],
    readout: [
      { label: 'grid', value: `N = ${n},  Δx = ${dx.toFixed(4)} a.u.` },
      { label: 'time step', value: `Δt = ${dt.toExponential(2)} a.u.` },
      { label: 'CFL-like ratio', value: `Δt/Δx² = ${(dt / (dx * dx)).toFixed(3)}` },
      { label: 'packet', value: `k = ${k.toFixed(3)}, σ₀ = ${sigma.toFixed(3)} a.u.` },
      { label: 'potential', value: kind },
      { label: 'off-diagonal', value: `a = ħΔt/4mΔx² = ${a.toExponential(3)}` },
    ],
    phaseLegend:
      'In |ψ|² view the hue is arg ψ on the cyclic twilight wheel and the brightness is |ψ|² itself, so a bright band is always real probability. A standing eigenstate is a single hue (its phase is time-independent up to e^{-iEt}); a travelling packet sweeps the whole wheel. Re/Im view drops colour entirely: cyan is Re ψ, rose is Im ψ, the faint curve is |ψ|².',
    intuition:
      'The wavefunction is a complex field on a line, and the Schrödinger equation is a *rotation*, not a diffusion. Where a heat equation flattens peaks, $i\\partial_t\\psi = -\\partial_x^2\\psi$ makes the local phase velocity proportional to the local curvature, so a bump shears into ripples and spreads — but the total area under $|\\psi|^2$ is a conserved invariant of the flow, exactly as energy is conserved by a frictionless pendulum. That is the whole reason this simulation insists on a unitary integrator: any scheme that lets $\\|\\psi\\|$ move is not a slightly wrong Schrödinger equation, it is a different (non-conservative) PDE. Crank–Nicolson rotates each Fourier mode by precisely its own $\\tan$-half-angle instead of its true angle $E\\Delta t$: the phase is wrong at third order in $\\Delta t$, the modulus is exactly 1 at every order, for every timestep, forever. Watch the drift read-out: $|\\Delta\\|\\psi\\||$ sits at $10^{-13}$ after tens of thousands of steps, which is round-off, not error. Everything you can see here — tunneling through a barrier into a neighbouring well, the quantised ladder, the band structure of a Kronig–Penney crystal — is the same twelve lines of Thomas algorithm applied to the same $3\\times 3$ stencil.',
    derivation: [
      {
        title: 'From the PDE to a matrix ODE',
        steps: [
          {
            text: 'Separate the operator: assume a stationary state $\\psi(x,t)=\\phi(x)e^{-iEt/\\hbar}$. Substituting into the TDSE kills the time dependence and leaves the eigenvalue problem $\\hat H\\phi = E\\phi$. Quantisation is therefore *not an assumption* — it is what a bounded solution of a self-adjoint $\\hat H$ can do.',
          },
          {
            text: 'Discretise space on $x_j = -L/2 + (j+\\tfrac12)\\Delta x$. The second derivative becomes the three-point stencil $\\partial_x^2\\psi|_j \\approx (\\psi_{j-1} - 2\\psi_j + \\psi_{j+1})/\\Delta x^2$, so $\\hat H$ is a real symmetric **tridiagonal** matrix with',
            math: [
              {
                tex: 'H_{jj} = \\frac{\\hbar^2}{m\\,\\Delta x^2} + V_j, \\qquad H_{j,j\\pm1} = -\\frac{\\hbar^2}{2m\\,\\Delta x^2},',
                display: true,
              },
            ],
            note: 'with ℏ = m = 1 the off-diagonal is the constant −1/2Δx². The PDE has become the ODE system $i\\dot{\\psi} = H\\psi$ of size N.',
          },
          {
            text: 'The exact solution of that ODE is $\\psi(t+\\Delta t) = e^{-iH\\Delta t}\\psi(t)$, and $e^{-iH\\Delta t}$ is unitary because $H$ is Hermitian. Any numerical propagator that is *not* unitary is therefore structurally wrong, no matter how small $\\Delta t$ is.',
          },
        ],
      },
      {
        title: 'Crank–Nicolson as the Cayley transform',
        steps: [
          {
            text: 'Integrate over one step with the trapezoidal (implicit midpoint) rule, $\\psi^{n+1} - \\psi^{n} = -i\\frac{\\Delta t}{2}\\left(H\\psi^{n+1} + H\\psi^{n}\\right)$, and collect terms:',
            math: [
              {
                tex: '\\left(\\hat 1 + \\tfrac{i\\Delta t}{2}H\\right)\\psi^{n+1} = \\left(\\hat 1 - \\tfrac{i\\Delta t}{2}H\\right)\\psi^{n}',
                display: true,
              },
            ],
          },
          {
            text: 'Because $H$ is Hermitian, the two factors are adjoints of each other and the propagator obeys',
            math: [
              {
                tex: 'U^{\\dagger}U = \\left(1 - \\tfrac{i\\tau H}{2}\\right)\\left(1 + \\tfrac{i\\tau H}{2}\\right)^{-1}\\left(1 + \\tfrac{i\\tau H}{2}\\right)^{-\\dagger}\\left(1 - \\tfrac{i\\tau H}{2}\\right)^{\\dagger} = \\hat 1, \\qquad \\tau = \\Delta t,',
                display: true,
              },
            ],
            note: 'the two factors commute (both are polynomials in $H$), so everything cancels exactly. $\\|U\\psi\\| = \\|\\psi\\|$ — **no timestep restriction, no accumulation, to machine precision**.',
          },
          {
            text: 'Diagonalise $H$ formally with eigenvalues $E_k$: each mode is multiplied by $\\mu_k = (1 - i\\tau E_k/2)/(1 + i\\tau E_k/2) = e^{-2i\\arctan(\\tau E_k/2)}$. Every $|\\mu_k| = 1$ (they lie on the unit circle by construction), but the phase is $2\\arctan(\\tau E_k/2)$ instead of $\\tau E_k$. Expanding, $2\\arctan z = 2z - \\tfrac{2}{3}z^3 + \\dots$, so',
            math: [
              { tex: '\\text{phase error per step} = \\frac{\\tau^3 E_k^3}{12} + O(\\tau^5) \\;\\Longrightarrow\\; \\text{second-order accurate in time, unconditionally stable.}', display: false },
            ],
          },
          {
            text: 'Solving the system is where the tridiagonal structure pays: the Thomas algorithm eliminates the sub-diagonal in one forward sweep ($c\'_j = c_j/(d_j - b_jc\'_{j-1})$) and back-substitutes, costing $8N$ flops instead of $N^3/3$. That is why $N = 512$ cells at 60 fps is affordable inside a Web Worker. Here $|d_j| = \\sqrt{1 + (2a + b_j)^2} > 2a = |b_j| + |c_j|$, so the matrix is strictly diagonally dominant and the elimination never needs a pivot.',
          },
        ],
      },
      {
        title: 'Why explicit Euler and leapfrog differ',
        steps: [
          {
            text: 'The naive explicit step $\\psi^{n+1} = (\\hat 1 - i\\tau H)\\psi^{n}$ has amplification factor $|1 - i\\tau E| = \\sqrt{1 + \\tau^2E^2} > 1$ for **every** non-zero mode. The norm grows monotonically, like $\\prod_k\\sqrt{1+\\tau^2E_k^2}$ per step, and since the lattice kinetic operator reaches $E_{\\max} = 2/\\Delta x^2$ the fastest modes blow up first.',
            math: [
              { tex: '\\|\\psi^{n}\\| \\sim \\left(1 + \\tfrac{\\tau^2E_{\\max}^2}{2}\\right)^{n/2} \\xrightarrow[n\\to\\infty]{} \\infty', display: true },
            ],
            note: 'nothing about this is a "timestep too large" accident: explicit Euler for a purely imaginary spectrum is unconditionally *unstable*. Halving Δt only halves the growth rate.',
          },
          {
            text: 'Runge–Kutta 4 fixes stability only up to $\\tau E \\lesssim 2\\sqrt{2}$, so it needs $\\Delta t \\lesssim \\Delta x^2$ — the diffusive-style restriction that makes an explicit PDE solver useless here, since $\\Delta x^2$ shrinks fourfold when you double $N$. Crank–Nicolson has no restriction at all, and its only cost is solving one banded system per step.',
          },
          {
            text: 'Symplectic/leapfrog schemes and CN all keep $|\\mu| = 1$; they differ in the phase polynomial. CN is the unique second-order, one-step, A-stable, time-reversible choice with a *tridiagonal* implicit operator — exactly the structure the second derivative provides.',
          },
        ],
      },
      {
        title: 'Measurement, sponge and the spectrum you see',
        steps: [
          {
            text: 'Expanding the state in the exact eigenvectors of the *discrete* Hamiltonian, $\\psi^n = \\sum_k c_k\\phi_k$, gives $c_k(t) = c_k(0)e^{-i\\theta_k t}$ with $\\theta_k = 2\\arctan(\\tau E_k/2)/\\Delta t$. The occupation $|c_k|^2 = |\\langle \\phi_k|\\psi\\rangle|^2$ is therefore constant in time for a fixed $V(x)$ — which is precisely what the spectrum view plots, and why the bars stop moving once you stop editing.',
          },
          {
            text: 'The levels themselves come from diagonalising the same tridiagonal $H$: Sturm bisection counts eigenvalues below a trial $x$ using Sylvester\'s inertia law on the recurrence $\\theta_j = d_j - x - e_{j-1}^2/\\theta_{j-1}$, then inverse iteration extracts each eigenvector. Cost is $O(N)$ per count, $O(N)$ per vector — no dense matrix is ever formed.',
          },
          {
            text: 'Finally the sponge. Adding $-iW(x)$ makes $\\hat H$ non-Hermitian in the boundary layers, and the norm evolution becomes',
            math: [
              { tex: '\\frac{d}{dt}\\|\\psi\\|^2 = -\\,2\\int \\frac{W(x)}{\\hbar}|\\psi|^2\\,dx \\;\\le\\; 0', display: true },
            ],
            note: 'so the open system drains probability exactly where you tell it to. Applied multiplicatively after each unitary step ($\\psi \\leftarrow e^{-\\Delta t W/\\hbar}\\psi$) it cannot corrupt the interior: all the drift you see is physics, and the residual $|\\Delta\\|\\psi\\||$ in the middle of the box is still round-off.',
          },
        ],
      },
    ],
    challenge: [
      {
        question:
          'Set the double well with asymmetry = 0 and launch the packet in the left well. It sloshes to the right and back. Measure the period, then halve the central barrier width and predict the new period before you move the slider.',
        hint: 'Tunneling splitting for a symmetric double well goes like $\\Delta E \\propto e^{-\\kappa\\,\\text{gap}}$ with $\\kappa = \\sqrt{2m(V_0-E)}$, and the sloshing period is $T = 2\\pi\\hbar/\\Delta E$. The exponent, not the prefactor, is what matters.',
        answer:
          'Each halving of the gap multiplies $\\Delta E$ by roughly $e^{\\kappa\\,\\text{gap}/2}$, so the period collapses by the same huge factor. With the defaults ($V_0 = 8$, $E \\approx 8.2$, gap ≈ 2.7 a.u.) you are near $E = V_0$ where $\\kappa$ is small, so the effect is dramatic: the packet crosses in a few time units. Push $k_0$ down (so $E \\ll V_0$) and the same slider move becomes almost invisible — that is exponential sensitivity, the reason STM can image single atoms.',
        paramKey: 'barrierGap',
      },
      {
        question:
          'Switch to the Kronig–Penney lattice, set the packet energy inside the first gap, then sweep the lattice depth from 0 to 30. Which quantity stops changing, and what does the spectrum view tell you about why?',
        hint: 'For a periodic potential the eigenstates are Bloch waves and the eigenvalue *set* organises into bands separated by gaps. Count levels per band as you change the period count instead of the depth.',
        answer:
          'The occupation bars freeze: a state prepared inside a gap has no eigencomponent to oscillate against at that energy, so $|\\psi|^2$ only breathes in place — the wavefunction is localised (evanescent) through the crystal. With $P$ periods the first band holds exactly $P$ levels, so doubling `kronigPeriods` doubles the number of bars below the gap while deepening the lattice only widens the empty region between them.',
        paramKey: 'kronigPeriods',
      },
    ],
  };
}

export default tdseMath;
