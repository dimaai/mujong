// ============================================================
// src/sync/wire.ts
//
// PURPOSE
//   The orchestration layer that turns a `SyncClient` (transport)
//   plus the `reconcile` kernel (Step 24) into actual cloud-sync
//   behaviour for `useProfileStore` and `useSettingsStore`.
//
//   Flow per kind:
//     - On install: pull from server, reconcile against local
//       envelope. Remote wins → write remote to local storage and
//       rehydrate the store (without echoing a push). Local wins
//       and differs → push local. Tie → no-op.
//     - On store change: schedule a 1 s debounce; on flush, read
//       the freshly-stamped envelope from storage and push.
//     - On 409: feed `current` into `reconcile`. Remote wins →
//       apply remote and stop. Local wins → re-push our envelope.
//       Bounded to 3 attempts to avoid live-lock.
//     - On `window.online`: re-pull each kind once. `offline` →
//       flip `syncStore.status` to 'offline'. `beforeunload` →
//       flush any pending debounce synchronously.
//
// DESIGN
//   The kind-specific knowledge (which store, which storage key)
//   is lifted into a `SyncBindings` map so this module is pure
//   orchestration. Production code calls `installSyncListeners(c)`
//   which uses `defaultBindings()`; tests call it with fake
//   bindings + fake clients + fake timers.
// ============================================================

import { STORAGE_KEYS } from "../persistence/keys";
import { getEnvelope, setItem } from "../persistence/storage";
import { useProfileStore } from "../store/profileStore";
import { useSettingsStore } from "../store/settingsStore";

import { reconcile } from "./reconcile";
import { SyncOfflineError, SyncStaleError, type SyncClient } from "./httpClient";
import { useSyncStore } from "./syncStore";
import type { Persisted, SyncKind } from "./types";

/** How long to wait after the last write before pushing. */
const DEBOUNCE_MS = 1_000;
/** Max push attempts before giving up on a 409 chain. */
const MAX_PUSH_ATTEMPTS = 3;

// ── Bindings ─────────────────────────────────────────────────

/**
 * Everything wire.ts needs to know about one synced kind.
 * Injectable so tests can replace real stores with fakes.
 */
export interface KindBinding {
  /** Read the current envelope from local persistence (or null). */
  readEnvelope: () => Persisted<unknown> | null;
  /**
   * Apply a server-authoritative envelope to local state WITHOUT
   * triggering a push echo. Implementations should preserve the
   * envelope's `updatedAt` / `deviceId` rather than re-stamping.
   */
  applyEnvelope: (env: Persisted<unknown>) => void;
  /** Subscribe to data changes. Returns an unsubscribe fn. */
  subscribe: (cb: () => void) => () => void;
}

export type SyncBindings = Record<SyncKind, KindBinding>;

/**
 * Default bindings for the real Zustand stores.
 *
 * Apply strategy: we write the remote envelope directly to
 * localStorage (preserving its updatedAt) and call the store's
 * `persist.rehydrate()` to reload state. Going through the store
 * actions instead would re-stamp `updatedAt = now()` via the
 * envelope adapter, breaking subsequent reconciles.
 */
function defaultBindings(): SyncBindings {
  return {
    profile: {
      readEnvelope: () => getEnvelope(STORAGE_KEYS.profile),
      applyEnvelope: (env) => {
        setItem(STORAGE_KEYS.profile, env);
        void useProfileStore.persist.rehydrate();
      },
      subscribe: (cb) =>
        useProfileStore.subscribe((s, prev) => {
          if (s.player1 !== prev.player1 || s.player2 !== prev.player2) cb();
        }),
    },
    settings: {
      readEnvelope: () => getEnvelope(STORAGE_KEYS.settings),
      applyEnvelope: (env) => {
        setItem(STORAGE_KEYS.settings, env);
        void useSettingsStore.persist.rehydrate();
      },
      subscribe: (cb) =>
        useSettingsStore.subscribe((s, prev) => {
          if (s.options !== prev.options) cb();
        }),
    },
  };
}

// ── Engine ───────────────────────────────────────────────────

/**
 * Install sync listeners. Returns a cleanup function that
 * cancels timers, removes window listeners, and unsubscribes
 * from all stores.
 *
 * Inputs:
 *   - client:   the transport (see httpClient.ts)
 *   - bindings: optional override; default targets the real
 *               profile + settings stores.
 * Outputs: () => void cleanup.
 * Side effects: network calls, localStorage writes, window
 *   listeners for online/offline/beforeunload.
 */
export function installSyncListeners(
  client: SyncClient,
  bindings: SyncBindings = defaultBindings(),
): () => void {
  const kinds = Object.keys(bindings) as SyncKind[];
  const pendingTimers: Partial<Record<SyncKind, ReturnType<typeof setTimeout>>> = {};
  // Suppresses one subscription callback per kind while we are
  // programmatically applying a remote envelope, so the rehydrate
  // doesn't echo a push back up.
  const suppress: Partial<Record<SyncKind, boolean>> = {};
  let disposed = false;

  function setStatus(s: ReturnType<typeof useSyncStore.getState>["status"]) {
    if (!disposed) useSyncStore.getState().setStatus(s);
  }

  function markSynced() {
    if (!disposed) useSyncStore.getState().markSynced();
  }

  // ── Apply a server envelope locally without pushing back ──
  function applyRemote(kind: SyncKind, env: Persisted<unknown>) {
    suppress[kind] = true;
    try {
      bindings[kind].applyEnvelope(env);
    } finally {
      // Clear on the next tick: rehydrate may schedule async work
      // that fires the subscription callback after this stack unwinds.
      queueMicrotask(() => {
        suppress[kind] = false;
      });
    }
  }

  // ── PUSH with conflict + retry ────────────────────────────
  async function pushKind(kind: SyncKind): Promise<void> {
    if (disposed) return;
    const local = bindings[kind].readEnvelope();
    if (local === null) return; // nothing to push yet
    setStatus("syncing");
    let envelopeToPush = local;
    for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
      try {
        await client.push(kind, envelopeToPush);
        markSynced();
        return;
      } catch (err) {
        if (err instanceof SyncOfflineError) {
          setStatus("offline");
          return;
        }
        if (err instanceof SyncStaleError) {
          // Reconcile against what the server now holds.
          const result = reconcile(envelopeToPush, err.current);
          if (result.winner === "remote" || result.winner === "tie") {
            if (result.merged) applyRemote(kind, result.merged);
            markSynced();
            return;
          }
          // Local still wins; retry with the same envelope. The
          // server is expected to accept it now that we've taken
          // its `current` into account; if it keeps returning 409
          // (e.g. clock skew with another device) we cap attempts.
          envelopeToPush = result.merged ?? envelopeToPush;
          continue;
        }
        // Unknown error — surface as error and stop.
        setStatus("error");
        return;
      }
    }
    setStatus("error");
  }

  // ── PULL + reconcile ──────────────────────────────────────
  async function pullKind(kind: SyncKind): Promise<void> {
    if (disposed) return;
    setStatus("syncing");
    let remote: Persisted<unknown> | null;
    try {
      remote = await client.pull(kind);
    } catch (err) {
      setStatus(err instanceof SyncOfflineError ? "offline" : "error");
      return;
    }
    const local = bindings[kind].readEnvelope();
    const result = reconcile(local, remote);
    if (result.winner === "remote" && result.merged) {
      applyRemote(kind, result.merged);
      markSynced();
      return;
    }
    if (result.winner === "local" && local !== null) {
      // Local is ahead — push it. `pushKind` updates status.
      await pushKind(kind);
      return;
    }
    markSynced();
  }

  // ── Debounced push per kind ──────────────────────────────
  function schedulePush(kind: SyncKind) {
    const existing = pendingTimers[kind];
    if (existing) clearTimeout(existing);
    pendingTimers[kind] = setTimeout(() => {
      pendingTimers[kind] = undefined;
      void pushKind(kind);
    }, DEBOUNCE_MS);
  }

  function flushAllNow() {
    for (const kind of kinds) {
      const t = pendingTimers[kind];
      if (t) {
        clearTimeout(t);
        pendingTimers[kind] = undefined;
        void pushKind(kind);
      }
    }
  }

  // ── Wire subscriptions ────────────────────────────────────
  const unsubs: Array<() => void> = [];
  for (const kind of kinds) {
    const unsub = bindings[kind].subscribe(() => {
      if (suppress[kind]) return;
      schedulePush(kind);
    });
    unsubs.push(unsub);
  }

  // ── Window listeners ──────────────────────────────────────
  const handleOnline = () => {
    for (const kind of kinds) void pullKind(kind);
  };
  const handleOffline = () => {
    setStatus("offline");
  };
  const handleBeforeUnload = () => {
    flushAllNow();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeunload", handleBeforeUnload);
  }

  // ── Initial pull for every kind ──────────────────────────
  for (const kind of kinds) void pullKind(kind);

  // ── Cleanup ───────────────────────────────────────────────
  return () => {
    disposed = true;
    for (const unsub of unsubs) unsub();
    for (const kind of kinds) {
      const t = pendingTimers[kind];
      if (t) clearTimeout(t);
      pendingTimers[kind] = undefined;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    }
  };
}
