// ============================================================
// src/data/levels.ts
//
// @deprecated (Step 7) — DO NOT add new readers.
//
// Since Step 7 the live game-flow is driven by `useSettingsStore`
// (`GameOptions`) + `useProfileStore` (`Profile`) + the
// difficulty→roster mapping in `figuretypes.ts`. This module now
// only survives because the legacy `GameSetup` component (which is
// no longer imported by the running app) still references `LEVELS`.
//
// Phase I will delete `GameSetup` and this file together.
//
// PURPOSE (historical)
//   Seed level definitions: board dimensions, per-player roster,
//   accent colours, and timer minutes — all bundled into one type.
// ============================================================

import type { Level } from '../domain/types';

export const LEVELS: Level[] = [
  {
    levelId: 'level_1',
    levelNumber: 1,
    levelName: 'Beginner',
    // Small 6×6 board — easier to understand movement and strategy.
    boardWidth: 6,
    boardHeight: 9,
    // Each player gets 3 Walkers and 1 Runner.
    // Simple set so you can learn placement and basic movement.
    allowedFigures: [
      { figureTypeId: 'ft_slon', quantity: 0 },
      { figureTypeId: 'ft_runner', quantity: 2 },
      { figureTypeId: 'ft_cross', quantity: 0 },
      { figureTypeId: 'ft_ziraf', quantity: 0 },
    ],
    player1Color: '#4A90D9', // blue
    player2Color: '#D94A4A', // red
    timerMinutes: 5,
  },
  {
    levelId: 'level_2',
    levelNumber: 2,
    levelName: 'Standard',
    // Full 8×8 board — more room and more pieces to manage.
    boardWidth: 8,
    boardHeight: 10,
    allowedFigures: [
      { figureTypeId: 'ft_slon', quantity: 2 },
      { figureTypeId: 'ft_runner', quantity: 2 },
      { figureTypeId: 'ft_cross', quantity: 1 },
      { figureTypeId: 'ft_ziraf', quantity: 0 },
    ],
    player1Color: '#4A90D9',
    player2Color: '#D94A4A',
    timerMinutes: 5,
  },
  {
    levelId: 'level_3',
    levelNumber: 3,
    levelName: 'Advanced',
    // Wider board — encourages horizontal planning.
    boardWidth: 6,
    boardHeight: 11,
    allowedFigures: [
      { figureTypeId: 'ft_slon', quantity: 2 },
      { figureTypeId: 'ft_runner', quantity: 2 },
      { figureTypeId: 'ft_cross', quantity: 2 },
      { figureTypeId: 'ft_ziraf', quantity: 1 },
      // { figureTypeId: 'ft_ziraf', quantity: 1 },
    ],
    player1Color: '#2E7D32', // green
    player2Color: '#6A1B9A', // purple
    timerMinutes: 5,
  },
];

/**
 * O(1) lookup: levelId → Level.
 */
export const LEVEL_MAP: Record<string, Level> = Object.fromEntries(
  LEVELS.map((l) => [l.levelId, l]),
);
