/**
 * Physics regression gate (CI).
 *
 * The simulations only mean something if the numbers they print are right, so
 * this script pins the invariants the whole platform is argued from. Everything
 * runs through the same sandbox the contract audit uses, i.e. against the real
 * shipped modules in `src/engine`, not against a reimplementation.
 *
 * Tolerances are what the code achieves today (measured in this repo), so a
 * solver that silently loses unitarity, a closed form that drifts away from the
 * transfer-matrix product, or an SU(2) rotation that forgets the spinor sign
 * flip fails the build instead of printing wrong physics.
 *
 * Exits non-zero if any invariant is violated.
 */
'use strict';
const path = require('path');
const { repoRequire, OUT } = require('./lib/sandbox.cjs');

const eng = (name) => repoRequire(path.join(OUT, 'engine/physics', name + '.js'));
const cn = eng('crankNicolson');
const ss = eng('splitStepFFT');
const hy = eng('hydrogen');
const bl = eng('blochSpin');
const lc = eng('lcao');
const ct = eng('constants');
const dip = repoRequire(path.join(OUT, 'simulations/dipole-transitions/dipole.js'));

let failures = 0;
let checks = 0;
const ok = (label, note, limit, measured) => {
  checks++;
  const pass = Number.isFinite(measured) && measured <= limit;
  if (!pass) failures++;
  console.log(`   ${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(48)} ${measured.toExponential(2).padStart(10)}  ≤ ${limit.toExponential(0).padEnd(7)}  ${note}`);
};

/* deterministic pseudo-random, so a failure is always reproducible */
let seed = 20261121;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const rel = (got, want) => Math.abs(got - want) / Math.abs(want || 1);
const norm2 = (re, im, dx) => re.reduce((s, x, j) => s + x * x + im[j] * im[j], 0) * dx;
const width = (re, im, dx) => {
  let mx = 0;
  let mxx = 0;
  for (let j = 0; j < re.length; j++) {
    const p = (re[j] * re[j] + im[j] * im[j]) * dx;
    const x = (j + 0.5) * dx;
    mx += p * x;
    mxx += p * x * x;
  }
  return Math.sqrt(Math.max(mxx - mx * mx, 0));
};
const cx = ct.cx;

/* ------------------------------------------------------------------ */
console.log('\n1. FFT — in-place radix-2 transform (split-step backbone)');
{
  let worstRoundTrip = 0;
  let worstParseval = 0;
  for (const n of [256, 512, 1024, 2048]) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      re[i] = rnd() * 2 - 1;
      im[i] = rnd() * 2 - 1;
    }
    const re0 = Float64Array.from(re);
    const im0 = Float64Array.from(im);
    let energy = 0;
    for (let i = 0; i < n; i++) energy += re[i] * re[i] + im[i] * im[i];
    ss.fftTransform(re, im, false);
    let power = 0;
    for (let i = 0; i < n; i++) power += re[i] * re[i] + im[i] * im[i];
    worstParseval = Math.max(worstParseval, rel(power, n * energy));
    ss.fftTransform(re, im, true);
    for (let i = 0; i < n; i++) worstRoundTrip = Math.max(worstRoundTrip, Math.abs(re[i] - re0[i]), Math.abs(im[i] - im0[i]));
  }
  ok('max|ψ − FFT⁻¹(FFT ψ)| over N = 256…2048', 'the transform is exactly invertible', 1e-12, worstRoundTrip);
  ok('Parseval: Σ|Ψₖ|² = N·Σ|ψⱼ|²', 'unscaled forward convention', 1e-12, worstParseval);
}

/* ------------------------------------------------------------------ */
console.log('\n2. Rectangular barrier — closed form vs transfer-matrix product');
{
  let worst = 0;
  for (const [v0, a] of [[12, 1.32], [4, 0.8], [20, 0.4], [9, 2.1]]) {
    for (const e of [0.4 * v0, 0.8 * v0, 0.999 * v0, 1.001 * v0, 1.3 * v0, 2.2 * v0]) {
      worst = Math.max(worst, Math.abs(ss.transmissionRectangular(e, v0, a, 1, 1) - ss.transferMatrixTransmission(e, [{ width: a, v: v0 }], 1, 1)));
    }
  }
  ok('|T_closed − T_matrix| over 24 (E, V₀, a) pairs', 'two independent algorithms agree', 1e-9, worst);

  const kappa = ss.evanescentKappa(4, 12, 1, 1);
  ok('κ = √(2m(V₀−E))/ℏ at E = 4, V₀ = 12', 'expected exactly 4 a₀⁻¹', 1e-14, Math.abs(kappa - 4));

  /* deep tunnelling: ln T is linear in the barrier width with slope −2κ */
  const widths = [0.6, 1.2, 1.8, 2.4];
  const ts = widths.map((a) => ss.transmissionRectangular(4, 12, a, 1, 1));
  const n = widths.length;
  const xm = widths.reduce((s, x) => s + x, 0) / n;
  const ym = ts.map((t) => Math.log(t)).reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  widths.forEach((x, i) => {
    num += (x - xm) * (Math.log(ts[i]) - ym);
    den += (x - xm) ** 2;
  });
  const slope = num / den;
  ok('d ln T / da  = −2κ (evanescent decay)', `fitted ${slope.toFixed(4)} vs ${(-2 * kappa).toFixed(4)}`, 0.02, rel(slope, -2 * kappa));

  /* Ramsauer–Townsend: T = 1 above the barrier when k₂·a = π */
  const aRT = 1.32;
  const eRT = 12 + (Math.PI / aRT) ** 2 / 2;
  ok('T = 1 at k₂a = π (Ramsauer–Townsend)', `E = ${eRT.toFixed(4)} a.u. > V₀`, 1e-9, Math.abs(ss.transmissionRectangular(eRT, 12, aRT, 1, 1) - 1));

  /* double barrier: the Fabry–Pérot comb must actually reach unity somewhere
     below the barrier top — a scan, because the resonance position is geometry
     sensitive (the hard-wall estimate π²/2m·gap² is 46 % high here) */
  let bestT = 0;
  let bestE = 0;
  for (let e = 0.05; e < 12; e += 0.005) {
    const t = ss.transmissionDouble(e, 12, 0.6, 1.2, 1, 1);
    if (t > bestT) {
      bestT = t;
      bestE = e;
    }
  }
  ok('double barrier resonates to T = 1 below V₀', `peak T = ${bestT.toFixed(7)} at E = ${bestE.toFixed(3)}`, 1e-5, 1 - bestT);
  ok('and it is a narrow Lorentzian (T drops off away from the peak)', `T(${(bestE + 0.08).toFixed(2)}) = ${(ss.transmissionDouble(bestE + 0.08, 12, 0.6, 1.2, 1, 1)).toFixed(5)}`, 1, ss.transmissionDouble(bestE + 0.08, 12, 0.6, 1.2, 1, 1) < bestT ? 0 : 1);
}

/* ------------------------------------------------------------------ */
console.log('\n3. Crank–Nicolson — unitarity and the absorption ledger');
{
  const n = 512;
  const dx = 48 / n;
  const v = cn.buildPotential('double', { n, V0: 9, wellWidth: 0.62, barrierGap: 0.08, asymmetry: 0.3, kronigPeriods: 7, latticeDepth: 8 });
  const solver = new cn.CrankNicolsonSolver({ n, dx, dt: 4e-4, v });
  const [re, im] = cn.gaussianPacket(n, dx, 12, 1.5, 0.6);
  const p0 = norm2(re, im, dx);
  solver.advance(re, im, 20000);
  ok('‖ψ‖² drift over 20 000 CN steps (double well)', 'the trapezoidal rule is unitary', 1e-8, Math.abs(norm2(re, im, dx) - p0));

  const cap = cn.buildCap(n, 0.07, 0.45);
  const before = norm2(re, im, dx);
  const drained = solver.advance(re, im, 6000, cap);
  const after = norm2(re, im, dx);
  ok('ledger |norm + drained − norm₀| with the CAP on', 'absorbed probability is billed, not lost', 1e-8, Math.abs(after + drained - before));
  ok('CAP is a contraction (0 < drained, after < before)', 'it can only remove norm', 0, drained > 0 && after < before ? 0 : 1);

  const well = cn.buildPotential('finite', { n, V0: 40, wellWidth: 0.5, barrierGap: 0.1, asymmetry: 0, kronigPeriods: 4, latticeDepth: 4 });
  const spec = cn.eigenSpectrum(well, dx, 4);
  const gaps = spec.energies.slice(0, 3).map((e, i) => spec.energies[i + 1] - e);
  ok('Sturm/Jacobi spectrum returns 4 bound states below V₀', `E₀ = ${spec.energies[0].toFixed(4)} Ha`, 0, spec.energies.length === 4 && spec.energies.every((e) => e < 40) ? 0 : 1);
  ok('levels are ordered and non-degenerate', `ΔE = ${gaps.map((g) => g.toFixed(3)).join(', ')}`, 0, gaps.every((g) => g > 1e-9) ? 0 : 1);
}

/* ------------------------------------------------------------------ */
console.log('\n4. Split-step (Strang) — free Gaussian spreading');
{
  const n = 4096;
  const box = 512;
  const dx = box / n;
  const sigma0 = 1.2;
  const dt = 2e-3;
  const prop = new ss.SplitStepPropagator({ n, dx, dt, v: new Float64Array(n) });
  const [re, im] = cn.gaussianPacket(n, dx, box / 2, sigma0, 0);
  const tEnd = 40;
  const steps = Math.round(tEnd / dt);
  let worst = 0;
  let worstNorm = 0;
  for (let s = 1; s <= steps; s++) {
    prop.step(re, im);
    if (s % 4000 === 0 || s === steps) {
      const t = s * dt;
      worst = Math.max(worst, rel(width(re, im, dx), sigma0 * Math.sqrt(1 + (t / (2 * sigma0 * sigma0)) ** 2)));
      worstNorm = Math.max(worstNorm, Math.abs(norm2(re, im, dx) - 1));
    }
  }
  ok('σ(t) vs the free-particle dispersion law (t = 40)', 'σ₀√(1 + (t/2σ₀²)²)', 2e-3, worst);
  ok('unitarity of the Strang split over 20 000 steps', 'exact in the spectral kinetic kick', 1e-8, worstNorm);
  /* σxσp for the vacuum-like Gaussian: ½ exactly, and it grows with time */
  const sx = width(re, im, dx);
  ok('Δx·Δp ≥ ½ after spreading (Δp frozen)', `Δx = ${sx.toFixed(3)} a₀, ΔxΔp = ${(sx / (2 * sigma0)).toFixed(6)}`, 0, sx / (2 * sigma0) >= 0.5 - 1e-9 ? 0 : 1);
}

/* ------------------------------------------------------------------ */
console.log('\n5. Hydrogen — spectrum, node census, radial moments, dipoles');
{
  ok('E₁ = −Z²/2 Ha for Z = 1', '−0.5 Hartree', 1e-15, Math.abs(hy.energyHa(1, 1) + 0.5));
  ok('E₃ = −1/18 Ha (Rydberg)', '−0.0555…', 1e-15, Math.abs(hy.energyHa(3, 1) + 1 / 18));
  ok('E₁(He⁺) = −2 Ha', 'Z² scaling', 1e-15, Math.abs(hy.energyHa(1, 2) + 2));
  ok('1 Ha = 27.211386245988 eV', `HARTREE_EV = ${ct.HARTREE_EV.toFixed(6)}`, 1e-9, rel(ct.HARTREE_EV, 27.211386245988));
  ok('radial nodes = n − ℓ − 1 for (4,1)', '2', 0, Math.abs(hy.radialNodes(4, 1) - 2));
  ok('angular nodes = ℓ for ℓ = 1', '1', 0, Math.abs(hy.angularNodes(1) - 1));
  ok('⟨r⟩₂ₚ = 5 a₀', 'quadrature against (a₀/2Z)(3n²−ℓ(ℓ+1))', 1e-6, Math.abs(hy.rExpectation(2, 1, 1) - 5) / 5);
  ok('⟨r⟩₁ₛ = 1.5 a₀', 'quadrature against 3a₀/2Z', 1e-6, Math.abs(hy.rExpectation(1, 0, 1) - 1.5) / 1.5);
  ok('⟨r⟩₂ₛ = 6 a₀', 'quadrature against 6a₀', 1e-5, Math.abs(hy.rExpectation(2, 0, 1) - 6) / 6);

  let junk = 0;
  for (let i = 0; i < 400; i++) {
    const r = rnd() * 22;
    const th = Math.acos(2 * rnd() - 1);
    const ph = rnd() * 2 * Math.PI;
    for (const [nn, ll] of [[1, 0], [2, 1], [3, 2], [4, 1]]) {
      const mm = Math.floor(rnd() * (2 * ll + 1)) - ll;
      const psi = hy.psiCartesian(nn, ll, mm, r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th), 1);
      if (!(Number.isFinite(psi.re) && Number.isFinite(psi.im))) junk++;
    }
  }
  ok('ψ finite at 1 600 sample points (incl. r → 0, θ = 0)', 'no NaN / Infinity anywhere', 0, junk);

  const allowed = dip.dipoleZ(1, 0, 0, 2, 1, 0, 1);
  ok('⟨2p0|ẑ|1s⟩ = 0.744936 e·a₀', `got ${allowed.d.toFixed(8)}`, 1e-6, rel(Math.abs(allowed.d), 0.74493553));
  const dark2s = dip.dipoleZ(1, 0, 0, 2, 0, 0, 1);
  ok('⟨2s|ẑ|1s⟩ = 0 (parity forbids it)', `|d| = ${Math.abs(dark2s.d).toExponential(2)}`, 1e-8, Math.abs(dark2s.d));
  const darkF = dip.dipoleZ(2, 1, 0, 4, 3, 0, 1);
  ok('⟨4f|ẑ|2p⟩ = 0 (Δℓ = 2 is dark)', `|d| = ${Math.abs(darkF.d).toExponential(2)}`, 1e-8, Math.abs(darkF.d));
  const dmOff = dip.dipoleZ(1, 0, 0, 2, 1, 1, 1);
  ok('⟨2p,m=+1|ẑ|1s⟩ = 0 (ẑ carries Δm = 0)', `|d| = ${Math.abs(dmOff.d).toExponential(2)}`, 1e-8, Math.abs(dmOff.d));
}

/* ------------------------------------------------------------------ */
console.log('\n6. Spin — SU(2), projectors, the Stern–Gerlach chain');
{
  const negI = bl.mat(cx(-1), cx(0), cx(0), cx(-1));
  let worstRot = 0;
  for (let i = 0; i < 200; i++) {
    worstRot = Math.max(worstRot, bl.matDistance(bl.rotationMatrix([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1], 2 * Math.PI), negI));
  }
  ok('R(n̂, 2π) = −I for 200 random axes', 'the spinor sign flip', 1e-12, worstRot);

  let worstProj = 0;
  let worstSum = 0;
  for (let i = 0; i < 200; i++) {
    const ax = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    const s = bl.spinorFromAngles(Math.acos(2 * rnd() - 1), rnd() * 2 * Math.PI);
    const p = bl.projector(ax, 1);
    worstProj = Math.max(worstProj, bl.matDistance(bl.matMul(p, p), p));
    worstSum = Math.max(worstSum, Math.abs(bl.channelProbability(s, ax, 1) + bl.channelProbability(s, ax, -1) - 1));
  }
  ok('P±² = P± (200 random axes)', 'projector idempotence', 1e-12, worstProj);
  ok('P₊ + P₋ = 1 (200 random spinors)', 'completeness of the two channels', 1e-12, worstSum);
  ok('Malus: cos²(90°/2) = 0.5', 'z analyser after an x analyser', 1e-15, Math.abs(bl.malus([0, 0, 1], [1, 0, 0]) - 0.5));
  ok('Malus: 60° → 0.75', 'cos²(30°)', 1e-15, Math.abs(bl.malus([0, 0, 1], [Math.sin(Math.PI / 3), 0, Math.cos(Math.PI / 3)]) - 0.75));

  const afterX = bl.normalizeSpinor(bl.applyMat2(bl.SPIN_UP_Z, bl.projector([1, 0, 0], 1)));
  ok('SG_z → SG_x(+) → SG_z(+) transmits 0.5', 'which-path information erased', 1e-12, Math.abs(bl.channelProbability(afterX, [0, 0, 1], 1) - 0.5));

  const chain = bl.runAnalyzerChain(bl.SPIN_UP_Z, [
    { axis: [0, 0, 1], blockUp: false, blockDown: true },
    { axis: [1, 0, 0], blockUp: false, blockDown: true },
    { axis: [0, 0, 1], blockUp: false, blockDown: true },
  ]);
  const transmitted = chain.rays ? chain.rays.reduce((s, r) => s + r.weight, 0) : chain.transmitted;
  ok('three-magnet chain output = 0.25 of the source', '+z selected, then +x, then +z', 1e-12, Math.abs(transmitted - 0.25));

  const bloch = bl.blochVector(bl.spinorFromAngles(Math.PI / 2, 0));
  ok('|Bloch vector| = 1 for any pure state', `r = ${Math.hypot(...bloch).toFixed(9)}`, 1e-12, Math.abs(Math.hypot(...bloch) - 1));
}

/* ------------------------------------------------------------------ */
console.log('\n7. LCAO / H₂⁺ — overlap integral and the equilibrium bond');
{
  const analytic = (R) => Math.exp(-R) * (1 + R + (R * R) / 3);
  let worstS = 0;
  for (const R of [0.4, 1, 2, 3.7, 6, 12]) worstS = Math.max(worstS, Math.abs(lc.overlap1s(R, 1) - analytic(R)));
  ok('S(R) vs e⁻ᴿ(1+R+R²/3) at 6 separations', 'the 1sσ overlap integral', 1e-14, worstS);
  ok('S(2 a₀) = 0.586453', `got ${lc.overlap1s(2, 1).toFixed(6)}`, 1e-6, Math.abs(lc.overlap1s(2, 1) - 0.586453));
  ok('S(0) = 1 (coincident centres)', 'self-overlap', 1e-15, Math.abs(lc.overlap1s(0, 1) - 1));
  ok('S(40 a₀) → 0 (asymptotic orthogonality)', `${lc.overlap1s(40, 1).toExponential(2)}`, 1e-6, lc.overlap1s(40, 1));

  const eq = lc.lcaoEquilibrium('1s', 1, { combo: 'bonding', zetaMode: 'variational' });
  ok('variational LCAO equilibrium R₀ ≈ 2.006 a₀', `R₀ = ${eq.Re.toFixed(4)} a₀`, 0.06, Math.abs(eq.Re - 2.006));
  ok('LCAO H₂⁺ well depth Dₑ ≈ 0.0865 Ha', `Dₑ = ${eq.De.toFixed(5)} Ha`, 0.004, Math.abs(eq.De - 0.08652));
  ok('the bond is bound (Dₑ > 0)', 'a minimum exists', 0, eq.De > 0 ? 0 : 1);
  const antib = lc.lcaoEquilibrium('1s', 1, { combo: 'antibonding', zetaMode: 'variational' });
  ok('σᵤ* has no well worth naming (< 1 % of σg)', `Dₑ(σᵤ*) = ${antib.De.toExponential(2)} Ha`, 0.01, Math.max(antib.De, 0) / eq.De);
}

/* ------------------------------------------------------------------ */
console.log(`\nphysics checks: ${checks} assertions · ${failures} failures`);
process.exitCode = failures ? 1 : 0;
