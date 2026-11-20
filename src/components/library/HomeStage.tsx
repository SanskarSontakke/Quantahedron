'use client';

/**
 * Tier 1 — the homepage hero stage.
 *
 * The container is simulation-agnostic; this wrapper only owns the quick-switch
 * target, so choosing another simulation inside the homepage chrome swaps the
 * module in place through the store (no navigation, no lost context, each sim
 * keeps its own `params[slug]` slice). Chunk warming stays on grid-card hover,
 * per the PRD's "only the flagship bundle loads on first visit" budget.
 */

import { useCallback } from 'react';
import { SimulationContainer } from '@/components/stage/SimulationContainer';
import { getMeta } from '@/simulations/registry';
import { useSimStore } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';

const FLAGSHIP: SimSlug = 'orbitalis-3d';

export function HomeStage() {
  const active = useSimStore((s) => s.activeSlug);
  const setActive = useSimStore((s) => s.setActive);
  const slug = getMeta(active) ? active : FLAGSHIP;

  const handleSwitch = useCallback((next: SimSlug) => setActive(next), [setActive]);

  return <SimulationContainer slug={slug} variant="home" onSwitch={handleSwitch} />;
}
