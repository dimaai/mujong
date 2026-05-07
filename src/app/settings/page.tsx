// ============================================================
// src/app/settings/page.tsx
//
// PURPOSE
//   The "/settings" route — renders the <Settings /> form.
//
//   Behaviour:
//     - Always renders the form. Unlike /play, there is no
//       guard: settings can be edited regardless of whether a
//       game is in progress.
//
// CLIENT COMPONENT
//   The Settings component uses useState, useRouter, and a
//   Zustand store, so the route is also a client component.
//   Marking the page itself 'use client' is the simplest correct
//   choice — no server work happens here.
// ============================================================

'use client';

import React from 'react';

import { Settings } from '../../components/Settings/Settings';

/**
 * SettingsPage — Next.js route component for /settings.
 *
 * Inputs:  none
 * Outputs: rendered Settings form
 * Side effects: none directly (delegated to <Settings />).
 */
export default function SettingsPage() {
  return (
    <main>
      <Settings />
    </main>
  );
}
