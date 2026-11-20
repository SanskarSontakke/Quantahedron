'use client';

/**
 * Stage-side hooks: URL ⇄ store synchronization (§5.4) and the global keyboard
 * map (§6, "Full keyboard navigation supports Space (play/pause), R (reset
 * camera), 1–4 (render modes), M (measure/collapse), D (toggle Auto-Demo)").
 */

import { useCallback, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { getEntry } from '@/simulations/registry';
import type { SimSlug } from '@/simulations/types';
import { useSimStore } from '@/store/useSimStore';
import { decodeParams, encodeParams, readShare } from '@/store/urlState';

/**
 * Debounced write-back of the live state into the address bar.
 * `ready` gates the writer until the initial permalink has been consumed, so a
 * shared link is never overwritten by the default state mid-hydration.
 */
export function useUrlSync(slug: SimSlug, ready: boolean): void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSimStore((s) => s.params[slug]);
  const demoId = useSimStore((s) => s.demo.scriptId);

  useEffect(() => {
    if (!ready || !params) return;
    const timer = setTimeout(() => {
      const entry = getEntry(slug);
      if (!entry) return;
      const qs = new URLSearchParams();
      qs.set('sim', slug);
      const payload = encodeParams(params);
      if (payload && payload !== encodeParams(entry.defaultParams)) qs.set('p', payload);
      if (demoId) qs.set('demo', demoId);
      router.replace(`${pathname}?${qs.toString()}`, { scroll: false });
    }, 450);
    return () => clearTimeout(timer);
  }, [params, demoId, slug, ready, pathname, router]);
}

/** Consume `?sim=&p=&demo=` on first mount. Returns once hydration finished. */
export function useUrlHydrate(slug: SimSlug, demoIds: string[]): boolean {
  const search = useSearchParams()?.toString() ?? '';
  const done = useSimStore((s) => s.hydratedSlugs?.[slug] ?? false);

  useEffect(() => {
    if (done) return;
    const entry = getEntry(slug);
    if (!entry) return;
    const { payload, demo } = readShare(search);
    const decoded = decodeParams(payload, entry.defaultParams);
    const validDemo = demo && demoIds.includes(demo) ? demo : null;
    useSimStore.getState().hydrateFromUrl(slug, decoded, validDemo);
    useSimStore.getState().markHydrated(slug);
  }, [search, slug, demoIds, done]);

  return done;
}

export interface KeyboardOptions {
  slug: SimSlug;
  /** Render modes bound to keys 1–4. */
  renderModes?: string[];
  /** Auto-demo ids cycled by the D key. */
  demoIds?: string[];
  onResetCamera?: () => void;
  /** Simulation-specific keys; return true to swallow the event. */
  onKey?: (key: string, event: KeyboardEvent) => boolean | void;
}

export function useStageKeyboard({
  slug,
  renderModes,
  demoIds,
  onResetCamera,
  onKey,
}: KeyboardOptions): void {
  const handler = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      const store = useSimStore.getState();
      const key = event.key.toLowerCase();

      if (event.key === ' ') {
        event.preventDefault();
        store.togglePlay();
        return;
      }
      if (key === 'r') {
        event.preventDefault();
        onResetCamera?.();
        return;
      }
      if (key === 'd') {
        event.preventDefault();
        if (store.demo.scriptId) store.stopDemo();
        else if (demoIds?.length) store.startDemo(demoIds[0]);
        return;
      }
      if (renderModes?.length && /^[1-4]$/.test(event.key)) {
        const mode = renderModes[Number(event.key) - 1];
        if (mode) {
          event.preventDefault();
          store.setParam(slug, 'render', mode);
          return;
        }
      }
      if (onKey?.(key, event)) return;
      if (key === 'm') {
        event.preventDefault();
        const current = store.params[slug]?.measure;
        store.setParam(slug, 'measure', !current);
        store.setParam(slug, 'measureBurst', Date.now() % 100000);
      }
    },
    [slug, onKey, renderModes, demoIds, onResetCamera],
  );

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);
}
