import type { MetadataRoute } from 'next';

/**
 * PWA manifest. Both colours are the `--color-obsidian` token from globals.css so
 * the installed app frame matches the stage chrome; `standalone` keeps a shared
 * permalink opening in its own window.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Quantahedron — Interactive Quantum Physics',
    short_name: 'Quantahedron',
    description:
      'Ten browser-native quantum simulations: hydrogenic wavefunctions, Schrödinger solvers, tunneling, spin and measurement. No backend, every state shareable as a URL.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#06080d',
    theme_color: '#06080d',
    categories: ['education', 'science'],
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
