// ============================================================
// src/app/page.tsx
//
// PURPOSE: The root page — shown when a browser visits "/".
// In Next.js App Router every file called page.tsx inside app/
// automatically becomes a route (no router config needed).
//
// This file is a Server Component — it runs on the server and
// returns HTML. The MainMenu component it renders is a Client
// Component (marked 'use client') because it needs browser
// interactivity (click handlers, useState, Zustand).
//
// KEY LEARNING POINT: Server vs Client components
//   Server component → runs at build time or request time on the server
//                    → cannot use useState, useEffect, or onClick
//                    → fast, SEO-friendly
//   Client component → runs in the browser
//                    → can use React hooks and DOM events
//                    → needed for any interactive UI
// ============================================================

import React from 'react';
import { MainMenu } from '../components/MainMenu/MainMenu';

/**
 * The home page — renders the main menu.
 *
 * Step 5 split the old monolithic GameSetup into two routes:
 *   "/"      → MainMenu (this file): names, colors, action buttons.
 *   "/play"  → GameCanvas: the live board, only reachable when a
 *              game exists in the Zustand store.
 *
 * Step 23 removed the legacy GameSetup component entirely.
 */
export default function HomePage() {
  return (
    <main>
      <MainMenu />
    </main>
  );
}
