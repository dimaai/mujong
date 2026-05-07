// ============================================================
// src/store/profileStore.ts
//
// PURPOSE
//   Holds the two device-local *profiles* (player1, player2) that
//   the user edits on the main menu and that get copied into a
//   running game when they press "Start Game".
//
//   This store is intentionally tiny and framework-agnostic in
//   shape — only React-binding (`create`) is imported, which is
//   the same hook React Native would use, so the store survives a
//   future mobile port unchanged.
//
// PERSISTENCE
//   Wired through Zustand's `persist` middleware using our custom
//   envelope-aware storage adapter (see persistence/storage.ts).
//   That means every write to the store is automatically saved to
//   localStorage under `STORAGE_KEYS.profile`, wrapped in a
//   `Persisted<T>` envelope (with `updatedAt` + `deviceId`) so the
//   future cloud-sync layer (Phase J) can do last-write-wins
//   without changes here.
//
// SCOPE NOTE
//   No UI is wired in this step. `GameSetup` is untouched on
//   purpose — Step 5 will introduce `MainMenu` which reads/writes
//   this store.
// ============================================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect, useState } from 'react';

import type { Profile } from '../domain/types';
import { STORAGE_KEYS } from '../persistence/keys';
import { createEnvelopeStorage } from '../persistence/storage';

// ── Defaults ──────────────────────────────────────────────────
//
// Defaults match the look the existing game ships with so that
// when MainMenu finally reads from this store, the visible defaults
// don't change for current users.

const DEFAULT_PLAYER1: Profile = { name: 'Player 1', color: 'blue' };
const DEFAULT_PLAYER2: Profile = { name: 'Player 2', color: 'red' };

/** Which profile slot an action targets. */
export type ProfileSlot = 'player1' | 'player2';

// ── Store shape ───────────────────────────────────────────────

/**
 * State + actions exposed by `useProfileStore`.
 *
 *  STATE
 *    - player1 / player2: the persisted profiles
 *
 *  ACTIONS
 *    - setName(slot, name): update one profile's display name
 *    - setColor(slot, color): update one profile's accent color
 *    - reset(): restore both profiles to their defaults
 */
export interface ProfileStoreState {
  player1: Profile;
  player2: Profile;

  setName: (slot: ProfileSlot, name: string) => void;
  setColor: (slot: ProfileSlot, color: string) => void;
  reset: () => void;
}

/**
 * The persisted slice. We deliberately exclude actions from
 * `partialize` — actions are functions, not data, and re-creating
 * them on rehydrate is the standard Zustand pattern.
 */
type PersistedProfileState = Pick<ProfileStoreState, 'player1' | 'player2'>;

// ── Store ─────────────────────────────────────────────────────

/**
 * `useProfileStore`
 *
 * Usage from a React component (Step 5+):
 *   const { player1, setName } = useProfileStore();
 *   setName('player1', 'Alice');
 *
 * Side effects:
 *   - Every action call triggers a write to localStorage via the
 *     envelope adapter. No explicit save needed.
 */
export const useProfileStore = create<ProfileStoreState>()(
  persist(
    (set) => ({
      player1: DEFAULT_PLAYER1,
      player2: DEFAULT_PLAYER2,

      setName: (slot, name) =>
        set((s) => ({ [slot]: { ...s[slot], name } } as Pick<ProfileStoreState, ProfileSlot>)),

      setColor: (slot, color) =>
        set((s) => ({ [slot]: { ...s[slot], color } } as Pick<ProfileStoreState, ProfileSlot>)),

      reset: () => set({ player1: DEFAULT_PLAYER1, player2: DEFAULT_PLAYER2 }),
    }),
    {
      name: STORAGE_KEYS.profile,
      // Custom storage so writes get wrapped in `Persisted<T>`
      // (updatedAt + deviceId) — see persistence/storage.ts.
      storage: createEnvelopeStorage<PersistedProfileState>(),
      // Persist data only; actions are recreated on rehydrate.
      partialize: (state): PersistedProfileState => ({
        player1: state.player1,
        player2: state.player2,
      }),
      // Bump this if the persisted shape ever changes; pair with a
      // `migrate` function to translate older blobs.
      version: 1,
    },
  ),
);

// ── Hydration hook ────────────────────────────────────────────
//
// Zustand's `persist` middleware reads localStorage AFTER the first
// client render, which means components that read the store render
// once with `DEFAULT_*` and then re-render with the real persisted
// values — producing a visible "flicker" on reload.
//
// `useProfileHydrated()` flips to `true` only once rehydration is
// complete, so callers can gate their first paint on it and avoid
// rendering the defaults at all.

/**
 * Returns true when `useProfileStore` has finished rehydrating
 * from localStorage. On the server (SSR) and on the very first
 * client render this is `false`; it becomes `true` synchronously
 * after `persist` finishes reading storage.
 *
 * Inputs:  none.
 * Outputs: boolean — has rehydration completed?
 * Side effects: subscribes to one persist event; auto-unsubscribes.
 */
export function useProfileHydrated(): boolean {
  // IMPORTANT: always start `false`, even when
  // `persist.hasHydrated()` already reports `true`.
  //
  // - During SSR, our storage adapter is a no-op so persist treats
  //   rehydration as "done with no data" and `hasHydrated()` is true,
  //   meaning the server-rendered HTML would contain DEFAULT values.
  // - The very first client render must match the SSR HTML to avoid
  //   hydration mismatches, so it also has to render with defaults.
  // - Only AFTER the first paint (i.e. inside `useEffect`) is it safe
  //   to flip to `true` and re-render with the real persisted values.
  //
  // The visible result: one paint of the placeholder, then the saved
  // values appear — never the defaults.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (useProfileStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useProfileStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    return unsub;
  }, []);

  return hydrated;
}
