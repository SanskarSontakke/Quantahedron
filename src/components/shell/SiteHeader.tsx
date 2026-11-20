/**
 * Sticky translucent site header (server component — links only, no state).
 *
 * Nav targets are in-page anchors for the homepage tiers plus the real /learn
 * route, so no `usePathname` is needed and the header stays fully static.
 */

import Link from 'next/link';

const NAV: { href: string; label: string; hint: string }[] = [
  { href: '/', label: 'Home', hint: 'Live simulation stage' },
  { href: '/#simulations', label: 'Simulations', hint: 'All ten simulations' },
  { href: '/learn', label: 'Learn', hint: 'Concept library index' },
  { href: '/#concepts', label: 'Concepts', hint: 'Concept anchors on the homepage' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-obsidian/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          title="Quantahedron home"
          aria-label="Quantahedron home"
        >
          <span
            className="text-plasma transition-transform group-hover:rotate-90"
            style={{ transitionDuration: '400ms' }}
            aria-hidden
          >
            <svg viewBox="0 0 32 32" width="26" height="26" fill="none" role="presentation">
              <circle cx="16" cy="16" r="2.6" fill="currentColor" />
              <ellipse cx="16" cy="16" rx="13" ry="6" stroke="currentColor" strokeWidth="1.4" opacity="0.9" />
              <ellipse
                cx="16"
                cy="16"
                rx="13"
                ry="6"
                stroke="currentColor"
                strokeWidth="1.4"
                opacity="0.55"
                transform="rotate(60 16 16)"
              />
              <ellipse
                cx="16"
                cy="16"
                rx="13"
                ry="6"
                stroke="currentColor"
                strokeWidth="1.4"
                opacity="0.35"
                transform="rotate(120 16 16)"
              />
            </svg>
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight text-ink">Quantahedron</span>
            <span className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-ink-faint">
              Interactive physics, solved live
            </span>
          </span>
        </Link>

        <nav aria-label="Primary" className="ml-auto">
          <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={item.hint}
                  className="block rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink-dim transition-colors hover:bg-white/5 hover:text-ink"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
