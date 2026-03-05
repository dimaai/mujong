import type { NextConfig } from 'next';

// next.config.ts — Next.js project configuration.
// reactStrictMode: true makes React run each component twice in development
// to help catch accidental side effects early. Safe to disable if you see
// duplicate console logs while learning — just know why they appear.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
};

export default nextConfig;
