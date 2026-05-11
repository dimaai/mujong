// Pure last-write-wins reconciliation between two `Persisted<T>`
// envelopes — one held locally, one fetched from the server.
//
// This module has zero I/O on purpose: it knows nothing about
// localStorage, fetch, Zustand, or React. Step 25 wraps it with an
// HTTP client; tests drive it directly. Keeping the kernel pure means
// a future React Native build can reuse it verbatim.
//
// Decision order (highest priority first):
//   1. If both sides are null → no data, tie, merged is null.
//   2. If exactly one side is null → the other wins.
//   3. If schema versions differ → higher `v` wins regardless of
//      `updatedAt`. Rationale: an upgraded client has authoritative
//      data even if its clock happens to be older. The opposite
//      (newer clock, older schema) would mean a downgraded client
//      overwrites the upgraded one, which is exactly what we want to
//      prevent.
//   4. Newer `updatedAt` wins.
//   5. If `updatedAt` is identical, break the tie by `deviceId`
//      lexicographically (smaller wins). Two devices that wrote at
//      the exact same millisecond will still converge deterministically.
//   6. If `updatedAt` AND `deviceId` AND `v` all match, the envelopes
//      are effectively the same write → report a tie; return `local`
//      so callers can keep their existing reference.

import type { Persisted } from "../persistence/storage";

export type ReconcileResult<T> = {
  /** Which side won. `'tie'` means the two envelopes are equivalent. */
  winner: "local" | "remote" | "tie";
  /** The envelope that should now be considered authoritative. */
  merged: Persisted<T> | null;
};

/**
 * Decide which of two envelopes is authoritative.
 * Pure: no mutation, no I/O, no clock reads.
 */
export function reconcile<T>(
  local: Persisted<T> | null,
  remote: Persisted<T> | null,
): ReconcileResult<T> {
  if (local === null && remote === null) {
    return { winner: "tie", merged: null };
  }
  if (local === null) {
    return { winner: "remote", merged: remote };
  }
  if (remote === null) {
    return { winner: "local", merged: local };
  }

  // Schema-version guard — overrides updatedAt.
  if (local.v !== remote.v) {
    return local.v > remote.v
      ? { winner: "local", merged: local }
      : { winner: "remote", merged: remote };
  }

  if (local.updatedAt !== remote.updatedAt) {
    return local.updatedAt > remote.updatedAt
      ? { winner: "local", merged: local }
      : { winner: "remote", merged: remote };
  }

  // Same updatedAt — break ties by deviceId.
  if (local.deviceId !== remote.deviceId) {
    return local.deviceId < remote.deviceId
      ? { winner: "local", merged: local }
      : { winner: "remote", merged: remote };
  }

  // Same updatedAt, deviceId, and v — treat as identical.
  return { winner: "tie", merged: local };
}
