// ============================================================
// src/components/MainMenu/MainMenu.tsx
//
// PURPOSE
//   The home screen ("/") shown when no game is active. Replaces
//   the monolithic GameSetup form with a smaller menu surface:
//     - Player 1 / Player 2 name + color (read/written through
//       useProfileStore so values persist across reloads).
//     - "Start Game"        → starts a new game and navigates to /play
//     - "Network Game"      → disabled stub (Phase G)
//     - "Settings"          → navigates to /settings (Step 6)
//     - "Tutorial"          → disabled stub (Phase I)
//
// SCOPE NOTE (Step 7)
//   Start Game now reads the live `GameOptions` from
//   `useSettingsStore` (difficulty, boardSizeId, timer, againstView,
//   walls) instead of the hard-coded `LEVELS[1]`. The legacy
//   `LEVELS` table is no longer imported here.
//
// CLIENT COMPONENT
//   Marked 'use client' because it uses useState (color picker
//   inputs are controlled), useRouter (Next navigation), and the
//   Zustand stores.
// ============================================================

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useProfileStore, useProfileHydrated } from '../../store/profileStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useGameStore, getResumableSnapshotMeta } from '../../store/gameStore';
import { InstallPill } from '../PwaInstall/InstallPill';
import { InstallHintIOS } from '../PwaInstall/InstallHintIOS';

import styles from './MainMenu.module.css';

/**
 * MainMenu — the home screen.
 *
 * Inputs:  none
 * Outputs: rendered menu form
 * Side effects:
 *   - writes to useProfileStore on every name/color change
 *   - calls useGameStore.startGame() and router.push('/play') on Start
 *   - on mount, reads `getResumableSnapshotMeta()` once so the
 *     "Resume game" banner (Step 29) knows whether to render
 */
export function MainMenu() {
  const router = useRouter();

  // Profile store — single source of truth for names + colors.
  // Selecting individual slices keeps re-renders narrow.
  const player1 = useProfileStore((s) => s.player1);
  const player2 = useProfileStore((s) => s.player2);
  const setName = useProfileStore((s) => s.setName);
  const setColor = useProfileStore((s) => s.setColor);

  // Settings store — drives board size, difficulty, timer, etc.
  const options = useSettingsStore((s) => s.options);

  const startGame = useGameStore((s) => s.startGame);
  const clearSnapshot = useGameStore((s) => s.clearSnapshot);

  // Resume banner state (Step 29). `null` = no banner; populated
  // value = render banner with that turnNumber. We read once on
  // mount in a useEffect (not during render) because
  // `getResumableSnapshotMeta` touches localStorage and must run
  // client-side only — SSR has no `window`.
  const [resumeMeta, setResumeMeta] = useState<{ turnNumber: number } | null>(
    null,
  );
  useEffect(() => {
    setResumeMeta(getResumableSnapshotMeta());
  }, []);

  // Wait for the persisted profile to rehydrate before painting,
  // otherwise the user sees DEFAULT_PLAYER1/2 ("Player 1" / blue)
  // for one frame on every reload before their saved values appear.
  // SSR + persist middleware always cause that flicker unless we
  // explicitly gate rendering on `hasHydrated`.
  const profileHydrated = useProfileHydrated();

  /**
   * handleStart
   *
   * Purpose:      kick off a new game session from the persisted
   *               profiles + settings.
   * Inputs:       none (reads profile + settings stores)
   * Outputs:      none
   * Side effects: mutates the game store and navigates to /play.
   */
  function handleStart() {
    startGame({
      options,
      profiles: [player1, player2],
    });
    router.push('/play');
  }

  /**
   * handleResume
   *
   * Purpose:      navigate to /play so its existing snapshot-
   *               hydration path (Step 28) restores the game.
   * Inputs:       none
   * Outputs:      none
   * Side effects: triggers a client-side route change.
   *
   * We deliberately do NOT call hydrateFromSnapshot() here. The
   * /play page already does that on mount, and double-hydration
   * would just re-stamp the same state.
   */
  function handleResume() {
    router.push('/play');
  }

  /**
   * handleDiscard
   *
   * Purpose:      drop the saved game so the banner disappears
   *               and the next /play visit redirects home.
   * Inputs:       none
   * Outputs:      none
   * Side effects: removes the localStorage envelope (via
   *               gameStore.clearSnapshot) and re-renders without
   *               the banner.
   */
  function handleDiscard() {
    clearSnapshot();
    setResumeMeta(null);
  }

  // Pre-hydration we render the SAME DOM but invisible, so:
  //   - SSR HTML and the first client paint are byte-identical
  //     (no React hydration warning),
  //   - the page reserves the correct space (no layout shift /
  //     "flicker" when the form pops in),
  //   - the user never sees DEFAULT_PLAYER1/2 because the form is
  //     literally invisible until the persisted values are applied.
  //
  // We use `visibility: hidden` (not `display: none`) so the layout
  // is reserved. `aria-hidden` keeps screen readers quiet during the
  // brief invisible phase.
  const wrapperStyle: React.CSSProperties | undefined = profileHydrated
    ? undefined
    : { visibility: 'hidden' };

  return (
    <div
      className={styles.menuWrapper}
      style={wrapperStyle}
      aria-hidden={!profileHydrated}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/logo.png" alt="Mojong" className={styles.logo} />

      {resumeMeta !== null && (
        <div className={styles.resumeBanner} role="region" aria-label="Resume game">
          <span className={styles.resumeText}>
            Resume game · turn {resumeMeta.turnNumber}
          </span>
          <div className={styles.resumeActions}>
            <button
              type="button"
              className={styles.resumeButton}
              onClick={handleResume}
            >
              Resume
            </button>
            <button
              type="button"
              className={styles.discardButton}
              onClick={handleDiscard}
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="p1Name">Player 1 name (bottom)</label>
          <div className={styles.nameRow}>
            <input
              id="p1Name"
              type="text"
              value={player1.name}
              onChange={(e) => setName('player1', e.target.value)}
              maxLength={25}
            />
            <input
              id="p1Color"
              type="color"
              value={player1.color}
              onChange={(e) => setColor('player1', e.target.value)}
              className={styles.colorTile}
              aria-label="Player 1 color"
            />
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="p2Name">Player 2 name (top)</label>
          <div className={styles.nameRow}>
            <input
              id="p2Name"
              type="text"
              value={player2.name}
              onChange={(e) => setName('player2', e.target.value)}
              maxLength={25}
            />
            <input
              id="p2Color"
              type="color"
              value={player2.color}
              onChange={(e) => setColor('player2', e.target.value)}
              className={styles.colorTile}
              aria-label="Player 2 color"
            />
          </div>
        </div>

        <div className={styles.buttons}>
          {/* PWA install pill (Step 31). Renders only when the
              browser fired `beforeinstallprompt` and we're not
              already in standalone mode — see usePwaInstall. */}
          <InstallPill />

          <button
            type="button"
            className={styles.startButton}
            onClick={handleStart}
          >
            Start Game
          </button>

          {/* Network Game — Step 15 wires this up to the /network
              lobby. The actual game-over-network handshake lands
              in the next slice. */}
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => router.push('/network')}
          >
            Network Game
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => router.push('/settings')}
          >
            Settings
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => router.push('/tutorial')}
          >
            Tutorial
          </button>
        </div>
      </div>

      {/* iOS-Safari install hint (Step 31). Self-gates on device,
          standalone-mode, and a one-shot dismissal flag, so it
          renders nothing on other platforms or after the first
          acknowledgement. */}
      <InstallHintIOS />
    </div>
  );
}
