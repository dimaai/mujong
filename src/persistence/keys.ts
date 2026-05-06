// Central registry of every localStorage key the app uses.
//
// Why a single file?
//   - One place to audit what we persist on the user's device.
//   - Keys are versioned (e.g. ".v1") so we can change the shape of
//     stored data later without colliding with old entries — we just
//     bump to ".v2" and optionally migrate.
//   - Prevents typos: callers import the constant instead of writing
//     the string literal in many places.
//
// Note: these strings are NOT secrets. They are just identifiers that
// live in the browser's localStorage; treat them like table names.

export const STORAGE_KEYS = {
  /** Stable per-device + per-user identifiers (see ids.ts). */
  ids: "mojong.ids.v1",
  /** Player profiles (names, colors). Wired up in Step 2. */
  profile: "mojong.profile.v1",
  /** Game options (difficulty, board size, timer, walls...). Step 3. */
  settings: "mojong.settings.v1",
  /** Snapshot of the in-progress game so it survives reloads. Phase D. */
  gameSnapshot: "mojong.gameSnapshot.v1",
} as const;

/** Union of valid key strings — handy for typing helpers. */
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
