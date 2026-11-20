# Quantahedron

**Interactive quantum physics, solved in real time — in your browser.**

Quantahedron is an open learning platform for quantum and atomic physics. Its homepage is not a
landing page: above the fold sits a live simulation stage running **Orbitalis 3D**, an exact
hydrogenic wavefunction engine (analytical Laguerre/Legendre solutions, volumetric WebGL2
raymarching, measurement-and-collapse sampling, Zeeman and Stark fields, a clickable spectroscopy
ladder). Nine companion simulations cover matter waves, the time-dependent Schrödinger equation,
tunneling, two-path interference, the harmonic oscillator, driven dipole transitions, Stern–Gerlach
spin, LCAO bonding and Fourier-limited uncertainty.

Every state is shareable as a URL, every solver runs on the visitor's own CPU/GPU, and the whole
deployment fits on free-tier static hosting.

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
  nothing but the image build costs server time.
- **Design tokens, not ad-hoc styling.** One `@theme` block in `src/app/globals.css` defines the
  Observatory Glass palette, and accessibility variants (cividis phase palette, high-contrast light
  lab) are attribute switches on `<html>` driven by persisted preferences.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm run start      # serve the production build
```

Quality gates:

```bash
npm run lint       # eslint-config-next
npm run typecheck  # tsc --noEmit
```

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
| `/learn` | Concept library index |
| `/learn/<topic>` | Six concept reads with KaTeX and links into the sims |
| `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest`, `/icon.svg` | SEO, PWA and metadata routes |

## Concept library

`src/content/concepts.ts` holds the six reads (wavefunction and phase, quantum numbers, superposition
and beats, tunneling, measurement and collapse, spin and quantisation) as typed data, each linked to
the simulations that demonstrate it.
