'use client';

/**
 * Simulation Stage Container (Tier 1, §2).
 *
 * The single framed surface that boots a simulation above the fold, hosts the
 * 48 px chrome bar (quick-switch · auto-demo pill · permalink share · cinema
 * toggle), floats the telemetry pill and inspector drawer, and runs the demo
 * director. It is completely simulation-agnostic: everything it shows comes from
 * the active module's contract, which is why swapping Orbitalis 3D for the
 * double-slit interferometer mid-page keeps the same chrome, shortcuts and URL.
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { SIM_LIST, getMeta } from '@/simulations/registry';
import type { SimSlug } from '@/simulations/types';
import { useSimStore } from '@/store/useSimStore';
import { buildShareUrl } from '@/store/urlState';
import { useSimModule, prefetchSim } from '@/hooks/useSimModule';
import { useStageKeyboard, useUrlHydrate, useUrlSync } from '@/hooks/useStage';
import { detectGpu } from '@/lib/detectGpu';
import { InspectorDrawer } from './InspectorDrawer';
import { DemoDirectorOverlay } from './DemoDirectorOverlay';
import { TelemetryPill } from './TelemetryPill';
import { cx } from '@/components/ui/controls';

const RENDER_MODES: Record<SimSlug, string[]> = {
  'orbitalis-3d': ['raymarch', 'isosurface', 'pointcloud', 'slice'],
  'molecular-orbitals': ['raymarch', 'isosurface', 'pointcloud', 'raymarch'],
  'double-slit-2d': ['field', 'screen', 'both', 'field'],
  'tdse-1d': ['density', 'reim', 'spectrum', 'absorbing'],
  'harmonic-oscillator': ['density', 'reim', 'phase', 'wiggle'],
  'quantum-tunneling': ['wave', 'transmission', 'both', 'wave'],
  'de-broglie-ring': ['orbit', 'scale', 'orbit', 'orbit'],
  'dipole-transitions': ['cloud', 'bloch', 'both', 'cloud'],
  'stern-gerlach-spin': ['beam', 'bloch', 'both', 'beam'],
  'uncertainty-lab': ['both', 'position', 'momentum', 'both'],
};

export interface SimulationContainerProps {
  slug: SimSlug;
  /** `home` keeps the container in the homepage flow; `route` fills the page. */
  variant?: 'home' | 'route';
  /** Called when the learner quick-switches to another simulation. */
  onSwitch?: (slug: SimSlug) => void;
  className?: string;
}

export const SimulationContainer = memo(function SimulationContainer({
  slug,
  variant = 'home',
  onSwitch,
  className,
}: SimulationContainerProps) {
  const { module, meta, loading, error } = useSimModule(slug);
  const demoIds = useMemo(() => (module?.demos ?? []).map((d) => d.id), [module]);
  const hydrated = useUrlHydrate(slug, demoIds);
  useUrlSync(slug, hydrated);

  const fullscreen = useSimStore((s) => s.fullscreen);
  const setFullscreen = useSimStore((s) => s.setFullscreen);
  const playing = useSimStore((s) => s.playing);
  const togglePlay = useSimStore((s) => s.togglePlay);
  const prefs = useSimStore((s) => s.prefs);
  const gpu = useSimStore((s) => s.gpu);
  const resetSim = useSimStore((s) => s.resetSim);
  const interruptDemo = useSimStore((s) => s.interruptDemo);
  const demoScriptId = useSimStore((s) => s.demo.scriptId);

  const shellRef = useRef<HTMLDivElement>(null);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const params = useSimStore((s) => s.params[slug]);

  // GPU capability probe — runs once, decides renderer quality tier.
  useEffect(() => {
    const info = detectGpu();
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    useSimStore.getState().setGpu(info);
    if (prefersReduced) useSimStore.getState().setPrefs({ reducedMotion: true });
  }, []);

  // Respect prefers-reduced-motion: autoplay only when it is allowed.
  useEffect(() => {
    if (prefs.reducedMotion && useSimStore.getState().demo.playing) interruptDemo();
  }, [prefs.reducedMotion, interruptDemo]);

  // Escape leaves cinema mode.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [setFullscreen]);

  const toggleCinema = useCallback(() => {
    const el = shellRef.current;
    const next = !fullscreen;
    setFullscreen(next);
    if (next) el?.requestFullscreen?.().catch(() => undefined);
    else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
  }, [fullscreen, setFullscreen]);

  const copyPermalink = useCallback(async () => {
    const entry = module ? { defaultParams: module.defaultParams } : null;
    const url = buildShareUrl({
      slug,
      params,
      template: entry?.defaultParams ?? {},
      pathname: variant === 'route' ? `/sim/${slug}` : '/',
      demo: demoScriptId,
    });
    const absolute = typeof window === 'undefined' ? url : `${window.location.origin}${url}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy the simulation permalink', absolute);
    }
  }, [slug, params, module, variant, demoScriptId]);

  const resetCamera = useCallback(() => {
    if (!module) return;
    const cam: Record<string, number> = {};
    for (const key of ['camAz', 'camEl', 'camDist']) {
      const def = module.defaultParams[key];
      if (typeof def === 'number') cam[key] = def;
    }
    if (Object.keys(cam).length) useSimStore.getState().setParams(slug, cam);
  }, [module, slug]);

  useStageKeyboard({
    slug,
    renderModes: module?.meta.gpu || slug === 'tdse-1d' ? RENDER_MODES[slug] : undefined,
    demoIds,
    onResetCamera: resetCamera,
  });

  const heightClass =
    variant === 'route'
      ? 'h-[min(86vh,1100px)] min-h-[520px]'
      : 'h-[62vh] min-h-[420px] md:h-[78vh]';

  const accent = meta?.accent ?? '#5eead4';

  return (
    <div
      ref={shellRef}
      className={cx(
        'stage-frame relative flex flex-col overflow-hidden bg-obsidian',
        fullscreen
          ? 'fixed inset-0 z-50 h-full w-full rounded-none'
          : cx('mx-auto w-full max-w-[1440px]', heightClass, className),
      )}
      data-sim={slug}
      aria-label={`${meta?.name ?? 'Simulation'} stage`}
    >
      {/* ── Chrome bar (48 px) ─────────────────────────────────────────── */}
      <div className="relative z-30 flex h-12 shrink-0 items-center gap-1.5 border-b border-hairline bg-obsidian-2/80 px-2 backdrop-blur-md sm:px-3">
        {/* Quick-switch */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setSwitcherOpen((v) => !v)}
            aria-expanded={switcherOpen}
            className="flex items-center gap-2 rounded-lg border border-hairline bg-obsidian/70 px-2.5 py-1.5 text-left transition-colors hover:border-hairline-bright"
          >
            <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
            <span className="text-[12.5px] font-medium text-ink">{meta?.name ?? slug}</span>
            <span className="text-[9px] text-ink-faint">▾</span>
          </button>
          {switcherOpen ? (
            <div className="glass absolute left-0 top-[calc(100%+6px)] z-40 max-h-[70vh] w-[286px] overflow-y-auto rounded-xl p-1.5 shadow-lift">
              {SIM_LIST.map((sim) => (
                <button
                  key={sim.slug}
                  type="button"
                  onMouseEnter={() => prefetchSim(sim.slug)}
                  onClick={() => {
                    setSwitcherOpen(false);
                    if (sim.slug === slug) return;
                    if (onSwitch) onSwitch(sim.slug);
                    else useSimStore.getState().setActive(sim.slug);
                  }}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/5',
                    sim.slug === slug && 'bg-white/[0.06]',
                  )}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: sim.accent }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-ink">{sim.name}</span>
                    <span className="block truncate text-[10px] text-ink-faint">{sim.tagline}</span>
                  </span>
                  <Link
                    href={sim.route}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSwitcherOpen(false);
                    }}
                    className="shrink-0 rounded border border-hairline px-1 text-[9.5px] text-ink-faint hover:text-ink"
                    title={`Open dedicated ${sim.name} page`}
                  >
                    ↗
                  </Link>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Auto-demo pill */}
        <span
          className={cx(
            'hidden items-center gap-1.5 rounded-full border px-2 py-1 text-[10.5px] sm:flex',
            demoScriptId ? 'border-transparent text-ink' : 'border-hairline text-ink-faint',
          )}
          style={demoScriptId ? { background: `${accent}1f`, color: accent } : undefined}
          title={demoScriptId ? 'Guided tour running' : 'No guided tour running'}
        >
          <span>{demoScriptId ? '◉' : '○'}</span>
          {demoScriptId
            ? module?.demos?.find((d) => d.id === demoScriptId)?.label ?? 'Tour'
            : 'Auto-demo'}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            title="Play / pause (Space)"
            className="hidden h-7 w-7 items-center justify-center rounded-lg border border-hairline text-[11px] text-ink-dim hover:text-ink sm:flex"
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button
            type="button"
            onClick={() => resetSim(slug)}
            title="Reset simulation state"
            className="hidden h-7 w-7 items-center justify-center rounded-lg border border-hairline text-[12px] text-ink-dim hover:text-ink sm:flex"
          >
            ⟲
          </button>
          <button
            type="button"
            onClick={copyPermalink}
            title="Copy a permalink that restores this exact quantum state"
            className="flex items-center gap-1.5 rounded-lg border border-hairline px-2 py-1 text-[11px] text-ink-dim hover:text-ink"
          >
            {copied ? '✓ Copied' : '⤴ Share'}
          </button>
          <button
            type="button"
            onClick={toggleCinema}
            title="Cinema mode (fullscreen)"
            aria-pressed={fullscreen}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline text-[12px] text-ink-dim hover:text-ink"
          >
            {fullscreen ? '⇱' : '⇲'}
          </button>
        </div>
      </div>

      {/* ── Stage body ─────────────────────────────────────────────────── */}
      <div className="relative min-h-0 flex-1 bg-obsidian">
        {loading || !module ? (
          <StageSkeleton label={meta?.name ?? slug} accent={accent} error={error} />
        ) : (
          <>
            <module.Canvas slug={slug} />
            <TelemetryPill slug={slug} module={module} />
            <InspectorDrawer slug={slug} module={module} onInteract={interruptDemo} />
            <DemoDirectorOverlay slug={slug} module={module} />
            {!gpu.webgl2 && module.meta.gpu ? (
              <div className="glass pointer-events-none absolute bottom-16 right-3 z-20 max-w-[260px] rounded-lg px-2.5 py-1.5 text-[10.5px] text-solar">
                WebGL2 unavailable — this simulation has fallen back to its low-power renderer.
              </div>
            ) : null}
            {variant === 'route' ? null : (
              <Link
                href={`/sim/${slug}`}
                className="glass absolute bottom-14 right-3 z-20 hidden rounded-full px-2.5 py-1 text-[10.5px] text-ink-dim hover:text-ink md:block"
              >
                Open full page ↗
              </Link>
            )}
          </>
        )}
      </div>

      {/* Quality chip keeps the GPU probe visible/verifiable */}
      <div className="pointer-events-none absolute bottom-14 left-3 z-10 font-mono text-[9px] text-ink-faint/70">
        {gpu.tier === 'none' ? '' : `${gpu.tier} · ${gpu.webgl2 ? 'WebGL2' : 'Canvas2D'}`}
      </div>
    </div>
  );
});

function StageSkeleton({
  label,
  accent,
  error,
}: {
  label: string;
  accent: string;
  error: string | null;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-obsidian">
      <div
        className="h-16 w-16 animate-spin rounded-full border-2 border-transparent"
        style={{ borderTopColor: accent, borderRightColor: `${accent}55`, animationDuration: '1.4s' }}
      />
      <p className="text-[12px] text-ink-dim">
        {error ? `Could not load ${label}` : `Booting ${label}…`}
      </p>
      {error ? <p className="max-w-[420px] text-center text-[11px] text-ink-faint">{error}</p> : null}
    </div>
  );
}

/** Small helper for pages that want the container plus a caption row. */
export function StageWithHint({ slug, children }: { slug: SimSlug; children?: ReactNode }) {
  const meta = getMeta(slug);
  return (
    <div className="w-full">
      <SimulationContainer slug={slug} variant="route" />
      {children ?? (
        <p className="mx-auto mt-2 max-w-[1440px] text-[11.5px] text-ink-faint">
          {meta?.engine} · {meta?.difficulty} · ~{meta?.exploreMinutes} min
        </p>
      )}
    </div>
  );
}
