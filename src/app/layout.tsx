// ============================================================
// src/app/layout.tsx
//
// PURPOSE: The root layout for the entire Next.js app.
// Every page is rendered INSIDE this layout's {children} slot.
// Put shared HTML structure, fonts, and global metadata here.
//
// This is a Server Component (no 'use client') — Next.js renders
// it on the server and sends the HTML to the browser. Pages that
// need interactivity will declare 'use client' themselves.
// ============================================================

import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SyncBootstrap } from './SyncBootstrap';
import { UpdateToast } from '../components/PwaUpdate/UpdateToast';
import { ErrorBoundary } from '../components/ErrorBoundary/ErrorBoundary';

/**
 * metadata is a Next.js App Router convention.
 * It sets <title>, <meta>, <link rel="manifest">, and Apple PWA meta tags
 * automatically. You do not need to add a <head> tag manually.
 */
export const metadata: Metadata = {
  title: 'Mojong',
  description: 'A 2-player strategy board game',
  manifest: '/manifest.webmanifest',
  applicationName: 'Mojong',
  appleWebApp: {
    // Enables fullscreen "standalone" launch from iOS Home Screen.
    capable: true,
    title: 'Mojong',
    statusBarStyle: 'black-translucent',
    // Apple shows a startup image only when a `<link rel="apple-touch-startup-image">`
    // matches the device's exact pixel size + DPR. Each entry below is paired with
    // the matching media query for one common modern iPhone. Add more as needed —
    // the matching PNG is produced by `scripts/generate-pwa-icons.mjs`.
    startupImage: [
      {
        url: '/images/apple-splash-1290x2796.png',
        media:
          '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)',
      },
      {
        url: '/images/apple-splash-1170x2532.png',
        media:
          '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)',
      },
      {
        url: '/images/apple-splash-1080x2340.png',
        media:
          '(device-width: 360px) and (device-height: 780px) and (-webkit-device-pixel-ratio: 3)',
      },
    ],
  },
  icons: {
    // Real PWA icon set generated from public/images/logo-master.svg via
    // `npm run generate:pwa-icons` (Step 30). Android picks 192/512 from
    // the manifest; iOS picks the apple-touch-icon from this `apple` field.
    icon: [
      { url: '/images/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/images/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/images/apple-touch-icon-180.png',
  },
};

/**
 * viewport is a separate Next 15 export. `themeColor` paints the iOS status
 * bar / Android URL bar to match the app shell.
 */
export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * RootLayout wraps every page in the app.
 *
 * @param children - the current page's rendered output, injected by Next.js
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/*
       * Next.js automatically injects <head> content (meta, title, etc.)
       * based on the `metadata` export above — no manual <Head> needed.
       */}
      <body>
        {/*
         * SyncBootstrap is a client component that installs the
         * cloud-sync listeners once per app load (Step 25). It
         * renders nothing and is a no-op when the
         * NEXT_PUBLIC_SYNC_BASE_URL feature flag is unset.
         */}
        <SyncBootstrap />
        {/*
         * UpdateToast (Step 32) listens for waiting service
         * workers and prompts the user to reload onto the new
         * bundle. Renders nothing when no update is pending.
         */}
        <UpdateToast />
        {/*
         * ErrorBoundary (Step 33) catches render-time errors in
         * the page subtree and swaps it for a friendly fallback
         * instead of letting the user see a blank screen. The
         * SyncBootstrap + UpdateToast above sit outside the
         * boundary on purpose — they render nothing and have
         * their own internal try/catch via React/SW APIs, so a
         * crash there shouldn't take down the recovery UI.
         */}
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
