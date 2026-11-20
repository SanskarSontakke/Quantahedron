import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import 'katex/dist/katex.min.css';
import './globals.css';
import { SiteHeader } from '@/components/shell/SiteHeader';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { ThemeApplier } from '@/components/shell/ThemeApplier';

/**
 * Root layout — the "Observatory Glass" shell.
 *
 * The two font variables are deliberately named `--font-geist-sans` and
 * `--font-jetbrains-mono` because that is what `globals.css` reads through
 * `--font-sans` / `--font-mono` in its `@theme` block.
 */

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-geist-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

/** Canonical origin for every absolute URL Next generates (OG images, sitemap). */
export const SITE_URL: string =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NEXT_PUBLIC_VERCEL_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : 'https://quantahedron.vercel.app');

const TITLE = 'Quantahedron — Interactive Quantum Physics, Solved in Real Time';
const DESCRIPTION =
  'Ten browser-native quantum simulations: exact hydrogenic wavefunctions, live Schrödinger solvers, tunneling, spin and measurement. Every state is shareable as a URL and nothing needs a backend.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · Quantahedron',
  },
  description: DESCRIPTION,
  applicationName: 'Quantahedron',
  generator: 'Next.js',
  keywords: [
    'quantum physics',
    'interactive simulation',
    'hydrogen atom',
    'wavefunction',
    'Schrodinger equation',
    'tunneling',
    'Stern-Gerlach',
    'molecular orbitals',
    'physics education',
  ],
  authors: [{ name: 'Quantahedron' }],
  creator: 'Quantahedron',
  openGraph: {
    type: 'website',
    siteName: 'Quantahedron',
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 },
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#06080d',
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-dvh bg-obsidian text-ink antialiased">
        <ThemeApplier />
        {/* Icon and manifest links are emitted automatically from app/icon.svg and app/manifest.ts. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-obsidian-2 focus:px-3 focus:py-2 focus:text-[12px] focus:text-ink"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-[1440px] px-4 sm:px-6">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
