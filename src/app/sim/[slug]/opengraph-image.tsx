/**
 * Dynamic OpenGraph card for /sim/[slug] (PRD §7, Phase 4).
 *
 * `generateStaticParams` covers all ten slugs, so the PNGs are rendered once at
 * build time and served as static assets — no per-request function on Vercel's
 * free tier. Colours come straight from each simulation's registry accent.
 */

import { ImageResponse } from 'next/og';
import { SIM_LIST, SIM_SLUGS } from '@/simulations/registry';
import type { SimSlug } from '@/simulations/types';

export const alt = 'Quantahedron simulation preview card';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams(): { slug: SimSlug }[] {
  return SIM_SLUGS.map((slug) => ({ slug }));
}

export default async function SimOpenGraphImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const meta = SIM_LIST.find((sim) => sim.slug === slug) ?? SIM_LIST[0];
  const accent = meta.accent;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#06080d',
          padding: 64,
          position: 'relative',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -180,
            right: -160,
            width: 620,
            height: 620,
            borderRadius: 9999,
            background: `radial-gradient(circle, ${accent}44 0%, ${accent}14 42%, transparent 70%)`,
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 150,
            height: 4,
            width: 260,
            background: accent,
            display: 'flex',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              width: 44,
              height: 44,
              borderRadius: 9999,
              border: `3px solid ${accent}`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                display: 'flex',
                width: 14,
                height: 14,
                borderRadius: 9999,
                background: accent,
              }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#e8eefc', letterSpacing: -0.5 }}>
              Quantahedron
            </div>
            <div style={{ fontSize: 17, color: '#6b7d99', letterSpacing: 3 }}>
              RUNS IN YOUR BROWSER
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 68, fontWeight: 700, color: '#e8eefc', lineHeight: 1.05 }}>
            {meta.name}
          </div>
          <div style={{ fontSize: 30, color: accent, maxWidth: 900, lineHeight: 1.3 }}>
            {meta.tagline}
          </div>
          <div style={{ fontSize: 21, color: '#9fb0cc', maxWidth: 900, lineHeight: 1.45 }}>
            {meta.description.slice(0, 150)}
            {meta.description.length > 150 ? '…' : ''}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          {[meta.track, meta.difficulty, meta.engine, `${meta.exploreMinutes} min to explore`].map(
            (chip) => (
              <div
                key={chip}
                style={{
                  display: 'flex',
                  fontSize: 19,
                  color: '#e8eefc',
                  border: '1px solid rgba(148,163,184,0.32)',
                  borderRadius: 9999,
                  padding: '10px 20px',
                  background: 'rgba(15,20,30,0.72)',
                }}
              >
                {chip}
              </div>
            ),
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}
