import type { MetadataRoute } from 'next';
import { SIM_LIST } from '@/simulations/registry';
import { CONCEPTS } from '@/content/concepts';

/**
 * Sitemap for the whole app tree. Built from the same registries the pages are
 * generated from, so a new simulation or concept appears here automatically.
 */

const ORIGIN: string =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : 'https://quantahedron.vercel.app');

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${ORIGIN}/`, lastModified, changeFrequency: 'weekly', priority: 1 },
    { url: `${ORIGIN}/learn`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    ...SIM_LIST.map((sim) => ({
      url: `${ORIGIN}${sim.route}`,
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.9,
    })),
    ...CONCEPTS.map((concept) => ({
      url: `${ORIGIN}/learn/${concept.slug}`,
      lastModified,
      changeFrequency: 'yearly' as const,
      priority: 0.6,
    })),
  ];
}
