# Quantahedron

**Interactive quantum physics, solved in real time — in your browser.**

[![CI](https://github.com/sanskarsontakke/quantahedron/actions/workflows/ci.yml/badge.svg)](https://github.com/sanskarsontakke/quantahedron/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Quantahedron is an open learning platform for quantum and atomic physics. Its homepage is not a
landing page: above the fold sits a live simulation stage running **Orbitalis 3D**, an exact
hydrogenic wavefunction engine (analytical Laguerre/Legendre solutions, volumetric WebGL2
raymarching, measurement-and-collapse sampling, Zeeman and Stark fields, a clickable spectroscopy
ladder). Nine companion simulations cover matter waves, the time-dependent Schrödinger equation,
tunneling, two-path interference, the harmonic oscillator, driven dipole transitions, Stern–Gerlach
spin, LCAO bonding and Fourier-limited uncertainty.

Every state is shareable as a URL, every solver runs on the visitor's own CPU/GPU, and the whole
deployment fits on free-tier static hosting. There is no backend, no database and no server-side
compute.

## The ten simulations

| # | Simulation | Route | Engine | Level | Tours |
| --- | --- | --- | --- | --- | --- |
| 1 | Orbitalis 3D | `/sim/orbitalis-3d` | GLSL WebGL2 raymarcher | Undergraduate | 5 |
| 2 | de Broglie Ring | `/sim/de-broglie-ring` | 2D/3D Canvas phase ring | Foundations | 2 |
| 3 | 1D TDSE Sandbox | `/sim/tdse-1d` | Crank–Nicolson Web Worker | Advanced | 2 |
| 4 | Quantum Tunneling | `/sim/quantum-tunneling` | Split-Step Fourier FFT | Undergraduate | 2 |
| 5 | 2D Double-Slit | `/sim/double-slit-2d` | WebGL2 GPU RK4 shader | Advanced | 2 |
| 6 | Harmonic Oscillator | `/sim/harmonic-oscillator` | Analytical + symplectic GPU | Undergraduate | 2 |
| 7 | Dipole Transitions | `/sim/dipole-transitions` | Driven two-level ODE solver | Advanced | 2 |
| 8 | Stern–Gerlach Spin | `/sim/stern-gerlach-spin` | SU(2) matrices + Three.js | Undergraduate | 2 |
| 9 | Molecular Orbitals | `/sim/molecular-orbitals` | Volumetric GLSL shader | Advanced | 2 |
| 10 | Uncertainty Forge | `/sim/uncertainty-lab` | Real-time 1D FFT dual plot | Foundations | 2 |

Together: 221 inspector controls (127 sliders, 64 toggles, 30 selects), 23 Demo Director tours built
from 176 keyframes, 98 live telemetry rows, 10 synced derivation drawers with 31 worked derivations
and 22 built-in challenges, and 10 extra analysis tabs.

## Architecture

- **Contract-driven simulations.** Each sim in `src/simulations/<slug>/` default-exports a
  `SimModule` (`meta`, `defaultParams`, `controls`, `Canvas`, optional `telemetry`/`math`/`demos`).
  The shell — container, inspector drawer, math drawer, demo overlay — renders that contract, so all
  ten sims get identical ergonomics for free and adding an eleventh means adding one registry entry.
- **Flat scalar state.** All simulation state lives in one Zustand store as `params[slug]`, a flat
  map of `number | string | boolean | number[]`. Nothing physics-relevant lives in component state,
  which is what makes permalinks, demo keyframing and generic reset work for every sim unchanged.
- **The URL is the source of truth.** `src/store/urlState.ts` serialises quantum numbers, phasors,
  render mode and camera orientation into `?sim=&p=&demo=` (numbers keep 12 significant digits, so an
  electron mass of `9.1093837015e-31` round-trips exactly); the container hydrates on mount and writes
  back on a 450 ms debounce. No backend, no database — a link reproduces a state deterministically.
- **GPU bake plus shader phase rotation.** Eigenstates are pre-baked into a compact float texture (or
  passed as uniforms for a single state); during time evolution the fragment shader only rotates each
  component's phase by `e^{-iE_n t}`. No per-pixel Laguerre evaluation on the CPU, which is how the
  flagship holds 60 fps on integrated graphics.
- **Per-slug code splitting.** `registry.ts` holds literal `() => import('./<slug>')` closures, so
  each sim is its own chunk. First visit downloads only Orbitalis 3D; the grid prefetches the rest on
  hover/focus.
- **KaTeX drawer, not images.** `src/lib/math.tsx` renders the live derivation server-side and
  client-side with local KaTeX (no CDN), so formulas stay typographic, selectable and free of layout
  shift, with `$...$` inline math available in prose.
- **Demo director.** Keyframe scripts (`at`, `caption`, `params`) interpolate numbers and switch
  discrete values; touching any control interrupts the tour and offers a resume pill, and
  `prefers-reduced-motion` starts tours paused.
- **Capability probe over device guessing.** `detectGpu()` runs once at container mount and picks the
  quality tier, with a low-power renderer path when WebGL2 or float textures are unavailable.
- **Static-first routing.** `/`, `/sim/[slug]` (10 slugs) and `/learn`, `/learn/[topic]` (6 topics)
  prerender; OG cards for the sim routes are generated at build via `generateStaticParams`, so
  nothing but the image build costs server time. Unlisted slugs and topics use
  `dynamicParams = false` and return a real HTTP 404.
- **Design tokens, not ad-hoc styling.** One `@theme` block in `src/app/globals.css` defines the
  Observatory Glass palette, and accessibility variants (cividis phase palette, high-contrast light
  lab) are attribute switches on `<html>` driven by persisted preferences.

## Checks

Four gates — lint, types, the headless harnesses, the production build — all runnable locally and
all wired into CI:

```bash
npm run lint       # eslint . — next/core-web-vitals + next/typescript, zero warnings allowed
npm run typecheck  # tsc --noEmit — strict, plus noUnusedLocals / noUnusedParameters
npm run verify     # the three headless harnesses below
npm run build      # production build; npm run start serves it on :3000
npm run format     # prettier --write over src
```

`npm run verify` chains three Node scripts in `scripts/`. Each exits non-zero on the first failure,
so they work as CI steps and as a pre-commit sanity pass. They load the real TypeScript sources
through a CommonJS sandbox (`scripts/lib/sandbox.cjs` transpiles `src/**` on the fly and stubs
`next/navigation`, `next/dynamic` and CSS), so the checks exercise the shipped modules rather than a
copy of their logic.

| Script | What it proves |
| --- | --- |
| `scripts/audit-contracts.cjs` | For all ten sims: registry `meta`/`defaultParams` match the module byte-for-byte; every control has a default and every default has a control; slider ranges contain their default; `telemetry`, `math` and `describe` run without throwing across sampled control variants; every TeX span compiles under KaTeX (`throwOnError`) and renders; demo keyframes are time-ordered, in-range, and only reference real param keys; extra-tab ids and labels are unique. Currently 15,874 TeX spans, 0 problems. |
| `scripts/url-roundtrip.cjs` | `?sim=&p=&demo=` encodes and decodes losslessly — 150 cases over scalars, arrays, booleans, extreme exponents and camera quaternions — and canonicalises key order so the same state always produces the same URL. |
| `scripts/physics-checks.cjs` | 46 numeric regression assertions against the actual solvers: Crank–Nicolson unitarity (`‖ψ‖²` drift ≤ 1e-11 over 20,000 steps) and CAP absorption ledger, split-step FFT round-trip and Parseval identity, free-packet spreading against the analytic σ(t), rectangular-barrier `T(E)` closed-form vs transfer-matrix (≤ 5e-16), the `d ln T/da = -2κ` tunnelling slope, Ramsauer–Townsend and double-barrier resonance peaks, exact hydrogenic energies and `<r>` expectation values, dipole selection rules (forbidden elements are zero to 1e-8), SU(2) spinor norms, projector idempotence, 2π rotation = `-I`, Malus' law, the Stern–Gerlach chain, and the LCAO overlap integral `e^{-R}(1+R+R²/3)` with its equilibrium bond length and depth. |

The `build` job in CI does one more thing: it runs `npm run build`, serves the result with
`next start`, then probes every URL in the generated `sitemap.xml` plus the OG images, asserts
`/sim/does-not-exist` and `/learn/does-not-exist` are 404, and fails if any page leaks the internal
codename or fails to name Quantahedron.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, on every pull request targeting `main`, and
on manual dispatch.

- **quality** — Node 20.x and 22.x in parallel: `npm ci`, lint, typecheck, `npm run verify`.
- **build** — Node 22.x: `npm run build`, then the live route probe above, with the `next start` log
  uploaded as an artifact on failure.

Both jobs use `concurrency` with `cancel-in-progress`, so a burst of pushes does not queue stale
runs. To make them blocking, enable branch protection on `main` and require the `quality` and
`build` checks.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run start      # serve the production build
```

Node 20 or newer is required (Next 15).

## Keyboard and accessibility

| Key | Action |
| --- | --- |
| `Space` | Play / pause time evolution |
| `R` | Reset the camera |
| `D` | Start / stop the Demo Director tour |
| `M` | Fire a measurement burst |
| `1`–`4` | Switch render mode |

The stage is keyboard-reachable end to end, every control is a labelled native input, phase colour
has a **cividis** alternative for colour-vision deficiency, a **high-contrast light** theme is one
toggle away, and `prefers-reduced-motion` disables auto-playing tours and continuous animation in
favour of explicit stepping.

## Deploy to Vercel

1. Push this repository to GitHub.
2. On Vercel, choose **Add New → Project → Import** and select the repo.
3. Vercel auto-detects the framework as **Next.js**. Confirm:
   - Build command: `npm run build`
   - Output directory: `.next`
   - Region: `bom1` (Mumbai) — set in `vercel.json`
4. Leave the environment variables empty for a first deploy, or set
   `NEXT_PUBLIC_SITE_URL=https://<your-project>.vercel.app` to pin canonical URLs, OG image
   absolute URLs and the sitemap.
5. Click **Deploy**. Done.

**Why this stays inside the free tier:** apart from Vercel's build-time rendering of the dynamic OG
cards, every byte of physics — PDE solving, raymarching, FFTs, measurement sampling — runs on the
visitor's machine inside Web Workers, WebGL2 or Canvas2D. There is no API route, no database, no
serverless function per page view, and no per-request compute to pay for.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Tier 1 live stage · Tier 2 library grid · Tier 3 concept entry points |
| `/sim/<slug>` | Full-focus page for one of the ten registered simulations |
| `/sim/<slug>/opengraph-image` | 1200×630 social card, prerendered per slug |
| `/learn` | Concept library index |
| `/learn/<topic>` | Six concept reads with KaTeX and links into the sims |
| `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/icon.svg` | SEO, PWA and metadata routes |

35 routes prerender at build time.

## Repository layout

```
src/
  app/            routes, layouts, metadata routes, global theme
  components/      shell (nav, footer), library grid, stage container and drawers, UI primitives
  simulations/     one folder per simulation + registry.ts and shared types
    <slug>/        index.ts (SimModule), controls, demos, math, telemetry, Canvas, engine
  engine/          solvers shared across sims (physics), GLSL shaders, demo director runtime
  content/         concepts.ts — the six learn-mode reads
  hooks/           useStage: keyboard shortcuts, URL hydration, tour lifecycle
  lib/             KaTeX math rendering, GPU capability probe, colour maps
  store/           Zustand store + URL codec
scripts/           headless verification harnesses used by CI
```

## Concept library

`src/content/concepts.ts` holds the six reads (wavefunction and phase, quantum numbers, superposition
and beats, tunneling, measurement and collapse, spin and quantisation) as typed data, each linked to
the simulations that demonstrate it.

## License

MIT — see [LICENSE](LICENSE). Simulation code, prose and derivations are all covered; you can use,
copy, modify and redistribute them, including commercially, as long as the copyright notice travels
with the work.
