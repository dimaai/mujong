import type { NextConfig } from 'next';
import withPWAInit from '@ducanh2912/next-pwa';

// next.config.ts — Next.js project configuration.
// reactStrictMode: true makes React run each component twice in development
// to help catch accidental side effects early. Safe to disable if you see
// duplicate console logs while learning — just know why they appear.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  // Dev-only: forward `/api/*` to the locally running Azure Functions
  // host (`func start` listens on :7071). In production the Static Web
  // App platform routes `/api/*` to the managed Functions for us, so
  // this rewrite is a no-op there (and `output: 'export'` strips it).
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') return [];
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:7071/api/:path*',
      },
    ];
  },
};

// PWA wrapper — generates a Workbox-based service worker into `public/` at
// build time so the static export can be installed and used offline.
// Disabled in development so the dev server's HMR isn't fighting the SW cache.
//
// `dynamicStartUrl: false` skips next-pwa's auto-generated NetworkFirst
// route for `/`. That route's `cacheWillUpdate` handler is emitted with
// SWC TypeScript helpers (`_async_to_generator`, `_ts_generator`) that
// are not bundled into the service worker, causing a runtime
// ReferenceError on every response — which silently broke fetch
// interception (including signaling API calls). The static export
// already precaches `index.html`, so we don't lose offline coverage.
const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  disable: process.env.NODE_ENV === 'development',
  dynamicStartUrl: false,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
  },
});

export default withPWA(nextConfig);
