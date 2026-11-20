'use client';

/**
 * Module loader for simulation chunks.
 *
 * `next/dynamic` needs static import expressions, so the registry owns the
 * per-slug `() => import(...)` closures; this hook just drives them with proper
 * suspense-free loading states and keeps the promise cached across mounts (the
 * homepage stage and a /sim route therefore share one chunk instance).
 */

import { useEffect, useState } from 'react';
import { getEntry, loadModule } from '@/simulations/registry';
import type { SimMeta, SimModule, SimSlug } from '@/simulations/types';
import { useSimStore } from '@/store/useSimStore';

const cache = new Map<string, SimModule>();

export interface ModuleState {
  module: SimModule | null;
  meta: SimMeta | null;
  loading: boolean;
  error: string | null;
}

export function useSimModule(slug: SimSlug | string | null): ModuleState {
  const [state, setState] = useState<ModuleState>(() => {
    const entry = slug ? getEntry(slug) : undefined;
    return {
      module: slug ? (cache.get(slug) ?? null) : null,
      meta: entry?.meta ?? null,
      loading: !!slug && (!entry || !cache.has(slug)),
      error: slug && !entry ? `Unknown simulation "${slug}"` : null,
    };
  });

  useEffect(() => {
    let alive = true;
    if (!slug) {
      setState({ module: null, meta: null, loading: false, error: null });
      return;
    }
    const entry = getEntry(slug);
    if (!entry) {
      setState({ module: null, meta: null, loading: false, error: `Unknown simulation "${slug}"` });
      return;
    }
    const hit = cache.get(slug);
    if (hit) {
      setState({ module: hit, meta: entry.meta, loading: false, error: null });
      return;
    }
    setState({ module: null, meta: entry.meta, loading: true, error: null });
    loadModule(slug)
      .then((mod) => {
        if (!alive) return;
        if (mod) {
          cache.set(slug, mod);
          setState({ module: mod, meta: entry.meta, loading: false, error: null });
        } else {
          setState({ module: null, meta: entry.meta, loading: false, error: 'Empty module' });
        }
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setState({
          module: null,
          meta: entry.meta,
          loading: false,
          error: err instanceof Error ? err.message : 'Chunk failed to load',
        });
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  return state;
}

/** Warm a chunk ahead of time (library-card hover, PRD §5.3). */
export function prefetchSim(slug: SimSlug | string): void {
  if (cache.has(slug)) return;
  const entry = getEntry(slug);
  if (!entry) return;
  entry
    .load()
    .then(({ default: mod }) => {
      if (mod) cache.set(slug, mod);
    })
    .catch(() => {
      /* silent — prefetch is best-effort */
    });
}

/** Kick off the registry probe once per store mount. */
export function useEnsureParams(slug: SimSlug | string | null): void {
  const setParams = useSimStore((s) => s.setParams);
  useEffect(() => {
    if (!slug) return;
    const entry = getEntry(slug);
    if (entry && !useSimStore.getState().params[slug]) {
      setParams(slug as SimSlug, { ...entry.defaultParams });
    }
  }, [slug, setParams]);
}
