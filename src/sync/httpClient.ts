// ============================================================
// src/sync/httpClient.ts
//
// PURPOSE
//   Thin, framework-agnostic HTTP wrapper for the cloud-sync
//   endpoints introduced in IMPLEMENTATION_PLAN Step 25.
//
//   Wire contract (per the plan):
//     GET  /{userId}/{kind}  →  Persisted<T> | null
//     PUT  /{userId}/{kind}  →  200 on accept,
//                               409 { current: Persisted<T> } if stale
//
//   This module owns transport only — it does NOT decide who wins
//   on a conflict. That's the reconcile kernel (Step 24), driven by
//   `wire.ts`. Keeping the policy out of here means a future React
//   Native build can reuse the kernel and supply a different
//   transport.
//
// FEATURE FLAG
//   The caller decides whether to construct a client at all. When
//   `process.env.NEXT_PUBLIC_SYNC_BASE_URL` is undefined,
//   `SyncBootstrap` never instantiates one, so this module is dead
//   code in production until the backend (Step 26) ships.
// ============================================================

import type { Persisted, SyncKind } from "./types";

// ── Error types ──────────────────────────────────────────────
//
// Two distinct classes so callers (wire.ts + UI) can branch on
// "the server has newer data" vs. "the network is unreachable".

/**
 * Thrown by `push` when the server rejects our write because it
 * already has a newer envelope. `current` is the server's copy,
 * fed into `reconcile()` by the caller.
 */
export class SyncStaleError extends Error {
  public readonly current: Persisted<unknown> | null;
  constructor(current: Persisted<unknown> | null) {
    super("sync: stale (409)");
    this.name = "SyncStaleError";
    this.current = current;
  }
}

/**
 * Thrown by `pull` / `push` when the request could not be sent or
 * the response failed at the network layer (DNS, TCP, CORS, etc.)
 * or when `navigator.onLine === false`.
 */
export class SyncOfflineError extends Error {
  constructor(message = "sync: offline") {
    super(message);
    this.name = "SyncOfflineError";
  }
}

// ── Client shape ─────────────────────────────────────────────

/** What the wire-up layer calls. */
export interface SyncClient {
  /**
   * Read the current envelope for a kind from the server.
   * Returns `null` when the server has no record yet.
   * Throws `SyncOfflineError` on network failure.
   */
  pull(kind: SyncKind): Promise<Persisted<unknown> | null>;

  /**
   * Write an envelope for a kind.
   * Resolves on 200. Throws `SyncStaleError` on 409,
   * `SyncOfflineError` on network failure.
   */
  push(kind: SyncKind, envelope: Persisted<unknown>): Promise<void>;
}

// ── Factory ──────────────────────────────────────────────────

/** Constructor options for `createSyncClient`. */
export interface SyncClientOptions {
  /** Base URL of the sync API, e.g. `https://app.example.com/api/sync`. */
  baseUrl: string;
  /** Stable per-user id (Phase J: == deviceId; Phase K: real account). */
  userId: string;
  /** Inject for tests. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Inject for tests. Defaults to `navigator.onLine`. */
  isOnline?: () => boolean;
}

/** True if the browser currently believes it has a network. */
function defaultIsOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * Build a `SyncClient` bound to a base URL + userId.
 *
 * Inputs:  SyncClientOptions
 * Outputs: SyncClient
 * Side effects: none until `pull` / `push` is invoked.
 */
export function createSyncClient(opts: SyncClientOptions): SyncClient {
  const f = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const online = opts.isOnline ?? defaultIsOnline;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const userId = encodeURIComponent(opts.userId);

  function url(kind: SyncKind): string {
    return `${base}/${userId}/${encodeURIComponent(kind)}`;
  }

  return {
    async pull(kind) {
      if (!online()) throw new SyncOfflineError();
      let res: Response;
      try {
        res = await f(url(kind), {
          method: "GET",
          headers: { Accept: "application/json" },
        });
      } catch {
        throw new SyncOfflineError();
      }
      if (res.status === 404) return null;
      if (!res.ok) {
        // Any non-2xx other than 404 here is a server problem we
        // can't act on locally — surface as offline so wire.ts
        // backs off rather than thrashing on push.
        throw new SyncOfflineError(`sync: pull ${kind} → ${res.status}`);
      }
      const text = await res.text();
      if (text === "" || text === "null") return null;
      try {
        return JSON.parse(text) as Persisted<unknown>;
      } catch {
        // Malformed body → treat as nothing-on-server.
        return null;
      }
    },

    async push(kind, envelope) {
      if (!online()) throw new SyncOfflineError();
      let res: Response;
      try {
        res = await f(url(kind), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(envelope),
        });
      } catch {
        throw new SyncOfflineError();
      }
      if (res.status === 200 || res.status === 204) return;
      if (res.status === 409) {
        let current: Persisted<unknown> | null = null;
        try {
          const body = (await res.json()) as { current?: Persisted<unknown> };
          current = body?.current ?? null;
        } catch {
          current = null;
        }
        throw new SyncStaleError(current);
      }
      // Other errors → offline-style so wire.ts retries on next online event.
      throw new SyncOfflineError(`sync: push ${kind} → ${res.status}`);
    },
  };
}
