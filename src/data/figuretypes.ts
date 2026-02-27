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

import type { FigureType } from '../domain/types';

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
    id: 'ft_walker',
    name: 'Walker',
    // Moves exactly 1 square in any cardinal direction.
    // The simplest piece — good for beginners to learn with.
    movement: { vertical: 1, horizontal: 1, diagonal: 0 },
    canJump: false,
  },
  {
    id: 'ft_runner',
    name: 'Runner',
    // Moves up to 3 squares vertically only.
    // A "fast lane" piece — great for rushing toward the goal
    // but cannot sidestep obstacles.
    movement: { vertical: 3, horizontal: 0, diagonal: 0 },
    canJump: false,
  },
  {
    id: 'ft_strider',
    name: 'Strider',
    // Moves up to 2 squares in ALL directions including diagonal.
    // The most versatile piece — use sparingly at higher levels.
    movement: { vertical: 2, horizontal: 2, diagonal: 2 },
    canJump: false,
  },
  {
    id: 'ft_leaper',
    name: 'Leaper',
    // Moves up to 2 vertical or 1 horizontal AND can jump over pieces.
    // Useful for escaping tight situations where other pieces are blocked.
    movement: { vertical: 2, horizontal: 1, diagonal: 0 },
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
