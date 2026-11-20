/**
 * Global simulation store (Zustand) + URL hydration.
 *
 * One store serves all ten simulations: `params[slug]` holds each sim's flat
 * state, so switching sims inside the homepage Stage Container never loses
 * context. Playback, demo clock, inspector layout and persisted accessibility
 * preferences live here too, which is what lets the container chrome stay
 * completely simulation-agnostic.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { SimParamValue, SimParams, SimSlug } from '@/simulations/types';
import { SIM_REGISTRY, getMeta } from '@/simulations/registry';

export type QualityTier = 'auto' | 'high' | 'balanced' | 'low';
export type PhasePalette = 'twilight' | 'cividis';
export type ContrastMode = 'dark' | 'light';

export interface Prefs {
  palette: PhasePalette;
  contrast: ContrastMode;
  quality: QualityTier;
  reducedMotion: boolean;
  showGrid: boolean;
}

/** GPU capability detected once at container mount (§7 mitigation). */
export interface GpuInfo {
  webgl2: boolean;
  floatTextures: boolean;
  tier: 'high' | 'balanced' | 'low' | 'none';
  renderer: string;
}

interface DemoState {
  scriptId: string | null;
  playing: boolean;
  /** Seconds into the tour; advanced by DemoDirectorOverlay's rAF loop. */
  t: number;
  /** True once the learner touched a control, so we stop fighting them. */
  interrupted: boolean;
  /** Subtitle currently displayed by the director. */
  caption: string | null;
}

interface SimState {
  activeSlug: SimSlug;
  params: Record<string, SimParams>;
  /** Playback clock shared by every sim: 0 = paused, 1 = real time. */
  playing: boolean;
  timeScale: number;
  /** Monotonic atomic-unit time, written back by sims so plots stay in sync. */
  simTime: number;
  demo: DemoState;
  inspectorOpen: boolean;
  inspectorTab: string;
  fullscreen: boolean;
  prefs: Prefs;
  gpu: GpuInfo;
  /** Bumped whenever a full reset happens, so canvases can clear trails. */
  resetToken: number;
  /** Permalink hydration guard — prevents the URL writer clobbering a shared link. */
  hydratedSlugs: Record<string, boolean>;

  setActive: (slug: SimSlug) => void;
  setParam: (slug: SimSlug, key: string, value: SimParamValue) => void;
  setParams: (slug: SimSlug, patch: SimParams) => void;
  getParams: (slug: SimSlug) => SimParams;
  resetSim: (slug: SimSlug, next?: SimParams) => void;
  hydrateFromUrl: (slug: SimSlug, params: SimParams, demo?: string | null) => void;

  togglePlay: () => void;
  setPlaying: (v: boolean) => void;
  setTimeScale: (v: number) => void;
  setSimTime: (v: number) => void;

  startDemo: (scriptId: string) => void;
  stopDemo: () => void;
  setDemoTime: (t: number, caption?: string | null) => void;
  interruptDemo: () => void;
  resumeDemo: () => void;

  setInspectorOpen: (v: boolean) => void;
  setInspectorTab: (v: string) => void;
  toggleFullscreen: () => void;
  setFullscreen: (v: boolean) => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  setGpu: (info: GpuInfo) => void;
  markHydrated: (slug: SimSlug) => void;
}

function defaultParams(): Record<string, SimParams> {
  const out: Record<string, SimParams> = {};
  for (const entry of SIM_REGISTRY) out[entry.slug] = { ...entry.defaultParams };
  return out;
}

const DEFAULT_PREFS: Prefs = {
  palette: 'twilight',
  contrast: 'dark',
  quality: 'auto',
  reducedMotion: false,
  showGrid: true,
};

export const useSimStore = create<SimState>()(
  persist(
    (set, get) => ({
      activeSlug: 'orbitalis-3d',
      params: defaultParams(),
      playing: true,
      timeScale: 1,
      simTime: 0,
      demo: { scriptId: null, playing: false, t: 0, interrupted: false, caption: null },
      inspectorOpen: true,
      inspectorTab: 'state',
      fullscreen: false,
      prefs: DEFAULT_PREFS,
      gpu: { webgl2: false, floatTextures: false, tier: 'balanced', renderer: 'unknown' },
      resetToken: 0,
      hydratedSlugs: {},

      setActive: (slug) => {
        if (!getMeta(slug)) return;
        const { params } = get();
        if (!params[slug]) {
          set({
            activeSlug: slug,
            params: { ...params, [slug]: { ...(getRegistryDefaults(slug) ?? {}) } },
          });
        } else {
          set({ activeSlug: slug });
        }
      },

      setParam: (slug, key, value) =>
        set((s) => ({
          params: { ...s.params, [slug]: { ...s.params[slug], [key]: value } },
        })),

      setParams: (slug, patch) =>
        set((s) => ({ params: { ...s.params, [slug]: { ...s.params[slug], ...patch } } })),

      getParams: (slug) => get().params[slug] ?? getRegistryDefaults(slug) ?? {},

      resetSim: (slug, next) =>
        set((s) => ({
          params: {
            ...s.params,
            [slug]: { ...(next ?? getRegistryDefaults(slug) ?? {}) },
          },
          demo: { scriptId: null, playing: false, t: 0, interrupted: false, caption: null },
          simTime: 0,
          resetToken: s.resetToken + 1,
        })),

      hydrateFromUrl: (slug, params, demo = null) =>
        set((s) => ({
          activeSlug: slug,
          params: { ...s.params, [slug]: params },
          simTime: 0,
          demo: {
            scriptId: demo,
            playing: Boolean(demo),
            t: 0,
            interrupted: false,
            caption: null,
          },
        })),

      togglePlay: () => set((s) => ({ playing: !s.playing })),
      setPlaying: (v) => set({ playing: v }),
      setTimeScale: (v) => set({ timeScale: v }),
      setSimTime: (v) => set({ simTime: v }),

      startDemo: (scriptId) =>
        set({ demo: { scriptId, playing: true, t: 0, interrupted: false, caption: null } }),
      stopDemo: () => set({ demo: { scriptId: null, playing: false, t: 0, interrupted: false, caption: null } }),
      setDemoTime: (t, caption) => set((s) => ({ demo: { ...s.demo, t, caption: caption === undefined ? s.demo.caption : caption } })),
      interruptDemo: () =>
        set((s) => (s.demo.scriptId ? { demo: { ...s.demo, interrupted: true, playing: false } } : {})),
      resumeDemo: () => set((s) => ({ demo: { ...s.demo, interrupted: false, playing: true } })),

      setInspectorOpen: (v) => set({ inspectorOpen: v }),
      setInspectorTab: (v) => set({ inspectorTab: v }),
      toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
      setFullscreen: (v) => set({ fullscreen: v }),
      setPrefs: (patch) => set((s) => ({ prefs: { ...s.prefs, ...patch } })),
      setGpu: (info) => set({ gpu: info }),
      markHydrated: (slug) =>
        set((s) => ({ hydratedSlugs: { ...s.hydratedSlugs, [slug]: true } })),
    }),
    {
      name: 'quantahedron:prefs',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only ergonomic preferences persist — physics state belongs in the URL.
      partialize: (s) => ({ prefs: s.prefs }) as unknown as SimState,
    },
  ),
);

function getRegistryDefaults(slug: SimSlug): SimParams | null {
  return SIM_REGISTRY.find((e) => e.slug === slug)?.defaultParams ?? null;
}

/** Reactive accessor for a single simulation's params. */
export function useSimParams(slug: SimSlug): SimParams {
  return useSimStore((s) => s.params[slug] ?? (getRegistryDefaults(slug) as SimParams));
}

/** Typed getters so simulation code never repeats coercion boilerplate. */
export const pNum = (p: SimParams, key: string, fallback = 0): number => {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
export const pBool = (p: SimParams, key: string, fallback = false): boolean => {
  const v = p[key];
  return typeof v === 'boolean' ? v : fallback;
};
export const pStr = (p: SimParams, key: string, fallback = ''): string => {
  const v = p[key];
  return typeof v === 'string' ? v : fallback;
};
export const pArr = (p: SimParams, key: string, fallback: number[] = []): number[] => {
  const v = p[key];
  return Array.isArray(v) ? v : fallback;
};
