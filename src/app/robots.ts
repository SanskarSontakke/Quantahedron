import type { MetadataRoute } from 'next';

const ORIGIN: string =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : 'https://quantahedron.vercel.app');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${ORIGIN}/sitemap.xml`,
    host: ORIGIN,
  };
}
