// ============================================================
// src/data/boardSizes.ts
//
// PURPOSE
//   Three named board-dimension presets shown in the (future)
//   Settings screen. Seeded from the existing LEVELS so the new
//   `GameOptions.boardSizeId` path produces the same boards the
//   current `Level`-based flow already produces.
//
// READ ALONGSIDE
//   - `src/data/levels.ts` — the legacy level data we're sourcing
//     dimensions from. Once Phase C ships, `LEVELS` goes away and
//     this file becomes the single source of truth for board sizes.
//   - `src/domain/types.ts` — `BoardSizePreset` interface.
// ============================================================

import type { BoardSizePreset } from '../domain/types';

/**
 * The three presets the user can choose from.
 *
 * Ids are kept short and stable — they are persisted inside
 * `GameOptions.boardSizeId` and migrated forward when needed.
 *
 *   small  → seeded from LEVELS[0] (Beginner) :  6 × 9
 *   medium → seeded from LEVELS[1] (Standard) :  8 × 10
 *   large  → seeded from LEVELS[2] (Advanced) :  6 × 11
 */
export const BOARD_SIZES: BoardSizePreset[] = [
  { id: 'small',  label: 'Small (6 × 7)',   width: 6, height: 7  },
  { id: 'medium', label: 'Medium (8 × 9)', width: 8, height: 9 },
  { id: 'large',  label: 'Large (6 × 11)',  width: 6, height: 11 },
];

/** O(1) lookup: boardSizeId → preset. */
export const BOARD_SIZE_MAP: Record<string, BoardSizePreset> = Object.fromEntries(
  BOARD_SIZES.map((b) => [b.id, b]),
);

/** The id used as the default in `useSettingsStore`. */
export const DEFAULT_BOARD_SIZE_ID = 'medium';
