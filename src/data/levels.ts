// ============================================================
// src/data/levels.ts
//
// PURPOSE: Seed level definitions.
// Each level controls board dimensions, which pieces both players
// receive, and the accent colours shown in the UI.
//
// levelNumber is the sort order shown on the selection screen.
// player1Color / player2Color are any valid CSS color strings.
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
      { figureTypeId: 'ft_slon', quantity: 2 },
      { figureTypeId: 'ft_runner', quantity: 2 },
      { figureTypeId: 'ft_cross', quantity: 1 },
      { figureTypeId: 'ft_ziraf', quantity: 1 },
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
    boardHeight: ,
    allowedFigures: [
      { figureTypeId: 'ft_slon', quantity: 2 },
      { figureTypeId: 'ft_runner', quantity: 2 },
      { figureTypeId: 'ft_cross', quantity: 1 },
      { figureTypeId: 'ft_ziraf', quantity: 1 },
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
      { figureTypeId: 'ft_cross', quantity: 1 },
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
