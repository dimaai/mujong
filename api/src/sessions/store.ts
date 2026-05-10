// ============================================================
// api/src/sessions/store.ts
//
// PURPOSE
//   Pure session-store abstraction shared by every signaling
//   HTTP handler. Kept host-agnostic so the same interface is
//   satisfied by:
//     - the in-memory `createStore` factory below (tests +
//       offline `func start` development)
//     - `tableStore.ts` (Azure Table Storage, used in the
//       deployed Static Web App)
//
//   The methods are intentionally narrow: instead of exposing
//   `updateSession(code, fn)` (which assumes in-place mutation),
//   we model each write the handlers actually need:
//
//     - `setSdp`     — overwrite a single SDP slot
//     - `appendIce`  — push one candidate onto a slot's queue
//     - `drainIce`   — atomically take everything currently in
//                      a slot's queue and return it
//
//   This shape lets the table-backed store implement each
//   operation as a get → mutate → replace-with-ETag cycle while
//   the in-memory store keeps the cheap `Map` mutation it had
//   before. Callers don't care which one they're talking to.
// ============================================================

/**
 * One pending or in-progress signaling session, keyed by an
 * invitation code. SDP / ICE fields hold the per-role state
 * exchanged over the relay. ICE arrays hold raw JSON strings
 * so this module never has to parse RTC candidate shapes.
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
  /**
   * Number of times `reattach` has succeeded for this session.
   * Bounded by `MAX_RENEGOTIATIONS` so a misbehaving client
   * can't pin a session forever past its 10-min TTL.
   */
  renegotiationCount?: number;
}

/** Which slot a write/read targets. */
export type SessionRole = 'host' | 'joiner';

/** Sanity cap on a single slot's ICE queue length. */
export const MAX_ICE_QUEUE = 256;

/**
 * Maximum number of `reattach` calls a single session will
 * accept before refusing further renegotiation. Each side may
 * reattach independently after a transient drop, so the cap is
 * generous enough to absorb a few flaps from both peers.
 */
export const MAX_RENEGOTIATIONS = 6;

/**
 * Dependencies the in-memory store needs but does not own.
 * Injected so tests stay deterministic.
 */
export interface StoreDeps {
  now: () => number;
  randomCode: () => string;
  randomToken: () => string;
  /** Collision-retry budget for `createSession`. Defaults to 8. */
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

export class SessionAuthError extends Error {
  constructor(code: string) {
    super(`bad token for session: ${code}`);
    this.name = 'SessionAuthError';
  }
}

export class SessionRenegotiationLimitError extends Error {
  constructor(code: string, limit: number) {
    super(`session ${code} exceeded reattach limit ${limit}`);
    this.name = 'SessionRenegotiationLimitError';
  }
}

/** Result of `appendIce`. Strings let handlers map directly to HTTP. */
export type AppendIceResult = 'ok' | 'not_found' | 'queue_full';

/** Result of `drainIce`. */
export type DrainIceResult =
  | { found: true; candidates: unknown[] }
  | { found: false };

export interface SessionStore {
  /** Allocate a new session and return its code + host bearer token. */
  createSession(): Promise<{ code: string; hostToken: string }>;

  /** Mark a session as joined and return the joiner's bearer token. */
  joinSession(code: string): Promise<{ joinerToken: string }>;

  /** Read-only snapshot. Resolves to `undefined` when the code is unknown. */
  getSession(code: string): Promise<Session | undefined>;

  /** Overwrite the SDP slot for `role`. Resolves `false` when not found. */
  setSdp(code: string, role: SessionRole, sdp: string): Promise<boolean>;

  /**
   * Append a single ICE candidate (already JSON-serialised) to the
   * slot's queue. Returns `'queue_full'` if the queue would exceed
   * `MAX_ICE_QUEUE`, `'not_found'` for an unknown code, else `'ok'`.
   */
  appendIce(
    code: string,
    role: SessionRole,
    candidateJson: string,
  ): Promise<AppendIceResult>;

  /**
   * Drain the slot's queue: returns whatever was queued and clears
   * the slot atomically (with respect to other callers of the same
   * store). The candidates are parsed back to `unknown` for the
   * caller's convenience — handlers re-serialise them on the wire.
   */
  drainIce(code: string, role: SessionRole): Promise<DrainIceResult>;

  /**
   * Re-authorise an existing peer for a fresh handshake. Validates
   * `token` against the session's host/joiner tokens, increments
   * the renegotiation counter (rejecting past `MAX_RENEGOTIATIONS`),
   * and clears both SDP slots and ICE queues so the next round of
   * `setSdp` / `appendIce` writes start clean.
   *
   * Throws `SessionNotFoundError`, `SessionAuthError`, or
   * `SessionRenegotiationLimitError`.
   */
  reattach(
    code: string,
    token: string,
  ): Promise<{ role: SessionRole; renegotiationCount: number }>;

  /** Returns `true` if a session was removed. */
  deleteSession(code: string): Promise<boolean>;

  /** Drop every session with `createdAt < beforeMs`. Returns count removed. */
  prune(beforeMs: number): Promise<number>;
}

/**
 * Build an in-memory session store backed by a private `Map`.
 * Production wiring lives in `defaultStore.ts`; this is what
 * unit tests and offline `func start` runs use.
 */
export function createStore(deps: StoreDeps): SessionStore {
  const sessions = new Map<string, Session>();
  const maxAttempts = deps.maxAttempts ?? 8;

  // Defensive copy on read so callers can't accidentally mutate
  // the live map. Keeps semantics aligned with the table store
  // (which always returns fresh objects).
  function snapshot(s: Session): Session {
    return {
      ...s,
      hostIce: [...s.hostIce],
      joinerIce: [...s.joinerIce],
    };
  }

  async function createSession(): Promise<{ code: string; hostToken: string }> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const code = deps.randomCode();
      if (sessions.has(code)) continue;
      const hostToken = deps.randomToken();
      sessions.set(code, {
        code,
        createdAt: deps.now(),
        hostToken,
        hostIce: [],
        joinerIce: [],
      });
      return { code, hostToken };
    }
    throw new SessionCollisionError(maxAttempts);
  }

  async function joinSession(code: string): Promise<{ joinerToken: string }> {
    const session = sessions.get(code);
    if (!session) throw new SessionNotFoundError(code);
    if (session.joinerToken) throw new SessionAlreadyJoinedError(code);
    const joinerToken = deps.randomToken();
    session.joinerToken = joinerToken;
    return { joinerToken };
  }

  async function getSession(code: string): Promise<Session | undefined> {
    const s = sessions.get(code);
    return s ? snapshot(s) : undefined;
  }

  async function setSdp(
    code: string,
    role: SessionRole,
    sdp: string,
  ): Promise<boolean> {
    const s = sessions.get(code);
    if (!s) return false;
    if (role === 'host') s.hostSdp = sdp;
    else s.joinerSdp = sdp;
    return true;
  }

  async function appendIce(
    code: string,
    role: SessionRole,
    candidateJson: string,
  ): Promise<AppendIceResult> {
    const s = sessions.get(code);
    if (!s) return 'not_found';
    const queue = role === 'host' ? s.hostIce : s.joinerIce;
    if (queue.length >= MAX_ICE_QUEUE) return 'queue_full';
    queue.push(candidateJson);
    return 'ok';
  }

  async function drainIce(
    code: string,
    role: SessionRole,
  ): Promise<DrainIceResult> {
    const s = sessions.get(code);
    if (!s) return { found: false };
    const queue = role === 'host' ? s.hostIce : s.joinerIce;
    if (queue.length === 0) return { found: true, candidates: [] };
    const drained = queue.splice(0, queue.length);
    const candidates = drained.map((j) => JSON.parse(j) as unknown);
    return { found: true, candidates };
  }

  async function reattach(
    code: string,
    token: string,
  ): Promise<{ role: SessionRole; renegotiationCount: number }> {
    const s = sessions.get(code);
    if (!s) throw new SessionNotFoundError(code);
    let role: SessionRole;
    if (s.hostToken === token) role = 'host';
    else if (s.joinerToken && s.joinerToken === token) role = 'joiner';
    else throw new SessionAuthError(code);
    const next = (s.renegotiationCount ?? 0) + 1;
    if (next > MAX_RENEGOTIATIONS) {
      throw new SessionRenegotiationLimitError(code, MAX_RENEGOTIATIONS);
    }
    s.renegotiationCount = next;
    // Clear both sides so the resumed handshake can't pick up
    // stale candidates from the previous (now-dead) connection.
    s.hostSdp = undefined;
    s.joinerSdp = undefined;
    s.hostIce = [];
    s.joinerIce = [];
    return { role, renegotiationCount: next };
  }

  async function deleteSession(code: string): Promise<boolean> {
    return sessions.delete(code);
  }

  async function prune(beforeMs: number): Promise<number> {
    let removed = 0;
    for (const [code, s] of sessions) {
      if (s.createdAt < beforeMs) {
        sessions.delete(code);
        removed += 1;
      }
    }
    return removed;
  }

  return {
    createSession,
    joinSession,
    getSession,
    setSdp,
    appendIce,
    drainIce,
    reattach,
    deleteSession,
    prune,
  };
}
