// ============================================================
// src/app/page.tsx
//
// PURPOSE: The root page — shown when a browser visits "/".
// In Next.js App Router every file called page.tsx inside app/
// automatically becomes a route (no router config needed).
//
// This file is a Server Component — it runs on the server and
// returns HTML. The GameSetup component it renders is a Client
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
import { GameSetup } from '../components/GameSetup/GameSetup';

/**
 * The home page — renders the game setup / game canvas.
 * No props are needed here; Next.js calls this function directly.
 */
export default function HomePage() {
  return (
    <main
      style={{
        padding: '32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px',
      }}
    >
      <h1 style={{ fontSize: '28px', fontWeight: 700 }}>Mujong</h1>
      {/*
       * GameSetup handles both the pre-game form and the live GameCanvas.
       * It reads `game` from Zustand: null → show form, non-null → show board.
       */}
      <GameSetup />
    </main>
  );
}
