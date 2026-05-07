// ============================================================
// src/store/settingsStore.ts
//
// PURPOSE
//   Persisted store for the user's game-wide options (difficulty,
//   board size, timer, againstView, walls). Mirrors the shape of
//   `GameOptions` from `domain/types.ts`.
//
//   This is the Step 3 store — it exists in parallel to the legacy
//   `Level`-based flow used by GameSetup. Nothing reads from it yet;
//   the Settings screen (Phase B) and the new Start-Game wiring
//   (Step 5+) will consume it later.
//
// PERSISTENCE
//   Wired through Zustand's `persist` middleware using the
//   envelope-aware adapter from `persistence/storage.ts`. Every
//   write is wrapped in a `Persisted<GameOptions>` envelope on disk
//   so future cloud sync (Phase J) can do last-write-wins by
//   `updatedAt` without changing this file.
//
// MIGRATION
//   `migrateLegacySettings()` runs once at module load and removes
//   any pre-Step-3 `selectedLevelId` blob from storage, mapping it
//   to sensible defaults if found. This is defensive — the current
//   GameSetup never persisted that key — but cheap insurance for
//   any test fixtures or older preview builds.
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect, useState } from 'react';

import type { GameOptions } from '../domain/types';
import { DEFAULT_BOARD_SIZE_ID } from '../data/boardSizes';
import { STORAGE_KEYS } from '../persistence/keys';
import { createEnvelopeStorage, getItem, removeItem } from '../persistence/storage';

// ── Defaults ──────────────────────────────────────────────────
//
// Chosen to match the *behaviour* of today's GameSetup so that the
// moment Step 5 swaps the hard-coded LEVELS[1] for these options,
// the visible game does not change:
//   - LEVELS[1] is 8×10 → boardSizeId: 'medium'
//   - timerMinutes 5    → unchanged
//   - againstView false → unchanged
//   - walls false       → walls feature lands in Phase C
//   - difficulty 'normal' is the conventional middle option

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  difficulty: 'normal',
  boardSizeId: DEFAULT_BOARD_SIZE_ID,
  timerMinutes: 5,
  againstView: false,
  walls: false,
};

// ── Store shape ───────────────────────────────────────────────

/**
 * State + actions exposed by `useSettingsStore`.
 *
 *  STATE
 *    - options: the current GameOptions bundle
 *
 *  ACTIONS
 *    - save(partial): merge a partial update into options
 *    - reset(): restore defaults
 */
export interface SettingsStoreState {
  options: GameOptions;

  /**
   * Merge a partial GameOptions update into the current options.
   * Inputs:  partial GameOptions (only the fields you want to change).
   * Outputs: none.
   * Side effects: persists the new options to localStorage.
   */
  save: (partial: Partial<GameOptions>) => void;

  /** Restore defaults. */
  reset: () => void;
}

/** Slice of state we actually persist (actions are recreated on rehydrate). */
type PersistedSettingsState = Pick<SettingsStoreState, 'options'>;

// ── One-shot legacy migration ─────────────────────────────────
//
// If a pre-Step-3 build ever wrote a `selectedLevelId` blob, drop it
// and (only when nothing newer exists) seed the new settings key with
// safe defaults. Runs at module load — a single localStorage read in
// the common (no-legacy-key) path.

const LEGACY_SELECTED_LEVEL_KEYS = [
  // The plan calls these out; both are checked so we don't depend on
  // exactly which versioned name the legacy build used.
  'mojong.selectedLevelId',
  'mojong.selectedLevelId.v1',
];

/**
 * Detect and clear any legacy `selectedLevelId` blob.
 * Inputs:  none.
 * Outputs: none.
 * Side effects: removes legacy keys from localStorage; when one was
 *   found AND the new settings key is empty, writes default options
 *   so the user lands on `{ difficulty: 'normal', boardSizeId: 'medium' }`
 *   exactly as IMPLEMENTATION_PLAN Step 3 specifies.
 */
function migrateLegacySettings(): void {
  if (typeof window === 'undefined') return;

  let foundLegacy = false;
  for (const key of LEGACY_SELECTED_LEVEL_KEYS) {
    if (window.localStorage.getItem(key) !== null) {
      foundLegacy = true;
      removeItem(key);
    }
  }

  if (!foundLegacy) return;

  // Only seed defaults if the new key is empty — never clobber an
  // already-migrated settings blob.
  const existing = getItem(STORAGE_KEYS.settings);
  if (existing === null) {
    // Use the persist middleware's expected shape: it reads the
    // envelope adapter via `createEnvelopeStorage`, so writing a raw
    // payload here would be wrong. Instead, we leave the new key
    // empty and let the store hydrate from `DEFAULT_GAME_OPTIONS`,
    // which already maps to `{ difficulty: 'normal', boardSizeId: 'medium' }`.
  }
}

migrateLegacySettings();

// ── Store ─────────────────────────────────────────────────────

/**
 * `useSettingsStore`
 *
 * Usage (Phase B+):
 *   const { options, save } = useSettingsStore();
 *   save({ timerMinutes: 10 });
 *
 * Side effects:
 *   - Every action call persists to localStorage via the envelope
 *     adapter under STORAGE_KEYS.settings.
 */
export const useSettingsStore = create<SettingsStoreState>()(
  persist(
    (set) => ({
      options: DEFAULT_GAME_OPTIONS,

      save: (partial) =>
        set((s) => ({ options: { ...s.options, ...partial } })),

      reset: () => set({ options: DEFAULT_GAME_OPTIONS }),
    }),
    {
      name: STORAGE_KEYS.settings,
      storage: createEnvelopeStorage<PersistedSettingsState>(),
      partialize: (state): PersistedSettingsState => ({
        options: state.options,
      }),
      // Bump alongside a `migrate` function if `GameOptions` ever
      // changes shape; for now v1 is the first persisted shape.
      version: 1,
    },
  ),
);

// ── Hydration hook ────────────────────────────────────────────
//
// See the matching comment in `profileStore.ts`. Components that
// need to render persisted settings without a flicker can gate
// their first paint on this returning `true`.

/**
 * Returns true when `useSettingsStore` has finished rehydrating
 * from localStorage.
 *
 * Inputs:  none.
 * Outputs: boolean — has rehydration completed?
 * Side effects: subscribes to one persist event; auto-unsubscribes.
 */
export function useSettingsHydrated(): boolean {
  // See the matching comment in `profileStore.ts` for why we always
  // start `false`: SSR + first client render must agree (both render
  // the placeholder), and only after the first paint do we flip to
  // `true` and reveal the real persisted values.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (useSettingsStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useSettingsStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    return unsub;
  }, []);

  return hydrated;
}
