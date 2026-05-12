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
  /**
   * Active network-session re-attach record (Step 19). Holds the
   * minimum needed to re-run the signaling handshake after a tab
   * reload: code + role + own auth token. Cleared on session end.
   */
  netSession: "mojong.netSession.v1",
  /**
   * "1" once the user has dismissed the iOS "Add to Home Screen"
   * hint (Step 31). Stored as a plain string (not an envelope)
   * because it's a single boolean flag with no sync need.
   */
  installHintDismissed: "mojong.installHintDismissed.v1",
} as const;

/** Union of valid key strings — handy for typing helpers. */
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
