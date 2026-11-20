'use client';

/**
 * Studio-Glass Inspector Drawer (§3.3). A collapsible ~300 px dock on the right
 * edge of the stage whose tabs are generated from a simulation's `controls`
 * spec — so every sim gets the same State / Visuals / Plots / Fields ergonomics
 * while still owning 100% of its own physics surface.
 */

import { memo, useMemo } from 'react';
import { useSimStore } from '@/store/useSimStore';
import type { ControlGroup, SimModule, SimSlug } from '@/simulations/types';
import { SectionTitle, Segmented, Slider, Toggle, cx } from '@/components/ui/controls';

const GROUP_LABEL: Record<ControlGroup, { label: string; glyph: string }> = {
  state: { label: 'State', glyph: 'ψ' },
  visuals: { label: 'Visuals', glyph: '◐' },
  plots: { label: 'Plots', glyph: '∿' },
  fields: { label: 'Fields', glyph: '⌁' },
};

const GROUP_ORDER: ControlGroup[] = ['state', 'visuals', 'plots', 'fields'];

export interface InspectorDrawerProps {
  slug: SimSlug;
  module: SimModule;
  /** Fires on any edit so the Demo Director can yield to the learner. */
  onInteract: () => void;
}

export const InspectorDrawer = memo(function InspectorDrawer({
  slug,
  module,
  onInteract,
}: InspectorDrawerProps) {
  const params = useSimStore((s) => s.params[slug]);
  const setParam = useSimStore((s) => s.setParam);
  const open = useSimStore((s) => s.inspectorOpen);
  const setOpen = useSimStore((s) => s.setInspectorOpen);
  const tab = useSimStore((s) => s.inspectorTab);
  const setTab = useSimStore((s) => s.setInspectorTab);
  const accent = module.meta.accent;

  const tabs = useMemo(() => {
    const present = new Set(module.controls.map((c) => c.group));
    const list: { id: string; label: string; glyph: string }[] = GROUP_ORDER.filter((g) =>
      present.has(g),
    ).map((g) => ({ id: g, ...GROUP_LABEL[g] }));
    for (const extra of module.extraTabs ?? []) list.push({ id: extra.id, label: extra.label, glyph: extra.glyph });
    return list;
  }, [module]);

  const activeTab = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id ?? 'state';
  const controls = module.controls.filter(
    (c) => c.group === activeTab && (!c.visibleIf || c.visibleIf(params)),
  );
  const extra = (module.extraTabs ?? []).find((t) => t.id === activeTab);

  return (
    <aside
      className={cx(
        'pointer-events-auto absolute right-0 top-0 bottom-0 z-20 flex transition-transform duration-300 ease-out',
        open ? 'translate-x-0' : 'translate-x-[calc(100%-34px)]',
      )}
      aria-label="Simulation inspector"
    >
      {/* Collapsed rail */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={open ? 'Collapse inspector' : 'Expand inspector'}
        aria-expanded={open}
        className="glass flex w-[34px] shrink-0 flex-col items-center gap-3 border-r-0 py-3 text-ink-faint hover:text-ink"
      >
        <span className="text-[13px] leading-none">{open ? '›' : '‹'}</span>
        <span className="mt-1 text-[15px] leading-none" style={{ color: accent }}>
          ⚙
        </span>
        {!open
          ? tabs.map((t) => (
              <span key={t.id} className="text-[11px] leading-none" title={t.label}>
                {t.glyph}
              </span>
            ))
          : null}
      </button>

      {open ? (
        <div className="glass flex w-[300px] max-w-[78vw] flex-col border-r-0 border-b-0 bg-glass-strong">
          <div className="flex gap-0.5 border-b border-hairline px-1.5 py-1.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cx(
                  'flex-1 rounded-lg px-1 py-1 text-[10.5px] leading-tight transition-colors',
                  activeTab === t.id
                    ? 'bg-white/[0.07] text-ink'
                    : 'text-ink-faint hover:bg-white/5 hover:text-ink-dim',
                )}
                style={activeTab === t.id ? { color: accent } : undefined}
              >
                <span className="mr-1 opacity-70">{t.glyph}</span>
                {t.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
            {extra ? (
              <extra.Component slug={slug} />
            ) : (
              <>
                {controls.length === 0 ? (
                  <p className="px-1 py-6 text-center text-[11px] text-ink-faint">
                    No controls in this tab.
                  </p>
                ) : null}
                {renderControls(controls, params, (key, value) => {
                  setParam(slug, key, value);
                  onInteract();
                })}
                {activeTab === 'plots' ? <PlotHint module={module} /> : null}
              </>
            )}
          </div>

          <div className="border-t border-hairline px-3 py-2 text-[10px] leading-relaxed text-ink-faint">
            {module.meta.engine}
          </div>
        </div>
      ) : null}
    </aside>
  );
});

function renderControls(
  controls: SimModule['controls'],
  params: Record<string, unknown>,
  onChange: (key: string, value: number | string | boolean) => void,
) {
  const groups: { title: string; items: typeof controls }[] = [];
  let current: { title: string; items: typeof controls } | null = null;
  for (const c of controls) {
    const title = (c as { group?: string }).group ?? '';
    if (!current || current.title !== title) {
      current = { title, items: [] };
      groups.push(current);
    }
    current.items.push(c);
  }
  return (
    <>
      {groups.map((g, gi) => (
        <div key={gi}>
          {g.title && g.items.some((i) => i.label !== g.title) ? null : null}
          {g.items.map((c) => {
            const value = params[c.key];
            if (c.kind === 'slider') {
              return (
                <Slider
                  key={c.key}
                  label={c.label}
                  value={typeof value === 'number' ? value : c.min}
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  unit={c.unit}
                  log={c.log}
                  format={c.format}
                  help={c.help}
                  onChange={(v) => onChange(c.key, v)}
                />
              );
            }
            if (c.kind === 'toggle') {
              return (
                <Toggle
                  key={c.key}
                  label={c.label}
                  checked={Boolean(value)}
                  help={c.help}
                  onChange={(v) => onChange(c.key, v)}
                />
              );
            }
            return (
              <Segmented
                key={c.key}
                label={c.label}
                value={value === undefined ? String(c.options[0]?.value ?? '') : String(value)}
                options={c.options}
                onChange={(v) =>
                  /* a numeric param keeps its type, so `gridRes: 512` never becomes "512" */
                  onChange(c.key, typeof value === 'number' && Number.isFinite(Number(v)) ? Number(v) : v)
                }
              />
            );
          })}
        </div>
      ))}
    </>
  );
}

function PlotHint({ module }: { module: SimModule }) {
  const hasPlots = (module.extraTabs ?? []).some((t) => t.id === 'plots');
  if (hasPlots) return null;
  return (
    <div className="mt-2">
      <SectionTitle>Live plots</SectionTitle>
      <p className="text-[11px] leading-relaxed text-ink-faint">
        Charts for {module.meta.name} are docked inside the stage viewport.
      </p>
    </div>
  );
}
