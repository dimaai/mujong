// ============================================================
// src/app/tutorial/page.tsx
//
// PURPOSE
//   The "/tutorial" route — renders the static <Tutorial /> page.
//   Server component: no client JS is needed because the page
//   is a read-only explainer with simple <Link> navigation.
// ============================================================

import React from 'react';

import { Tutorial } from '../../components/Tutorial/Tutorial';

/**
 * TutorialPage — Next.js route component for /tutorial.
 *
 * Inputs:  none
 * Outputs: rendered Tutorial page
 * Side effects: none
 */
export default function TutorialPage() {
  return (
    <main>
      <Tutorial />
    </main>
  );
}
