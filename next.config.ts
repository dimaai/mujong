import type { NextConfig } from 'next';
import withPWAInit from '@ducanh2912/next-pwa';

// next.config.ts — Next.js project configuration.
// reactStrictMode: true makes React run each component twice in development
// to help catch accidental side effects early. Safe to disable if you see
// duplicate console logs while learning — just know why they appear.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
};

// PWA wrapper — generates a Workbox-based service worker into `public/` at
// build time so the static export can be installed and used offline.
// Disabled in development so the dev server's HMR isn't fighting the SW cache.
const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  disable: process.env.NODE_ENV === 'development',
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
  },
});

export default withPWA(nextConfig);
