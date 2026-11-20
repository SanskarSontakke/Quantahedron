'use client';

/**
 * Applies the persisted accessibility preferences to the document root.
 *
 * `globals.css` switches its token values from `html[data-palette]` and
 * `html[data-contrast]`, so the shell only has to mirror the stored prefs into
 * those two attributes. Everything happens inside `useEffect` — the server
 * renders a plain `<html>` and the client never has to guess the stored value
 * during hydration, which is why `<html>` carries `suppressHydrationWarning`.
 */

import { useEffect } from 'react';
import { useSimStore } from '@/store/useSimStore';

export function ThemeApplier() {
  const palette = useSimStore((s) => s.prefs.palette);
  const contrast = useSimStore((s) => s.prefs.contrast);
  const reducedMotion = useSimStore((s) => s.prefs.reducedMotion);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.palette = palette;
    root.dataset.contrast = contrast;
    root.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
  }, [palette, contrast, reducedMotion]);

  return null;
}
