import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Enable Cache Components for Next.js 16
    cacheComponents: true,
  },
};

export default nextConfig;
