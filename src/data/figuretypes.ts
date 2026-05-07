// ============================================================
// src/data/figuretypes.ts
//
// PURPOSE: Seed definitions for all available figure types.
// Think of these as the "piece catalog" — like chess pieces
// but with configurable movement ranges.
//
// To add a new type: add an entry to FIGURE_TYPES.
// To change movement: edit the `movement` object on that entry.
// ============================================================

import type { AllowedFigure, Difficulty, FigureType } from '../domain/types';

/**
 * All figure types available in the game.
 *
 * Movement key:
 *   vertical:   max squares up or down
 *   horizontal: max squares left or right
 *   diagonal:   max squares in any diagonal direction
 *   0 = cannot move in that direction
 */
export const FIGURE_TYPES: FigureType[] = [
  {
    id: 'ft_slon',
    name: 'Slon',
    // Moves exactly 1 square in any cardinal direction.
    // The simplest piece — good for beginners to learn with.
    movement: { vertical: 0, horizontal: 0, diagonal: 1 },
    canJump: false,
  },
  {
    id: 'ft_runner',
    name: 'Runner',
    // Moves up to 3 squares vertically only.
    // A "fast lane" piece — great for rushing toward the goal
    // but cannot sidestep obstacles.
    movement: { vertical: 2, horizontal: 2, diagonal: 0 },
    canJump: false,
  },
  {
    id: 'ft_cross',
    name: 'Cross',
    // Moves up to 2 squares in ALL directions including diagonal.
    // The most versatile piece — use sparingly at higher levels.
    movement: { vertical: 1, horizontal: 1, diagonal: 0 },
    canJump: false,
  },
  {
    id: 'ft_ziraf',
    name: 'Ziraf',
    // Moves up to 2 vertical orI 1 horizontal AND can jump over pieces.
    // Useful for escaping tight situations where other pieces are blocked.
    movement: { vertical: 0, horizontal: 0, diagonal: 2 },
    canJump: true,
  },
];

/**
 * A lookup map from figureTypeId → FigureType.
 * Using a Map-like Record gives O(1) access in rules and components
 * instead of scanning the array each time.
 *
 * Object.fromEntries converts [ ['key', value], ... ] into { key: value, ... }.
 * The .map() call transforms each FigureType into a [id, type] tuple.
 */
export const FIGURE_TYPE_MAP: Record<string, FigureType> = Object.fromEntries(
  FIGURE_TYPES.map((ft) => [ft.id, ft]),
);

// ── Difficulty → roster mapping (Step 7) ──────────────────────
//
// Each difficulty maps to a piece roster (`AllowedFigure[]`) that
// each player receives at the start of a game. Replaces the
// per-level `Level.allowedFigures` field used by the legacy flow.
//
// Rosters are tuned so that:
//   - beginner  → fewer pieces and the simplest movers, easier to learn.
//   - normal    → matches the current default the game ships with so
//                 existing players see no behavioural change.
//   - advanced  → more pieces and more jumpers, longer/denser games.

const ROSTER_BY_DIFFICULTY: Record<Difficulty, AllowedFigure[]> = {
  beginner: [
    { figureTypeId: 'ft_slon', quantity: 2 },
    { figureTypeId: 'ft_runner', quantity: 1 },
    { figureTypeId: 'ft_cross', quantity: 1 },
  ],
  normal: [
    { figureTypeId: 'ft_slon', quantity: 2 },
    { figureTypeId: 'ft_runner', quantity: 2 },
    { figureTypeId: 'ft_cross', quantity: 1 },
    { figureTypeId: 'ft_ziraf', quantity: 1 },
  ],
  advanced: [
    { figureTypeId: 'ft_slon', quantity: 2 },
    { figureTypeId: 'ft_runner', quantity: 2 },
    { figureTypeId: 'ft_cross', quantity: 2 },
    { figureTypeId: 'ft_ziraf', quantity: 2 },
  ],
};

/**
 * Returns the per-player figure roster for a given difficulty.
 *
 * Inputs:  `difficulty` — one of 'beginner' | 'normal' | 'advanced'.
 * Outputs: a fresh `AllowedFigure[]` (cloned so callers may mutate
 *          freely without affecting the canonical mapping).
 * Side effects: none.
 */
export function getFigureRosterFor(difficulty: Difficulty): AllowedFigure[] {
  return ROSTER_BY_DIFFICULTY[difficulty].map((entry) => ({ ...entry }));
}
