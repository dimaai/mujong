// ============================================================
// api/src/sessions/store.ts
//
// PURPOSE
//   In-memory session store for the v1 signaling backend
//   (IMPLEMENTATION_PLAN Step 13).
//
//   Pure module: no @azure/functions, no Node-only globals
//   beyond `Map`. The clock and RNG are injected so the same
//   code can be unit-tested deterministically and re-hosted
//   later if we move off Azure Functions.
//
//   What it owns:
//     1. The `Session` record shape.
//     2. A factory `createStore(deps)` that returns a small
//        API: `createSession`, `joinSession`, `getSession`,
//        `deleteSession`, `size`.
//     3. Typed errors so HTTP handlers can map them to status
//        codes without sniffing strings.
// ============================================================

/**
 * One pending or in-progress signaling session, keyed by an
 * invitation code. SDP/ICE fields are wired by Step 14; they
 * live on the record now so we don't reshape it later.
 */
export interface Session {
  code: string;
  createdAt: number;
  hostToken: string;
  joinerToken?: string;
  hostSdp?: string;
  joinerSdp?: string;
  hostIce: string[];
  joinerIce: string[];
}

/**
 * Dependencies the store needs but does not own. Injecting
 * them keeps the store deterministic in tests.
 *
 *   now          — wall-clock provider (ms since epoch)
 *   randomCode   — invitation-code generator; the store handles
 *                  collisions by re-calling this until it gets
 *                  a fresh code or `maxAttempts` is exhausted
 *   randomToken  — opaque bearer-token generator
 *   maxAttempts  — collision-retry budget for `createSession`
 *                  (default 8). Practically infinite given a
 *                  31^6 ≈ 887M code space, but bounded so a
 *                  broken RNG can't loop forever.
 */
export interface StoreDeps {
  now: () => number;
  randomCode: () => string;
  randomToken: () => string;
  maxAttempts?: number;
}

export class SessionCollisionError extends Error {
  constructor(attempts: number) {
    super(`failed to allocate unique session code after ${attempts} attempts`);
    this.name = 'SessionCollisionError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(code: string) {
    super(`session not found: ${code}`);
    this.name = 'SessionNotFoundError';
  }
}

export class SessionAlreadyJoinedError extends Error {
  constructor(code: string) {
    super(`session already joined: ${code}`);
    this.name = 'SessionAlreadyJoinedError';
  }
}

export interface SessionStore {
  /** Create a new session; returns its code and the host's bearer token. */
  createSession(): { code: string; hostToken: string };
  /** Mark a session as joined; returns the joiner's bearer token. */
  joinSession(code: string): { joinerToken: string };
  /** Read-only lookup. Undefined if the code is unknown. */
  getSession(code: string): Session | undefined;
  /**
   * Mutate a session in place via a callback. Returns `false` if
   * the code is unknown, otherwise the callback's return value.
   * Step 14 needs this for SDP/ICE writes.
   */
  updateSession<R>(code: string, fn: (s: Session) => R): R | false;
  /** Returns `true` if a session was removed. */
  deleteSession(code: string): boolean;
  /**
   * Drop every session with `createdAt < beforeMs`. Returns the
   * number removed. Step 14's TTL sweep calls this on every
   * request — cheap because the map stays small in v1.
   */
  prune(beforeMs: number): number;
  /** Number of live sessions. Useful for tests + future telemetry. */
  size(): number;
}

/**
 * Build a session store backed by a private `Map`. Each call
 * yields an isolated store, which is what tests want. The
 * production singleton lives in `defaultStore.ts`.
 */
export function createStore(deps: StoreDeps): SessionStore {
  const sessions = new Map<string, Session>();
  const maxAttempts = deps.maxAttempts ?? 8;

  function createSession(): { code: string; hostToken: string } {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const code = deps.randomCode();
      if (sessions.has(code)) {
        continue;
      }
      const hostToken = deps.randomToken();
      const session: Session = {
        code,
        createdAt: deps.now(),
        hostToken,
        hostIce: [],
        joinerIce: [],
      };
      sessions.set(code, session);
      return { code, hostToken };
    }
    throw new SessionCollisionError(maxAttempts);
  }

  function joinSession(code: string): { joinerToken: string } {
    const session = sessions.get(code);
    if (!session) {
      throw new SessionNotFoundError(code);
    }
    if (session.joinerToken) {
      throw new SessionAlreadyJoinedError(code);
    }
    const joinerToken = deps.randomToken();
    session.joinerToken = joinerToken;
    return { joinerToken };
  }

  function getSession(code: string): Session | undefined {
    return sessions.get(code);
  }

  function updateSession<R>(code: string, fn: (s: Session) => R): R | false {
    const s = sessions.get(code);
    if (!s) return false;
    return fn(s);
  }

  function deleteSession(code: string): boolean {
    return sessions.delete(code);
  }

  function prune(beforeMs: number): number {
    let removed = 0;
    for (const [code, s] of sessions) {
      if (s.createdAt < beforeMs) {
        sessions.delete(code);
        removed += 1;
      }
    }
    return removed;
  }

  function size(): number {
    return sessions.size;
  }

  return { createSession, joinSession, getSession, updateSession, deleteSession, prune, size };
}
