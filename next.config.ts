import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    '/api/lead-magnet/tarot-cheat-sheet': ['./private-assets/Deckaura-Tarot-Cheat-Sheet.pdf'],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
