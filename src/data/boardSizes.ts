// ============================================================
// src/data/boardSizes.ts
//
// PURPOSE
//   Three named board-dimension presets shown in the Settings
//   screen. This file is the single source of truth for board
//   sizes referenced by `GameOptions.boardSizeId`.
//
// READ ALONGSIDE
//   - `src/domain/types.ts` — `BoardSizePreset` interface.
// ============================================================

import type { BoardSizePreset } from '../domain/types';

/**
 * The three presets the user can choose from.
 *
 * Ids are kept short and stable — they are persisted inside
 * `GameOptions.boardSizeId` and migrated forward when needed.
 *
 *   small  : 6 × 7
 *   medium : 6 × 9
 *   large  : 7 × 11
 */
export const BOARD_SIZES: BoardSizePreset[] = [
  { id: 'small',  label: 'S (6 × 7)',   width: 6, height: 7  },
  { id: 'medium', label: 'M (6 × 9)', width: 6, height: 9 },
  { id: 'large',  label: 'L (7 × 11)',  width: 7, height: 11 },
];

/** O(1) lookup: boardSizeId → preset. */
export const BOARD_SIZE_MAP: Record<string, BoardSizePreset> = Object.fromEntries(
  BOARD_SIZES.map((b) => [b.id, b]),
);

/** The id used as the default in `useSettingsStore`. */
export const DEFAULT_BOARD_SIZE_ID = 'medium';
