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
//     - "Settings"          → disabled stub (Phase B)
//     - "Tutorial"          → disabled stub (Phase I)
//
// SCOPE NOTE (Step 5)
//   To keep gameplay byte-for-byte identical, Start Game uses a
//   hard-coded Level (LEVELS[1] — the existing default in the old
//   GameSetup). Settings-driven board size / difficulty arrives
//   in Phase B. The legacy GameSetup file stays in place; it is
//   simply no longer imported.
//
// CLIENT COMPONENT
//   Marked 'use client' because it uses useState (color picker
//   inputs are controlled), useRouter (Next navigation), and the
//   Zustand stores.
// ============================================================

'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

import { useProfileStore } from '../../store/profileStore';
import { useGameStore } from '../../store/gameStore';
import { LEVELS } from '../../data/levels';
import type { Player } from '../../domain/types';

import styles from './MainMenu.module.css';

/**
 * MainMenu — the home screen.
 *
 * Inputs:  none
 * Outputs: rendered menu form
 * Side effects:
 *   - writes to useProfileStore on every name/color change
 *   - calls useGameStore.startGame() and router.push('/play') on Start
 */
export function MainMenu() {
  const router = useRouter();

  // Profile store — single source of truth for names + colors.
  // Selecting individual slices keeps re-renders narrow.
  const player1 = useProfileStore((s) => s.player1);
  const player2 = useProfileStore((s) => s.player2);
  const setName = useProfileStore((s) => s.setName);
  const setColor = useProfileStore((s) => s.setColor);

  const startGame = useGameStore((s) => s.startGame);

  /**
   * handleStart
   *
   * Purpose:      build runtime Player objects from the persisted
   *               profiles and kick off a new game session.
   * Inputs:       none (reads profile + game stores)
   * Outputs:     none
   * Side effects: mutates the game store and navigates to /play.
   */
  function handleStart() {
    // Hard-coded current level until Phase B wires settings.
    // LEVELS[1] === 8x10 "Standard", matching the old default.
    const level = LEVELS[1] ?? LEVELS[0];

    // Apply the player-chosen accent colors on top of the level.
    const customLevel = {
      ...level,
      player1Color: player1.color,
      player2Color: player2.color,
    };

    const p1: Player = {
      id: 'p1',
      name: player1.name.trim() || 'Player 1',
      rating: 1000,
    };
    const p2: Player = {
      id: 'p2',
      name: player2.name.trim() || 'Player 2',
      rating: 1000,
    };

    // againstView default = false; re-introduced as a setting in Phase B.
    startGame(customLevel, p1, p2, false);
    router.push('/play');
  }

  return (
    <div className={styles.menuWrapper}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/logo.png" alt="Mojong" className={styles.logo} />

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
          <button
            type="button"
            className={styles.startButton}
            onClick={handleStart}
          >
            Start Game
          </button>

          {/* Disabled stubs — wired up in later phases.
              `title` doubles as the hover tooltip per the plan. */}
          <button
            type="button"
            className={styles.secondaryButton}
            disabled
            title="Coming soon"
          >
            Network Game
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled
            title="Coming soon"
          >
            Settings
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled
            title="Coming soon"
          >
            Tutorial
          </button>
        </div>
      </div>
    </div>
  );
}
