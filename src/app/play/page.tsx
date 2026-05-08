// ============================================================
// src/app/play/page.tsx
//
// PURPOSE
//   The "/play" route — renders the live game board.
//
//   Behaviour:
//     - If a game is in progress (useGameStore.game !== null),
//       render <GameCanvas />.
//     - On mount with no in-memory game, attempt to rehydrate
//       from the localStorage snapshot (Step 10). This lets a
//       refresh — or an "Add to Home Screen" relaunch on iOS —
//       resume the same match instead of dumping the user back
//       to the menu.
//     - If no snapshot exists, redirect to "/" so the URL can't
//       be deep-linked into an empty board state.
//
// CLIENT COMPONENT
//   GameCanvas already requires the browser (Zustand subscriptions,
//   timers, click handlers), so the route page is also a client
//   component. Marking the page itself 'use client' is the simplest
//   correct choice — no server work happens here.
// ============================================================

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { GameCanvas } from '../../components/GameCanvas/GameCanvas';
import { useGameStore } from '../../store/gameStore';

// Module-level guard so the one-shot snapshot hydration runs at
// most once per page-module lifetime. On a hard refresh the module
// reloads, so the flag resets — exactly the behaviour we want.
let didAttemptHydration = false;

/**
 * PlayPage — Next.js route component for /play.
 *
 * Inputs:  none
 * Outputs: rendered GameCanvas, or null while redirecting.
 * Side effects:
 *   - on first mount with no in-memory game, synchronously calls
 *     `useGameStore.hydrateFromSnapshot()` BEFORE the `game`
 *     selector subscribes — this avoids a one-frame flicker on
 *     refresh-mid-game;
 *   - whenever `game` becomes null (initial empty store, snapshot
 *     missing, or "Exit Game" inside the canvas), redirects home.
 */
export default function PlayPage() {
  const router = useRouter();

  // Synchronous hydration. Running this in the component body
  // (instead of useEffect) means the very next line — the `game`
  // selector — sees the rehydrated state and the first paint
  // already shows the board.
  if (!didAttemptHydration && typeof window !== 'undefined') {
    didAttemptHydration = true;
    if (!useGameStore.getState().game) {
      useGameStore.getState().hydrateFromSnapshot();
    }
  }

  const game = useGameStore((s) => s.game);

  // Redirect on EVERY transition to "no game", not just on mount.
  // This covers Exit Game from inside the canvas, which calls
  // resetGame() but doesn't navigate on its own.
  useEffect(() => {
    if (!game) router.replace('/');
  }, [game, router]);

  if (!game) return null;

  return (
    <main>
      <GameCanvas />
    </main>
  );
}
