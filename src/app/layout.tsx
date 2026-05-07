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
  },
  icons: {
    // Placeholder icons — to be replaced with real 192/512/maskable assets
    // in Phase I-3. iOS uses apple-touch-icon for the Home Screen tile.
    icon: '/images/logo.png',
    apple: '/images/logo.png',
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
      <body>{children}</body>
    </html>
  );
}
