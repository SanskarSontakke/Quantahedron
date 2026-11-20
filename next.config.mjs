/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Lint runs as its own step (`npm run lint`); a style warning must never
    // block a Vercel production build. Type errors still fail the build.
    dirs: ['src'],
  },
  experimental: {
    optimizePackageImports: ['katex', '@react-three/drei'],
  },
  env: {
    NEXT_PUBLIC_APP_NAME: 'Quantahedron',
  },
};

export default nextConfig;
