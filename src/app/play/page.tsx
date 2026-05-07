// ============================================================
// src/app/play/page.tsx
//
// PURPOSE
//   The "/play" route — renders the live game board.
//
//   Behaviour:
//     - If a game is in progress (useGameStore.game !== null),
//       render <GameCanvas />.
//     - Otherwise, redirect back to "/" (MainMenu) so the URL
//       can't be deep-linked into an empty board state.
//
// CLIENT COMPONENT
//   GameCanvas already requires the browser (Zustand subscriptions,
//   timers, click handlers), so the route page is also a client
//   component. Marking the page itself 'use client' is the simplest
//   correct choice — no server work happens here.
//
// SCOPE NOTE (Step 5)
//   In-progress game persistence comes in Phase D. For now,
//   reloading /play mid-game will land on an empty store and
//   redirect home. This matches the STOP condition in the plan.
// ============================================================

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { GameCanvas } from '../../components/GameCanvas/GameCanvas';
import { useGameStore } from '../../store/gameStore';

/**
 * PlayPage — Next.js route component for /play.
 *
 * Inputs:  none
 * Outputs: rendered GameCanvas, or null while redirecting.
 * Side effects: navigates to "/" if no game exists.
 */
export default function PlayPage() {
  const router = useRouter();
  const game = useGameStore((s) => s.game);

  // Redirect inside an effect — calling router.push() during render
  // would warn ("cannot update a different component while rendering").
  useEffect(() => {
    if (!game) {
      router.replace('/');
    }
  }, [game, router]);

  // Render nothing during the brief tick before the redirect fires.
  if (!game) return null;

  return (
    <main>
      <GameCanvas />
    </main>
  );
}
