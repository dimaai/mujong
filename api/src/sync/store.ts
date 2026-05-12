// ============================================================
// api/src/sync/store.ts
//
// PURPOSE
//   Pure abstraction for the server-side of cloud sync (Phase J,
//   IMPLEMENTATION_PLAN Step 26). Mirrors the shape of
//   `sessions/store.ts`: a narrow interface that every handler
//   talks to, plus an in-memory implementation used by tests and
//   offline `func start` runs. The Azure Table-backed
//   implementation lives next door in `tableStore.ts` and
//   satisfies the same interface — handlers never know which one
//   they are talking to.
//
//   Wire contract (must stay in lock-step with the client kernel
//   in `src/sync/reconcile.ts` and the HTTP wrapper in
//   `src/sync/httpClient.ts`):
//     - read(userId, kind)               → `Persisted<T> | null`
//     - write(userId, kind, envelope)    → `{ ok: true }`
//                                       or `{ ok: false; current }`
//
//   The server-side LWW rule is the same one the client kernel
//   uses, so a `PUT` always converges to the same envelope as
//   the local reconcile would have picked:
//
//     1. schema-version mismatch  → higher `v` wins
//     2. otherwise newer `updatedAt` wins
//     3. tie on `updatedAt`        → smaller `deviceId` wins
//     4. tie on `updatedAt` + `deviceId` → no-op (already stored)
//
//   Validation of `userId` / `kind` / `Persisted<T>` shape lives
//   in the HTTP layer — this module trusts its inputs because
//   that boundary already filtered them.
// ============================================================

/**
 * Envelope stored on the server. Structurally identical to the
 * client's `Persisted<T>` in `src/persistence/storage.ts` —
 * duplicated here so the API package stays free of any web-tier
 * imports.
 */
export interface PersistedEnvelope {
  /** Schema version of the payload. Higher wins on mismatch. */
  v: number;
  /** Opaque payload; never inspected by this module. */
  data: unknown;
  /** Epoch milliseconds when the writer produced this envelope. */
  updatedAt: number;
  /** Stable id of the device that produced the write. */
  deviceId: string;
}

/** Which slice of state a sync call addresses. */
export type SyncKind = 'profile' | 'settings';

export const SYNC_KINDS: readonly SyncKind[] = ['profile', 'settings'] as const;

/** Result of `write`. Mirrors the client's 200 / 409 split. */
export type WriteResult =
  | { ok: true; stored: PersistedEnvelope }
  | { ok: false; current: PersistedEnvelope };

export interface SyncStore {
  /** Returns the stored envelope, or `null` if nothing is stored yet. */
  read(userId: string, kind: SyncKind): Promise<PersistedEnvelope | null>;

  /**
   * Apply LWW against the currently-stored envelope. If the new
   * envelope wins (or no envelope is stored), it becomes the new
   * value and `{ ok: true }` is returned. If the stored envelope
   * is strictly newer, no write happens and the stored envelope
   * is returned to the caller as `{ ok: false; current }` so the
   * HTTP handler can surface it in a 409 body.
   */
  write(
    userId: string,
    kind: SyncKind,
    envelope: PersistedEnvelope,
  ): Promise<WriteResult>;
}

/**
 * Decide whether `incoming` should replace `current` under the
 * same LWW rules the client kernel applies. Exported because the
 * Azure Table store needs to reuse the exact decision inside its
 * ETag retry loop, and to keep the rule in one place.
 */
export function incomingWins(
  current: PersistedEnvelope | null,
  incoming: PersistedEnvelope,
): boolean {
  if (current === null) return true;
  if (current.v !== incoming.v) return incoming.v > current.v;
  if (current.updatedAt !== incoming.updatedAt) {
    return incoming.updatedAt > current.updatedAt;
  }
  // Same updatedAt — smaller deviceId wins.
  if (current.deviceId !== incoming.deviceId) {
    return incoming.deviceId < current.deviceId;
  }
  // Identical envelope already stored — no need to rewrite.
  return false;
}

/**
 * Build an in-memory `SyncStore`. Used by unit tests and by the
 * offline `func start` path when no storage backend is wired up.
 */
export function createSyncStore(): SyncStore {
  // PartitionKey == userId, RowKey == kind. We index by a
  // composite string so two users never collide.
  const rows = new Map<string, PersistedEnvelope>();

  const keyOf = (userId: string, kind: SyncKind): string =>
    `${userId}\u0000${kind}`;

  // Deep clone via structuredClone so the in-memory store mirrors
  // the table-backed store, which is implicitly deep (JSON round-trip
  // through the `dataJson` column). Without this a caller could mutate
  // `data` after writing and our state would silently change with it.
  const clone = <T>(x: T): T => structuredClone(x);

  return {
    async read(userId, kind) {
      const row = rows.get(keyOf(userId, kind));
      return row ? clone(row) : null;
    },

    async write(userId, kind, envelope) {
      const k = keyOf(userId, kind);
      const current = rows.get(k) ?? null;
      if (incomingWins(current, envelope)) {
        const stored = clone(envelope);
        rows.set(k, stored);
        return { ok: true, stored: clone(stored) };
      }
      return { ok: false, current: clone(current as PersistedEnvelope) };
    },
  };
}
