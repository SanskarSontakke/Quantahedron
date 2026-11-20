import {
  atomicLimitHa,
  auToPm,
  bondOrder,
  h2Estimate,
  h2PlusMorse,
  haToEv,
  lcaoEquilibrium,
  moAssignment,
  moState,
  overlap1s,
  potentialCurve,
  haToCm,
  type AOKind,
  type ComboKind,
  type LcaoOptions,
} from '@/engine/physics/lcao';
import type { SimParams, SimMathContent, TelemetryItem } from '@/simulations/types';

/* ----------------------------- param readers ----------------------------- */

export const aoOf = (p: SimParams): AOKind => {
  const v = typeof p.ao === 'string' ? p.ao : '1s';
  return v === '2pz' || v === '2px' ? v : '1s';
};
export const comboOf = (p: SimParams): ComboKind => (p.combo === 'antibonding' ? 'antibonding' : 'bonding');
export const zetaModeOf = (p: SimParams): 'bare' | 'variational' =>
  p.zetaMode === 'bare' ? 'bare' : 'variational';
export const optionsOf = (p: SimParams): LcaoOptions => ({
  combo: comboOf(p),
  zetaMode: zetaModeOf(p),
});
export const rOf = (p: SimParams): number => Math.min(12, Math.max(0.4, Number(p.R) || 2));
export const zOf = (p: SimParams): number => Math.min(4, Math.max(1, Math.round(Number(p.Z) || 1)));

const num = (v: number, d = 4) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/** Equilibrium constants are R-independent, so a tiny memo keeps telemetry cheap. */
const EQ_CACHE = new Map<string, ReturnType<typeof lcaoEquilibrium>>();
export function equilibriumOf(p: SimParams) {
  const key = `${aoOf(p)}|${zOf(p)}|${comboOf(p)}|${zetaModeOf(p)}`;
  const hit = EQ_CACHE.get(key);
  if (hit) return hit;
  const eq = lcaoEquilibrium(aoOf(p), zOf(p), {
    ...optionsOf(p),
    samples: 88,
    rMin: 0.5,
    rMax: aoOf(p) === '1s' ? 11 : 14,
  });
  EQ_CACHE.set(key, eq);
  return eq;
}

/**
 * J_σσ for the two-electron note. The multipole sum is O(L·n²), so it is cached on a
 * coarse 0.25 a₀ grid instead of running inside the demo loop.
 */
const J_CACHE = new Map<string, { J: number; U: number; De: number }>();
export function h2Of(p: SimParams) {
  const kind = aoOf(p);
  const Z = zOf(p);
  const combo = comboOf(p);
  const R = Math.round(rOf(p) * 4) / 4;
  const key = `${kind}|${Z}|${combo}|${zetaModeOf(p)}|${R}`;
  const hit = J_CACHE.get(key);
  if (hit) return hit;
  const est = h2Estimate(kind, R, Z, { combo, zetaMode: zetaModeOf(p) });
  const out = { J: est.J, U: est.U, De: est.De };
  if (J_CACHE.size > 512) J_CACHE.clear();
  J_CACHE.set(key, out);
  return out;
}

/** Curve sampled once per (basis, Z, combo, mode) — shared by the plot and the drawer. */
const CURVE_CACHE = new Map<string, ReturnType<typeof potentialCurve>>();
export function curveOf(p: SimParams, combo: ComboKind = comboOf(p)) {
  const kind = aoOf(p);
  const Z = zOf(p);
  const key = `${kind}|${Z}|${combo}|${zetaModeOf(p)}`;
  const hit = CURVE_CACHE.get(key);
  if (hit) return hit;
  const curve = potentialCurve(kind, Z, {
    combo,
    zetaMode: zetaModeOf(p),
    samples: 92,
    rMin: 0.4,
    rMax: 12,
  });
  CURVE_CACHE.set(key, curve);
  return curve;
}

/* ------------------------------- telemetry ------------------------------- */

export function molecularTelemetry(p: SimParams): TelemetryItem[] {
  const kind = aoOf(p);
  const combo = comboOf(p);
  const Z = zOf(p);
  const R = rOf(p);
  const opts = optionsOf(p);

  const st = moState(kind, R, Z, opts);
  const partner = moState(kind, R, Z, { ...opts, combo: combo === 'bonding' ? 'antibonding' : 'bonding' });
  const assign = moAssignment(kind, combo);
  const eq = equilibriumOf(p);
  const vnn = st.Vnn;
  const h2 = kind === '1s' && Z === 1 ? h2Of(p) : null;

  const one = 1; // single electron in the displayed MO
  const bo = bondOrder(combo === 'bonding' ? one : 0, combo === 'antibonding' ? one : 0);

  return [
    {
      label: 'Orbital',
      value: assign.label,
      hint: `${assign.state} · ${assign.parity === 'g' ? 'gerade' : 'ungerade'} · ${assign.symmetry}`,
      tone: 'accent',
    },
    {
      label: 'Bond length R',
      value: `${R.toFixed(3)} a₀`,
      hint: `${auToPm(R).toFixed(1)} pm`,
    },
    {
      label: 'Overlap S(R)',
      value: num(st.S, 4),
      hint: kind === '1s' ? `e^−ζR(1+ζR+(ζR)²/3) = ${num(overlap1s(R, st.zeta), 4)}` : 'two-centre quadrature',
      tone: st.S > 0.6 ? 'warn' : 'default',
    },
    {
      label: `E${assign.starred ? '₋' : '₊'}(R) shown`,
      value: `${num(st.Eel, 5)} Ha`,
      hint: `${num(haToEv(st.Eel), 4)} eV · total U = ${num(st.U, 5)} Ha`,
      tone: st.U < atomicLimitHa(kind, Z) ? 'good' : 'warn',
    },
    {
      label: 'Partner level E∓',
      value: `${num(partner.Eel, 5)} Ha`,
      hint: `${num(haToEv(partner.Eel), 3)} eV · Δ = ${num(Math.abs(partner.Eel - st.Eel), 4)} Ha`,
    },
    {
      label: 'Bond order',
      value: bo.toFixed(1),
      hint: bo > 0 ? 'net bonding — a stable molecule is possible' : 'zero — no net bond, the pair flies apart',
      tone: bo > 0 ? 'good' : 'warn',
    },
    {
      label: '⟨V_en⟩ / ⟨V_nn⟩',
      value: `${num(st.Ven, 4)} / ${num(vnn, 4)} Ha`,
      hint: `⟨T⟩ = ${num(st.T, 4)} Ha · virial 2T+V = ${num(2 * st.T + st.Ven + vnn, 4)}`,
    },
    {
      label: '⟨V_ee⟩',
      value: '0.0000 Ha',
      hint: h2
        ? `H₂⁺ has one electron; a closed-shell H₂ in this σ² would add J_σσ = ${num(h2.J, 4)} Ha`
        : 'one-electron ion — no electron–electron term',
    },
    {
      label: 'Equilibrium R₀',
      value: eq.bound ? `${num(eq.Re, 3)} a₀` : 'none',
      hint: eq.bound ? `${auToPm(eq.Re).toFixed(1)} pm · ℏω ≈ ${num(haToCm(eq.hw), 0)} cm⁻¹` : 'curve is repulsive',
      tone: eq.bound ? 'default' : 'warn',
    },
    {
      label: 'Well depth Dₑ',
      value: eq.bound ? `${num(eq.De, 5)} Ha` : '—',
      hint: eq.bound ? `${num(haToEv(eq.De), 3)} eV vs H₂⁺ exact 0.10263 Ha` : '—',
      tone: eq.De > 0.09 ? 'good' : 'default',
    },
    {
      label: 'AO exponent ζ',
      value: num(st.zeta, 4),
      hint: zetaModeOf(p) === 'bare' ? 'ζ = Z (crude curve)' : `variational optimum at this R`,
    },
  ];
}

/* -------------------------------- math tab ------------------------------- */

export function molecularMath(p: SimParams): SimMathContent {
  const kind = aoOf(p);
  const combo = comboOf(p);
  const Z = zOf(p);
  const R = rOf(p);
  const st = moState(kind, R, Z, optionsOf(p));
  const assign = moAssignment(kind, combo);
  const eq = equilibriumOf(p);
  const mr = h2PlusMorse();
  const s = (st.zeta * R).toFixed(3);
  const phiTex = kind === '1s' ? '1s' : kind === '2pz' ? '2p_z' : '2p_x';
  const nodeText =
    assign.nodeGeometry === 'none'
      ? 'no node between the nuclei — density is piled into the bonding region'
      : assign.nodeGeometry === 'between-nuclei'
        ? 'one nodal plane at the bond midpoint (z = 0)'
        : 'one nodal plane containing the bond axis (x = 0), inherited from the 2p_x lobes';

  return {
    formula: [
      {
        tex: `\\psi_{\\pm}(\\mathbf r)=N_{\\pm}\\big[\\phi_{${phiTex}}(\\mathbf r-\\mathbf R_A)\\ \\pm\\ \\phi_{${phiTex}}(\\mathbf r-\\mathbf R_B)\\big]`,
        display: true,
        note: 'the LCAO ansatz: a molecular orbital is a superposition of atomic orbitals',
      },
      {
        tex: String.raw`N_{\pm}=\frac{1}{\sqrt{2\big(1\pm S(R)\big)}},\qquad S(R)=\langle\phi_A\,|\,\phi_B\rangle=${num(st.S, 4)}`,
        display: true,
        note: `overlap of the two hydrogenic AOs at R = ${R.toFixed(2)} a₀, ζ = ${num(st.zeta, 3)}`,
      },
      {
        tex: String.raw`S(R)=e^{-s}\!\left(1+s+\tfrac{s^{2}}{3}\right),\quad s=\zeta R=${s}`,
        display: true,
        note: 'closed form for the 1sσ (2pσ / 2pπ use the same prolate-spheroidal quadrature)',
      },
      {
        tex: String.raw`E_{\pm}(R)=\frac{H_{AA}\pm H_{AB}}{1\pm S(R)},\qquad H_{AB}=\varepsilon S+(\zeta-2Z)I`,
        display: true,
        note: `2×2 secular determinant; here E${assign.starred ? '₋' : '₊'} = ${num(st.Eel, 5)} Ha`,
      },
      {
        tex: String.raw`U(R)=E_{\pm}(R)+\frac{Z^{2}}{R},\qquad V_{\mathrm{Morse}}(R)=D_{e}\Big(1-e^{-a(R-R_{0})}\Big)^{2}-D_{e}`,
        display: true,
        note: `Morse model: Dₑ = ${mr.De.toFixed(5)} Ha, R₀ = ${mr.Re.toFixed(4)} a₀, a = ${mr.a.toFixed(4)} a₀⁻¹`,
      },
    ],
    readout: [
      { label: 'state', value: `${assign.label} (${assign.state})` },
      { label: 'parity', value: assign.parity === 'g' ? 'gerade (+)' : 'ungerade (−)' },
      { label: 'symmetry', value: assign.symmetry === 'sigma' ? 'σ — cylindrical about the axis' : 'π — one nodal plane through the axis' },
      { label: 'nodes', value: nodeText },
      { label: 'N±', value: num(st.N, 4) },
      { label: 'atomic limit', value: `${atomicLimitHa(kind, Z).toFixed(3)} Ha (two separated H-like atoms)` },
    ],
    phaseLegend:
      'Warm lobes carry ψ > 0, cool lobes ψ < 0 — the two signs of the same real orbital, not two different quantities. Where the two colours meet, ψ = 0 and |ψ|² has a node. Monochrome mode drops the sign and maps brightness onto |ψ|² alone.',
    intuition: `Bonding is arithmetic on amplitudes, not on densities. Two hydrogen 1s orbitals are each positive everywhere, so adding them **between** the nuclei makes the amplitude larger there: the electron is pulled into the region that attracts both protons, ⟨V_en⟩ drops by more than ⟨T⟩ rises, and the pair sits in a shallow energy valley.

Subtracting them is the mirror image. $\\psi_-=\\phi_A-\\phi_B$ must vanish where $\\phi_A=\\phi_B$, i.e. on the midpoint plane — a node. Pushing the density out of the bonding region costs kinetic energy (curvature) *and* lets the two protons see each other more strongly, so $E_-$ lands above the separated-atom limit: the state is repulsive and $\\mathrm{H}_2^+$ simply falls apart. That single sign flip is the whole of σ vs σ*.

Notice the asymmetry in the plot: the antibonding level is pushed up by roughly three times as much as the bonding level is pulled down. Put one electron in each and the bond order is 0 — the pair is not bound, because antibonding wins. This is why He$_2$ does not exist while He$_2^+$ does.

The potential-energy curve is the *same* physics plotted against R. At large R the overlap $S\\to 0$ and both levels collapse onto the atomic limit; at small R the $Z^2/R$ term diverges and repulsion takes over. In between, the competition carves the minimum at $R_0\\approx 2\\,a_0$ — about 106 pm, the textbook H₂⁺ bond length.`,
    derivation: [
      {
        title: '1 · The LCAO ansatz',
        steps: [
          {
            text: 'Take two hydrogenic AOs of exponent ζ on nuclei at z = ∓R/2 and build the parity-adapted trial state. Because the exact H₂⁺ orbitals are eigenstates of inversion, only the symmetric/antisymmetric combinations can be stationary:',
            math: [
              {
                tex: String.raw`\psi_{\pm}=N_{\pm}(\phi_A\pm\phi_B),\qquad \phi_{1s}(\mathbf r)=\sqrt{\tfrac{\zeta^{3}}{\pi}}\,e^{-\zeta r}`,
                display: true,
              },
            ],
          },
          {
            text: 'Normalising ⟨ψ|ψ⟩ = 1 introduces the overlap integral S, since the cross term ⟨A|B⟩ does not vanish when the clouds interpenetrate:',
            math: [
              {
                tex: String.raw`1=N_{\pm}^{2}\big(\underbrace{\langle A|A\rangle}_{1}+\underbrace{\langle B|B\rangle}_{1}\pm2\underbrace{\langle A|B\rangle}_{S}\big)\;\Rightarrow\;N_{\pm}=\big[2(1\pm S)\big]^{-1/2}`,
                display: true,
              },
            ],
          },
        ],
      },
      {
        title: '2 · Variational 2×2 secular problem',
        steps: [
          {
            text: 'Insert ψ into the Rayleigh quotient E = ⟨ψ|Ĥ|ψ⟩/⟨ψ|ψ⟩ with Ĥ = −½∇² − Z/r_A − Z/r_B. Writing H_AA = ⟨A|Ĥ|A⟩ and H_AB = ⟨A|Ĥ|B⟩, the quotient becomes',
            math: [
              {
                tex: String.raw`E_{\pm}=\frac{H_{AA}\pm H_{AB}}{1\pm S}`,
                display: true,
              },
            ],
          },
          {
            text: 'Equivalently: expand ψ = c_A φ_A + c_B φ_B and demand stationarity in c_A, c_B. The determinant must vanish,',
            math: [
              {
                tex: String.raw`\begin{vmatrix}H_{AA}-E & H_{AB}-ES\\ H_{AB}-ES & H_{AA}-E\end{vmatrix}=0\;\Rightarrow\;(H_{AA}-E)^{2}-(H_{AB}-ES)^{2}=0`,
                display: true,
                note: 'the two roots are exactly E± above, with c_B = ±c_A — the parity is forced by the algebra',
              },
            ],
          },
          {
            text: 'Because each AO is an exact eigenfunction of its own one-centre Hamiltonian, (−½∇² − ζ/r_A)φ_A = εφ_A with ε = −ζ²/2 (1s) or −ζ²/8 (2p), the matrix elements collapse onto three radial integrals only:',
            math: [
              {
                tex: String.raw`H_{AA}=\tfrac{\zeta^{2}}{2}-Z\zeta-ZJ',\qquad H_{AB}=\varepsilon S+(\zeta-2Z)I`,
                display: true,
                note: `J' = ⟨A|1/r_B|A⟩ (Coulomb), I = ⟨A|1/r_A|B⟩ = ⟨A|1/r_B|B⟩ (resonance, equal by A↔B inversion)`,
              },
            ],
          },
        ],
      },
      {
        title: '3 · The overlap integral in closed form',
        steps: [
          {
            text: 'S(R) = ⟨φ_A|φ_B⟩ is a two-centre integral. In prolate spheroidal coordinates ξ = (r_A + r_B)/R ∈ [1,∞), η = (r_A − r_B)/R ∈ [−1,1], dτ = (R³/8)(ξ² − η²)dξ dη dφ, the 1s product is a pure polynomial times e^{−ζRξ}, and both integrals are elementary:',
            math: [
              {
                tex: String.raw`S(R)=e^{-s}\Big(1+s+\tfrac{s^{2}}{3}\Big),\quad J'=\tfrac{1}{R}\big[1-e^{-2s}(1+s)\big],\quad I=\zeta e^{-s}(1+s),\quad s=\zeta R`,
                display: true,
              },
            ],
          },
          {
            text: `At the default geometry the same quadrature the shader mirrors gives S(${R.toFixed(2)} a₀) = ${num(st.S, 6)} for ζ = ${num(st.zeta, 3)}; for ζ = 1 and R = 2 a₀ it is e^{−2}(1+2+4/3) = 0.586453 — the clouds already overlap by more than half.`,
          },
          {
            text: 'Adding the internuclear repulsion turns the electronic level into an observable curve, and the Morse form is the analytic stand-in that reproduces its well without a quadrature:',
            math: [
              {
                tex: String.raw`U(R)=E_{\pm}(R)+\frac{Z^{2}}{R},\qquad V(R)=D_{e}\big(1-e^{-a(R-R_{0})}\big)^{2}-D_{e}`,
                display: true,
                note: `a = \\hbar\\omega\\sqrt{\\mu/2D_e} = ${mr.a.toFixed(4)} a₀⁻¹ from the observed ℏω = 0.01044 Ha`,
              },
            ],
          },
        ],
      },
      {
        title: '4 · Bond order and why the node costs energy',
        steps: [
          {
            text: 'Bond order counts paired electrons in bonding minus antibonding levels. Each electron in ψ₊ adds ½, each in ψ₋ removes ½:',
            math: [
              {
                tex: String.raw`\mathrm{BO}=\tfrac{1}{2}(n_{+}-n_{-})=\tfrac{1}{2}\ \text{for } \mathrm{H}_2^{+},\qquad 0\ \text{for } \mathrm{He}_2`,
                display: true,
              },
            ],
          },
          {
            text: 'The node is not a bookkeeping trick — it is a constraint on the wavefunction shape. Across a surface where ψ = 0 the amplitude must change sign, so its second derivative (curvature) is large there, and ⟨T⟩ = ½∫|∇ψ|² rises. Meanwhile the node evacuates the region where *both* nuclei attract, so ⟨V_en⟩ becomes less negative. Both effects push the antisymmetric level up above the symmetric one, which is exactly the splitting you see between the two curves in the stage plot.',
          },
          {
            text: 'Quantitatively, at R = 2 a₀ the splitting is ΔE = 2H_AB/(1−S²) and the antibonding level sits above the atomic limit — a state with no bound region at all, which is why σ* populations dissociate molecules instead of stiffening them.',
          },
        ],
      },
    ],
    challenge: [
      {
        question:
          'Slide R and watch the curve cursor. At what R does the 1sσg (bonding) curve actually bottom out, and how far is that from the minimal-LCAO prediction for the two ζ policies?',
        hint: 'Set curveModel = "LCAO secular E±(R)" and drag R between 1.6 and 2.6 a₀; the telemetry prints R₀ for the current basis. Then flip the exponent policy from variational to bare ζ = Z and re-read it.',
        answer: `With a bare ζ = Z the crude curve minimises at R₀ ≈ 2.495 a₀ with Dₑ ≈ 0.0648 Ha. Re-optimising ζ at every R (single-ζ variational) gives R₀ = ${num(eq.Re, 3)} a₀ and Dₑ = ${num(eq.De, 5)} Ha, and the exact Born–Oppenheimer H₂⁺ result is R₀ = 1.9972 a₀, Dₑ = 0.10263 Ha (−0.602634 Ha total). So the variational LCAO already lands within 0.01 a₀ of the true bond length and recovers ~84 % of the well depth; the missing depth comes from the inflexible single-ζ basis — no s+p hybridisation of the bonding tail — not from a defect of the secular algebra.`,
        paramKey: 'R',
      },
      {
        question:
          'Keep R near R₀ and flip Combination to antibonding. Predict what happens to the electron density between the nuclei, to ⟨T⟩, and to the total energy — then check whether the molecule is still bound before you look at the answer.',
        hint: 'Turn the nodal-plane sheet on so the ψ = 0 surface is visible, and watch the ⟨T⟩ / ⟨V_en⟩ telemetry line as you flip.',
        answer: `A plane node appears at the bond midpoint: |ψ|² is evacuated from exactly the region where the electron could attract both protons. ⟨T⟩ rises because the enforced sign change adds curvature (½∫|∇ψ|²), ⟨V_en⟩ becomes less negative, and the internuclear repulsion is left largely uncompensated. The level moves above the separated-atom limit — bond order 0, no minimum, the curve is purely repulsive. Physically the ion dissociates: σ* is populated, so the bond is cancelled rather than doubled.`,
        paramKey: 'combo',
      },
    ],
  };
}

export function molecularDescribe(p: SimParams): string {
  const kind = aoOf(p);
  const combo = comboOf(p);
  const assign = moAssignment(kind, combo);
  const st = moState(kind, rOf(p), zOf(p), optionsOf(p));
  return `${assign.label} of a Z = ${zOf(p)} pair at R = ${rOf(p).toFixed(2)} a₀ (S = ${num(st.S, 3)}, U = ${num(st.U, 4)} Ha)`;
}
