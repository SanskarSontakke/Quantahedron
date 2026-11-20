/**
 * Quantahedron simulation contract.
 *
 * Every simulation in `src/simulations/<slug>/index.ts` default-exports a
 * `SimModule`. The platform shell (SimulationContainer + InspectorDrawer +
 * SyncedMathDrawer + DemoDirectorOverlay) is entirely driven by this contract,
 * which is what gives all ten sims the same Studio-Glass ergonomics, URL state
 * sharing, auto-demo behaviour and KaTeX derivation drawer for free.
 *
 * Golden rule: **all simulation state is a flat scalar/array map** in the
 * Zustand store (`params[slug]`). Nothing lives in component-local state except
 * transient interaction (drag previews, hover). That single constraint is what
 * makes permalink sharing, demo keyframe interpolation and time-travel reset
 * work generically for every simulation.
 */

import type { ComponentType } from 'react';

export type SimSlug =
  | 'orbitalis-3d'
  | 'de-broglie-ring'
  | 'tdse-1d'
  | 'quantum-tunneling'
  | 'double-slit-2d'
  | 'harmonic-oscillator'
  | 'dipole-transitions'
  | 'stern-gerlach-spin'
  | 'molecular-orbitals'
  | 'uncertainty-lab';

export type SimParamValue = number | string | boolean | number[];
export type SimParams = Record<string, SimParamValue>;

export type SimTrack =
  | 'Atomic Architecture'
  | 'Wave Equations & Tunneling'
  | 'Spin, Spectra & Bonding';

export type Difficulty = 'Foundations' | 'Undergraduate' | 'Advanced';

export interface SimMeta {
  slug: SimSlug;
  /** Index used for catalogue ordering (1 = flagship). */
  order: number;
  name: string;
  tagline: string;
  track: SimTrack;
  difficulty: Difficulty;
  /** Estimated open-ended exploration time shown on the library card. */
  exploreMinutes: number;
  /** One-paragraph description for the library grid and /sim route. */
  description: string;
  /** Solver / engine label from the PRD catalogue table. */
  engine: string;
  tags: string[];
  /** Hex accent used for the card glow and chart series. */
  accent: string;
  /** Route path, e.g. `/sim/de-broglie-ring`. */
  route: string;
  /** Whether the sim needs WebGL2 (drives the GPU capability probe). */
  gpu: boolean;
}

/* ------------------------------------------------------------------ */
/* Inspector controls                                                  */
/* ------------------------------------------------------------------ */

export type ControlGroup = 'state' | 'visuals' | 'plots' | 'fields';

export interface ControlBase {
  key: string;
  label: string;
  group: ControlGroup;
  /** Hide the control when the predicate fails (e.g. mode-dependent sliders). */
  visibleIf?: (p: SimParams) => boolean;
  help?: string;
}

export interface SliderControl extends ControlBase {
  kind: 'slider';
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Logarithmic mapping for physical ranges (frequencies, field strengths). */
  log?: boolean;
  /** Live formatting override. */
  format?: (v: number) => string;
}

export interface ToggleControl extends ControlBase {
  kind: 'toggle';
}

export interface SelectControl extends ControlBase {
  kind: 'select';
  options: { value: string; label: string }[];
}

export type ControlSpec = SliderControl | ToggleControl | SelectControl;

/* ------------------------------------------------------------------ */
/* Telemetry + math drawer                                             */
/* ------------------------------------------------------------------ */

export interface TelemetryItem {
  label: string;
  value: string;
  /** Secondary line, e.g. units or exact expression. */
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'accent';
}

export interface MathBlock {
  tex: string;
  display?: boolean;
  note?: string;
}

export interface DerivationStep {
  text: string;
  math?: MathBlock[];
  /** Optional caption under the step (a numeric check, a caveat, a units note). */
  note?: string;
}

export interface SimChallenge {
  question: string;
  hint: string;
  answer: string;
  /** Optional param key the learner should tweak to solve it. */
  paramKey?: string;
}

export interface SimMathContent {
  /** Headline reactive equations, e.g. the exact ψ_{nℓm} in use right now. */
  formula: MathBlock[];
  /** Compact factual read-outs such as node counts (rendered as a stat row). */
  readout: { label: string; value: string }[];
  /** Explains what the on-screen colour encoding currently means. */
  phaseLegend: string;
  /** Tab 1 — conceptual intuition. Inline TeX with $...$ is rendered. */
  intuition: string;
  /** Tab 2 — the formal derivation, step by step. */
  derivation: { title: string; steps: DerivationStep[] }[];
  /** Tab 3 — hands-on challenges tied to live parameters. */
  challenge: SimChallenge[];
}

/* ------------------------------------------------------------------ */
/* Auto-demo (Demo Director)                                           */
/* ------------------------------------------------------------------ */

export interface DemoKeyframe {
  /** Seconds from tour start. */
  at: number;
  /** Subtitle overlay shown from this keyframe until the next one. */
  caption?: string;
  /**
   * Parameter targets reached at `at`. Numeric params tween linearly from the
   * previous keyframe; strings/booleans/arrays switch exactly at `at` unless
   * `instant: false` is meaningless for them.
   */
  params?: SimParams;
  /** Jump straight to the values instead of interpolating. */
  instant?: boolean;
}

export interface DemoScript {
  id: string;
  label: string;
  summary: string;
  durationSec: number;
  keyframes: DemoKeyframe[];
}

/* ------------------------------------------------------------------ */
/* Module                                                              */
/* ------------------------------------------------------------------ */

export interface SimExtraTab {
  id: string;
  label: string;
  /** Short glyph shown in the collapsed rail. */
  glyph: string;
  Component: ComponentType<{ slug: SimSlug }>;
}

export interface SimModule {
  meta: SimMeta;
  defaultParams: SimParams;
  controls: ControlSpec[];
  /** Main viewport — the only heavy component, mounted inside the stage. */
  Canvas: ComponentType<{ slug: SimSlug }>;
  /** Optional extra Inspector Drawer tabs (measurement rigs, plot galleries). */
  extraTabs?: SimExtraTab[];
  telemetry?: (p: SimParams) => TelemetryItem[];
  math?: (p: SimParams) => SimMathContent;
  demos?: DemoScript[];
  /** One-line human summary of the current state for cards and OG previews. */
  describe?: (p: SimParams) => string;
}
