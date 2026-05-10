// ============================================================
// src/store/netStore.ts
//
// PURPOSE
//   Zustand store driving the `/network` lobby (Step 15).
//
//   Owns the high-level lifecycle of a networked session:
//     1. host()        — create a session, advertise its 6-char
//                        code, and wait for a joiner.
//     2. join(code)    — claim an existing session and connect.
//     3. leave()       — tear everything down (peer + client).
//
//   The actual `Peer` and `SignalingClient` instances are kept
//   in module-level refs (NOT in the store's reactive state)
//   because:
//     - they aren't serialisable,
//     - they shouldn't trigger re-renders when their internal
//       state changes,
//     - exactly one of each can exist per browser tab in v1.
//
//   Game wiring is intentionally out of scope. On a successful
//   handshake the store reaches `'connected'` with both
//   profiles in hand; the next slice (Phase G-3) will read
//   that state and call `useGameStore.startGame`.
// ============================================================

import { create } from 'zustand';

import { getDeviceId } from '../persistence/ids';
import { createNetLogger, type LogEntry } from '../net/log';
import { fetchIceServers } from '../net/iceServers';
import {
  connectViaSignaling,
  createPeer,
  sendPing,
  type Peer,
} from '../net/peer';
import {
  PROTOCOL_VERSION,
  type GameOptions,
  type NetMessage,
  type Profile,
} from '../net/protocol';
import {
  createSignalingClient,
  SignalingError,
  type Role,
  type SignalingClient,
} from '../net/signaling';
import { useGameStore, setActionBroadcaster, type ActionLogEntry } from './gameStore';

// ── Public state shape ────────────────────────────────────────

/**
 * Discrete states the lobby walks through.
 *
 *   idle       — nothing has been started yet (initial / after leave).
 *   hosting    — host: code allocated, waiting for a joiner.
 *   joining    — joiner: claiming the session on the server.
 *   connecting — both sides: SDP/ICE handshake in flight.
 *   connected  — DataChannel open AND both HELLOs exchanged.
 *   error      — a fatal error happened; `error` holds the message.
 */
export type NetStatus =
  | 'idle'
  | 'hosting'
  | 'joining'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Connection-quality tier surfaced to the UI. Driven by the
 * sliding mean of the last `RTT_WINDOW_SIZE` PONG round-trips,
 * with overrides when no PONG has arrived for a while.
 *   good     — mean RTT < 150 ms; healthy.
 *   slow     — mean RTT < 400 ms; playable but noticeable lag.
 *   unstable — mean RTT ≥ 400 ms, or 15 s without a PONG.
 */
export type NetQuality = 'good' | 'slow' | 'unstable';

/** Number of recent RTT samples mixed into the quality mean. */
export const RTT_WINDOW_SIZE = 5;

/**
 * Pure helper used by the heartbeat loop AND by tests. Kept
 * outside the store so it has no React/Zustand coupling.
 *
 * Inputs : `rtts` — recent PONG round-trip samples in ms,
 *                   most-recent-last. May be empty.
 *          `now`, `lastSeenAt` — wall-clock and last successful
 *                   inbound timestamps. When the gap exceeds
 *                   15 s the result is forced to `'unstable'`
 *                   regardless of any cached RTTs.
 * Output : a `NetQuality` tier, or `null` if there is nothing to
 *          report yet (no samples AND no observed traffic).
 * Side fx: none.
 */
export function computeQuality(
  rtts: readonly number[],
  now: number,
  lastSeenAt: number | null,
): NetQuality | null {
  if (lastSeenAt != null && now - lastSeenAt >= 15_000) return 'unstable';
  if (rtts.length === 0) return lastSeenAt == null ? null : 'good';
  const mean = rtts.reduce((a, b) => a + b, 0) / rtts.length;
  if (mean < 150) return 'good';
  if (mean < 400) return 'slow';
  return 'unstable';
}

/** Strings the UI shows under the spinner. */
export interface NetState {
  status: NetStatus;
  /** 6-char invitation code once allocated/joined. */
  code: string | null;
  /** Which role this client plays in the session (transport-level). */
  role: Role | null;
  /**
   * Lobby-level mode mirror of `role`. Plan-spec field name; kept
   * alongside `role` so callers (UI / game wiring) can read either.
   *   'host' → this device created the session.
   *   'join' → this device joined an existing one.
   */
  mode: 'host' | 'join' | null;
  /**
   * Which `players[]` slot this device controls once a networked
   * game starts. Populated by `startNetworkGame()` on the host and
   * by the inbound `START` handler on the joiner. Null until then.
   */
  localPlayerIndex: 0 | 1 | null;
  /**
   * Flips to `true` the moment a `START` has been applied locally.
   * The lobby observes this and navigates to `/play`. The peer is
   * deliberately NOT torn down by `leave()` while this is true so
   * the DataChannel survives the route change for Step 17's moves.
   */
  gameStarted: boolean;
  /** Peer's profile, populated after their HELLO arrives. */
  peerProfile: Profile | null;
  /**
   * Peer's stable device id, captured from the HELLO envelope.
   * Used by Step 17 to validate that ACTION messages actually
   * come from the opponent we shook hands with.
   */
  peerDeviceId: string | null;
  /** Human-readable error text, valid only when status === 'error'. */
  error: string | null;

  /**
   * Connection-quality tier driven by the heartbeat loop. `null`
   * until the first PONG (or the first time we fall into the
   * 15 s-without-traffic branch). Cleared by `leave()`/teardown.
   */
  quality: NetQuality | null;
  /**
   * Mean of the last `RTT_WINDOW_SIZE` PONG round-trips, in ms.
   * `null` until the first PONG arrives. Used for the pill tooltip
   * and for future analytics.
   */
  lastRttMs: number | null;
  /**
   * Wall-clock (ms since epoch) of the most recent successfully
   * decoded inbound message. Drives the "X seconds since last
   * heartbeat" check that flips `quality` to `'unstable'`.
   */
  lastSeenAt: number | null;

  /**
   * Recent diagnostic log entries from the net layer (peer +
   * signaling). Bounded by the ring buffer's capacity. Updated
   * via `set` so React components can subscribe and render a
   * debug overlay on devices without easy DevTools access.
   */
  logs: LogEntry[];

  /**
   * Start hosting. Allocates a session, advertises the code,
   * and waits for a joiner. Resolves when `'connected'` is
   * reached or rejects internally (sets `'error'`) on failure.
   * `selfProfile` is sent in our HELLO.
   */
  host: (selfProfile: Profile) => Promise<void>;

  /**
   * Join an existing session by code. Same lifecycle as `host`
   * from the caller's perspective.
   */
  join: (code: string, selfProfile: Profile) => Promise<void>;

  /**
   * Tear down peer + signaling client, reset the store back to
   * `'idle'`. Idempotent — safe to call from `useEffect` cleanup
   * even if nothing was ever started.
   *
   * No-op once `gameStarted === true`: the peer must survive the
   * navigation from `/network` to `/play` so Step 17's gameplay
   * messages can flow over the same DataChannel. Use
   * `endNetworkSession()` to force teardown after the game ends.
   */
  leave: () => void;

  /**
   * Host-only: build the initial game from the local settings +
   * exchanged profiles, broadcast `START`, then start the game
   * locally. Caller is responsible for the route push (`/play`).
   *
   * Inputs : `options` from `useSettingsStore`, `selfProfile` from
   *          `useProfileStore.player1`. The peer's profile is read
   *          from store state (`peerProfile`, set by HELLO).
   * Outputs: `true` on success, `false` if preconditions are missing
   *          (no peer, no peerProfile, wrong status).
   * Side fx: sends `START` over the DataChannel; mutates `useGameStore`;
   *          flips `gameStarted` so the lobby UI navigates.
   */
  startNetworkGame: (
    options: GameOptions,
    selfProfile: Profile,
  ) => boolean;

  /**
   * Force teardown of the peer + signaling client, regardless of
   * `gameStarted`. Call this when the game ends (Step 19/20 wire
   * this in; Step 16 just exposes the seam).
   */
  endNetworkSession: () => void;
}

/** Invitation code shape (matches the server's regex). */
export const NET_CODE_REGEX = /^[2-9A-HJ-KMNP-Z]{6}$/;

/** Convenience: validate + normalise a user-typed code. */
export function normaliseNetCode(input: string): string | null {
  const upper = input.trim().toUpperCase();
  return NET_CODE_REGEX.test(upper) ? upper : null;
}

// ── Module-level non-reactive refs ────────────────────────────
//
// These intentionally live outside the store. Putting an
// `RTCPeerConnection` (even wrapped) inside reactive state would
// create infinite re-render loops the first time React inspects
// it deeply, and would also break `JSON.stringify` for any future
// devtools middleware. One ref pair per tab is fine in v1.

let currentPeer: Peer | null = null;
let currentClient: SignalingClient | null = null;
/**
 * Per-tab outgoing sequence cursor for messages this device sends
 * over the DataChannel. HELLO claims `seq: 0`; everything after
 * (START, future ACTION/PING) draws from this counter so receivers
 * can detect gaps. Reset alongside the peer in `teardown()`.
 */
let outgoingSeq = 1;
/**
 * Step 17: next inbound seq we expect from the peer. Initialised
 * to 1 right after their HELLO (seq=0) lands. Bumped on each
 * successfully validated message. A mismatch leaves a gap that
 * Step 20 will close via RESYNC_REQ; for now we just log + drop.
 */
let expectedRemoteSeq = 1;
/** Guards re-entrant `host()` / `join()` calls. */
let inFlight = false;

// ── Heartbeat refs (Step 18) ──────────────────────────────────
//
// All three live at module scope so `teardown()` can null them
// out without help from a React effect. The interval is started
// once we reach `'connected'` and cleared on any teardown path
// (leave, BYE handler, peer-state failure, beforeunload).

/** Live `setInterval` handle for the PING loop; null when idle. */
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
/** Sliding window of recent PONG RTTs (ms), oldest-first. */
const rttWindow: number[] = [];
/**
 * Flag set on first reach of `>= 30 s` without a PONG so we don't
 * spam the reconnect signal every tick. Step 19 will read this
 * via a subscription; Step 18 just logs.
 */
let reconnectSignalled = false;
/** Optional `beforeunload` cleanup. Null when no peer is alive. */
let beforeUnloadHandler: (() => void) | null = null;

// ── Store ─────────────────────────────────────────────────────

export const useNetStore = create<NetState>((set, get) => {
  /**
   * Build a HELLO envelope. `seq` is fixed at 0 because HELLO
   * is the first (and currently only) message this store sends.
   * Subsequent verbs (ACTION, PING…) belong to the gameplay
   * slice and will own their own `nextSeq` cursor.
   */
  function buildHello(profile: Profile, gameId: string): NetMessage {
    return {
      v: PROTOCOL_VERSION,
      gameId,
      senderId: getDeviceId(),
      seq: 0,
      t: Date.now(),
      type: 'HELLO',
      profile,
    };
  }

  /**
   * Common path used by both `host` and `join`. Wires up message
   * + state listeners on the peer, sends our HELLO once the
   * channel opens, and resolves once the peer's HELLO arrives.
   */
  async function runHandshake(
    role: Role,
    selfProfile: Profile,
    code: string,
    client: SignalingClient,
  ): Promise<void> {
    // Mirror net-layer logs to the browser console so a developer
    // (or a tester opening F12) can see exactly where a handshake
    // got stuck — gathering ICE, no candidates, signaling 4xx, etc.
    // The ring-buffer logger keeps the last 200 entries in memory
    // for a future debug overlay; the console mirror is just for
    // immediate visibility.
    const ringLogger = createNetLogger();
    const logger = {
      log(level: 'debug' | 'info' | 'warn' | 'error', tag: string, data?: unknown) {
        ringLogger.log(level, tag, data);
        // Mirror to the browser console for devtools users.
        const fn =
          level === 'error'
            ? console.error
            : level === 'warn'
              ? console.warn
              : level === 'info'
                ? console.info
                : console.debug;
        fn(`[mojong:${tag}]`, data ?? '');
        // Mirror to the store so a UI overlay can render it on
        // mobile devices that can't open devtools easily.
        set({ logs: ringLogger.snapshot() });
      },
      snapshot: ringLogger.snapshot,
      clear: ringLogger.clear,
      size: ringLogger.size,
    };

    // Fetch a fresh iceServers list from the API. The provider's
    // long-lived API key lives only in the Function App env, so
    // the client never sees it. We tolerate failures by falling
    // back to STUN-only — symmetric-NAT users will fail later,
    // but home users on direct IPs still get a working session.
    const { iceServers, fellBack } = await fetchIceServers();
    logger.log('info', 'iceServers', {
      count: iceServers.length,
      fellBack,
    });

    const peer = createPeer({ role, logger, rtcConfig: { iceServers } });
    currentPeer = peer;

    // Resolve once the peer's HELLO is decoded; reject on terminal
    // states. The orchestrator below will reject too on failure,
    // but listening here as well lets us also catch a remote BYE
    // or a malformed message that the orchestrator wouldn't see.
    const helloPromise = new Promise<{ profile: Profile; senderId: string; seq: number }>((resolve, reject) => {
      const offMsg = peer.on('message', (msg) => {
        if (msg.type === 'HELLO') {
          offMsg();
          offState();
          resolve({ profile: msg.profile, senderId: msg.senderId, seq: msg.seq });
        }
      });
      const offState = peer.on('state', (s) => {
        if (s === 'failed' || s === 'closed') {
          offMsg();
          offState();
          reject(new Error(`peer ${s} before HELLO`));
        }
      });
    });
    // Ensure the rejection path is always observed. If the awaiter
    // below never reaches `await helloPromise` (because
    // `connectViaSignaling` failed first, or the user clicked
    // Cancel which triggered teardown), the rejection would surface
    // as an "unhandled promise rejection" in Next.js's dev overlay.
    // The real awaiter still gets the resolved value or the error.
    helloPromise.catch(() => {});

    // When the channel opens, send our HELLO. We do it via the
    // 'state' subscription rather than awaiting `connectViaSignaling`
    // first, because the orchestrator only resolves after `'open'`
    // and we want the HELLO to race out the moment we can `send`.
    const offSendOnOpen = peer.on('state', (s) => {
      if (s === 'open') {
        offSendOnOpen();
        try {
          peer.send(buildHello(selfProfile, code));
        } catch (err) {
          // If `send` throws here something is very wrong (state
          // says open but channel disagreed). Surface as error.
          set({ status: 'error', error: String(err) });
        }
      }
    });

    set({ status: 'connecting' });
    await connectViaSignaling(peer, client, role, logger);
    const hello = await helloPromise;
    // Next message we expect from the peer comes right after their
    // HELLO. Anything we receive with a seq < this is a duplicate;
    // anything with a higher seq leaves a gap (Step 20).
    expectedRemoteSeq = hello.seq + 1;
    set({
      status: 'connected',
      peerProfile: hello.profile,
      peerDeviceId: hello.senderId,
    });
    // Start the heartbeat as soon as we're confirmed connected.
    // It will tick every 5 s and update `quality` / `lastRttMs`.
    startHeartbeat(logger);

    // Long-lived listener for post-HELLO traffic. In Step 16 the
    // verbs we handle are `START` (game-start sync) and `BYE`
    // (opponent left the lobby); Step 17 adds `ACTION`; Step 18
    // adds `PING`/`PONG`. We deliberately keep this subscription
    // alive for the lifetime of the peer so it survives the
    // `/network` → `/play` navigation.
    peer.on('message', (msg) => {
      // Reject messages that don't come from the peer we shook
      // hands with. A spoofed senderId on the wire shouldn't be
      // possible (the channel is end-to-end), but enforcing it
      // here keeps the contract honest.
      const expectedSender = get().peerDeviceId;
      if (expectedSender && msg.senderId !== expectedSender) {
        logger.log('warn', 'msg.sender', {
          got: msg.senderId,
          want: expectedSender,
          type: msg.type,
        });
        return;
      }

      // Any well-formed inbound message from the peer counts as
      // "we heard from them" — it keeps the 15 s staleness timer
      // happy even when ACTIONs are flowing without PINGs.
      set({ lastSeenAt: Date.now() });

      if (msg.type === 'PING') {
        // Auto-reply. We don't track outgoing PONG seq separately
        // — it uses the same `outgoingSeq` cursor as everything
        // else so the peer can detect gaps uniformly.
        try {
          currentPeer?.send({
            v: PROTOCOL_VERSION,
            gameId: get().code ?? '',
            senderId: getDeviceId(),
            seq: outgoingSeq++,
            t: Date.now(),
            type: 'PONG',
            replyTo: msg.seq,
          });
        } catch (err) {
          logger.log('debug', 'pong.send', String(err));
        }
        if (msg.seq === expectedRemoteSeq) expectedRemoteSeq = msg.seq + 1;
        return;
      }

      if (msg.type === 'PONG') {
        // `sendPing`'s own promise listener computes the RTT and
        // updates the store; here we just keep the seq cursor in
        // step so the next ACTION doesn't look like a gap.
        if (msg.seq === expectedRemoteSeq) expectedRemoteSeq = msg.seq + 1;
        return;
      }

      if (msg.type === 'START') {
        // The clicker (sender) becomes player 1 (index 0). The
        // receiver picks the opposite slot. This lets either side
        // initiate the game from the lobby — not just the host.
        if (get().gameStarted) return; // race: we already started
        const localPlayerIndex: 0 | 1 =
          msg.hostPlayerIndex === 0 ? 1 : 0;
        try {
          useGameStore.getState().startGame({
            options: msg.options,
            profiles: msg.profiles,
            seed: msg.seed,
            mode: 'network',
            localPlayerIndex,
          });
        } catch (err) {
          logger.log('error', 'start.apply', String(err));
          set({ status: 'error', error: 'Failed to start game.' });
          return;
        }
        // Wire the gameStore → peer broadcaster now that the game
        // exists. Done on both sides; teardown() clears it.
        installActionBroadcaster();
        // START is the next expected message after HELLO; bump
        // the cursor so the first ACTION (seq+1) lines up.
        if (msg.seq === expectedRemoteSeq) expectedRemoteSeq = msg.seq + 1;
        set({ localPlayerIndex, gameStarted: true });
        return;
      }

      if (msg.type === 'ACTION') {
        // Strict gap detection. A duplicate (seq < expected) is
        // silently dropped; a forward gap is logged and dropped
        // (Step 20 will request a resync). Both branches MUST NOT
        // apply, otherwise the boards drift.
        if (msg.seq < expectedRemoteSeq) {
          logger.log('debug', 'action.dup', { seq: msg.seq });
          return;
        }
        if (msg.seq > expectedRemoteSeq) {
          logger.log('warn', 'action.gap', {
            got: msg.seq,
            want: expectedRemoteSeq,
          });
          return;
        }
        const applied = useGameStore.getState().applyRemoteAction({
          action: msg.action,
          turnNumber: msg.turnNumber,
        });
        if (applied) {
          expectedRemoteSeq = msg.seq + 1;
        } else {
          // The action was well-formed on the wire but the local
          // game state rejected it (wrong turnNumber, finished, …).
          // Don't bump the cursor — a future RESYNC_RES will be
          // able to retry from this seq.
          logger.log('warn', 'action.reject', {
            seq: msg.seq,
            turnNumber: msg.turnNumber,
          });
        }
        return;
      }

      if (msg.type === 'BYE') {
        // Keep the cursor moving so any in-flight gap detection
        // logic stays in sync if more messages arrive.
        if (msg.seq === expectedRemoteSeq) expectedRemoteSeq = msg.seq + 1;
        // Peer signalled a clean disconnect. If we haven't started
        // a game yet, fall back to the lobby's error state so the
        // user can retry. (Step 19 will handle in-game BYE.)
        if (!get().gameStarted) {
          teardown();
          set({
            status: 'error',
            code: null,
            role: null,
            mode: null,
            localPlayerIndex: null,
            gameStarted: false,
            peerProfile: null,
            peerDeviceId: null,
            quality: null,
            lastRttMs: null,
            lastSeenAt: null,
            error: 'Opponent left the lobby.',
          });
        }
        return;
      }
    });

    // Long-lived state listener: if the channel drops *after* the
    // handshake (peer closed their tab / network died) and we are
    // still in the lobby, surface a friendly error so the other
    // user isn't stranded on a "Connected" screen forever.
    peer.on('state', (s) => {
      if (s !== 'closed' && s !== 'failed') return;
      if (get().gameStarted) return; // game-time disconnect: Step 19
      // Don't clobber an existing error (e.g. from BYE handler).
      if (get().status === 'error') return;
      teardown();
      set({
        status: 'error',
        code: null,
        role: null,
        mode: null,
        localPlayerIndex: null,
        gameStarted: false,
        peerProfile: null,
        peerDeviceId: null,
        quality: null,
        lastRttMs: null,
        lastSeenAt: null,
        error: 'Opponent disconnected.',
      });
    });
  }

  /**
   * Map a thrown error to a user-facing message. We special-case
   * the well-known signaling errors so the UI can show "code not
   * found" rather than "http_404 (404)".
   */
  function describeError(err: unknown): string {
    if (err instanceof SignalingError) {
      switch (err.code) {
        case 'not_found':
          return 'Session code not found.';
        case 'already_joined':
          return 'That session is already full.';
        case 'bad_code':
          return 'Invalid session code.';
        case 'bad_token':
          return 'Authorisation failed.';
        default:
          // Server-supplied detail (e.g. a misconfigured table store)
          // is the most useful thing to show during setup; fall back
          // to just the code if no detail is present.
          return err.message
            ? `Signaling error: ${err.code} — ${err.message}`
            : `Signaling error: ${err.code}`;
      }
    }
    if (err instanceof Error) return err.message;
    return String(err);
  }

  /** Common cleanup; safe to call multiple times. */
  function teardown(): void {
    // Stop heartbeat FIRST so its timer can't push to a closing
    // channel and surface as a noisy `peer.send` exception.
    stopHeartbeat();
    // Clear the gameStore broadcaster first so any in-flight
    // `executeAction` doesn't try to push to a closed channel.
    setActionBroadcaster(null);
    try {
      currentPeer?.close();
    } catch {
      // best-effort
    }
    try {
      currentClient?.close();
    } catch {
      // best-effort
    }
    currentPeer = null;
    currentClient = null;
    outgoingSeq = 1;
    expectedRemoteSeq = 1;
    inFlight = false;
  }

  /**
   * Wire `gameStore` so every locally-applied action ships over
   * the DataChannel. Called from both sides once a START has been
   * applied (host: in `startNetworkGame`; joiner: in the START
   * message handler). Cleared by `teardown()`.
   *
   * Side effects: registers a module-level callback on the game
   * store; sends `ACTION` messages on the current peer.
   */
  function installActionBroadcaster(): void {
    setActionBroadcaster((entry: ActionLogEntry) => {
      if (!currentPeer) return;
      const code = get().code ?? '';
      currentPeer.send({
        v: PROTOCOL_VERSION,
        gameId: code,
        senderId: getDeviceId(),
        seq: outgoingSeq++,
        t: Date.now(),
        type: 'ACTION',
        action: entry.action,
        turnNumber: entry.turnNumber,
      });
    });
  }

  /**
   * Step 18: start the 5 s PING loop. Idempotent — calling twice
   * does NOT double the timer. Stops automatically on any
   * teardown via `stopHeartbeat()`.
   *
   * Inputs : `logger` — net logger used to record stale-peer
   *                     transitions (the UI also reads `quality`).
   * Outputs: none.
   * Side fx: schedules an interval that `peer.send`s `PING`s and
   *          updates `quality` / `lastRttMs` / `lastSeenAt`.
   */
  function startHeartbeat(logger: {
    log: (level: 'debug' | 'info' | 'warn' | 'error', tag: string, data?: unknown) => void;
  }): void {
    if (heartbeatTimer) return;
    // Seed `lastSeenAt` to "now" so the 15 s timer doesn't trip
    // before the very first PONG can possibly arrive.
    set({ lastSeenAt: Date.now(), quality: 'good', lastRttMs: null });
    rttWindow.length = 0;
    reconnectSignalled = false;

    const tick = (): void => {
      const peer = currentPeer;
      if (!peer || peer.state !== 'open') return;
      const seq = outgoingSeq++;
      const sentAt = Date.now();
      sendPing(peer, {
        v: PROTOCOL_VERSION,
        gameId: get().code ?? '',
        senderId: getDeviceId(),
        seq,
        t: sentAt,
        type: 'PING',
      })
        .then((rtt) => {
          rttWindow.push(rtt);
          if (rttWindow.length > RTT_WINDOW_SIZE) rttWindow.shift();
          const mean = Math.round(
            rttWindow.reduce((a, b) => a + b, 0) / rttWindow.length,
          );
          const now = Date.now();
          set({
            lastRttMs: mean,
            lastSeenAt: now,
            quality: computeQuality(rttWindow, now, now),
          });
          reconnectSignalled = false;
        })
        .catch((err: unknown) => {
          // Timeout / peer down. Don't crash the loop — let the
          // staleness check below promote `quality` to `'unstable'`.
          logger.log('debug', 'ping.fail', String(err));
        })
        .finally(() => {
          // Independent of PONG: if we haven't heard ANYTHING in
          // a while, demote quality and (after 30 s) signal that
          // Step 19's reconnect should kick in.
          const now = Date.now();
          const lastSeenAt = get().lastSeenAt;
          const q = computeQuality(rttWindow, now, lastSeenAt);
          if (q !== null) set({ quality: q });
          if (
            lastSeenAt != null &&
            now - lastSeenAt >= 30_000 &&
            !reconnectSignalled
          ) {
            reconnectSignalled = true;
            // Step 19 will hook this; for now just log so QA can
            // see the threshold fired in the debug overlay.
            logger.log('warn', 'heartbeat.stale', {
              sinceSeenMs: now - lastSeenAt,
            });
          }
        });
    };

    heartbeatTimer = setInterval(tick, 5_000);

    // Belt-and-braces cleanup if the user navigates away or
    // closes the tab while the peer is alive.
    if (typeof window !== 'undefined' && !beforeUnloadHandler) {
      beforeUnloadHandler = () => {
        stopHeartbeat();
      };
      window.addEventListener('beforeunload', beforeUnloadHandler);
    }
  }

  /** Stop the PING loop and remove the `beforeunload` listener. */
  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (typeof window !== 'undefined' && beforeUnloadHandler) {
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      beforeUnloadHandler = null;
    }
    rttWindow.length = 0;
    reconnectSignalled = false;
  }

  return {
    status: 'idle',
    code: null,
    role: null,
    mode: null,
    localPlayerIndex: null,
    gameStarted: false,
    peerProfile: null,
    peerDeviceId: null,
    error: null,
    quality: null,
    lastRttMs: null,
    lastSeenAt: null,
    logs: [],

    async host(selfProfile) {
      if (inFlight) return;
      inFlight = true;
      // Reset state but stay on `'idle'` until we have a code, so
      // the UI can show a generic "starting…" without flashing
      // stale fields from a previous session.
      set({
        status: 'idle',
        code: null,
        role: 'host',
        mode: 'host',
        localPlayerIndex: null,
        gameStarted: false,
        peerProfile: null,
        peerDeviceId: null,
        quality: null,
        lastRttMs: null,
        lastSeenAt: null,
        error: null,
        logs: [],
      });
      const client = createSignalingClient();
      currentClient = client;
      try {
        const { code } = await client.host();
        // We have a code: render it big in the lobby.
        set({ status: 'hosting', code });
        await runHandshake('host', selfProfile, code, client);
      } catch (err) {
        const message = describeError(err);
        teardown();
        set({ status: 'error', error: message });
      } finally {
        inFlight = false;
      }
    },

    async join(rawCode, selfProfile) {
      if (inFlight) return;
      const code = normaliseNetCode(rawCode);
      if (!code) {
        set({ status: 'error', error: 'Invalid session code.' });
        return;
      }
      inFlight = true;
      set({
        status: 'joining',
        code,
        role: 'joiner',
        mode: 'join',
        localPlayerIndex: null,
        gameStarted: false,
        peerProfile: null,
        peerDeviceId: null,
        quality: null,
        lastRttMs: null,
        lastSeenAt: null,
        error: null,
        logs: [],
      });
      const client = createSignalingClient();
      currentClient = client;
      try {
        await client.join(code);
        await runHandshake('joiner', selfProfile, code, client);
      } catch (err) {
        const message = describeError(err);
        teardown();
        set({ status: 'error', error: message });
      } finally {
        inFlight = false;
      }
    },

    leave() {
      // Step 16: once a networked game has started, the peer must
      // outlive the lobby route. Skip teardown so `/play` keeps
      // sending and receiving on the same DataChannel.
      if (get().gameStarted) return;
      // Best-effort BYE so the other side immediately falls back to
      // the lobby instead of waiting for the channel to time out.
      // We catch and ignore: if the peer is already half-closed,
      // `send` will throw and we still want to tear down locally.
      const s0 = get();
      if (currentPeer && (s0.status === 'connected' || s0.status === 'connecting')) {
        try {
          currentPeer.send({
            v: PROTOCOL_VERSION,
            gameId: s0.code ?? '',
            senderId: getDeviceId(),
            seq: outgoingSeq++,
            t: Date.now(),
            type: 'BYE',
            reason: 'normal',
          });
        } catch {
          // ignore — best effort
        }
      }
      teardown();
      // Don't wipe `error` immediately if we're in the error state
      // and the caller is just navigating — let the UI decide.
      // For Step 15 we always reset to `idle` because `leave()` is
      // either user-driven ("Try again") or unmount cleanup.
      const wasError = get().status === 'error';
      set({
        status: 'idle',
        code: null,
        role: null,
        mode: null,
        localPlayerIndex: null,
        gameStarted: false,
        peerProfile: null,
        peerDeviceId: null,
        quality: null,
        lastRttMs: null,
        lastSeenAt: null,
        error: wasError ? get().error : null,
      });
      // After a deliberate leave we always clear the error too;
      // the `wasError` branch above is defensive in case future
      // callers want to inspect it after teardown.
      set({ error: null });
    },

    startNetworkGame(options, selfProfile) {
      const s = get();
      // Either side can start a networked game in v1: the clicker
      // becomes player 1 (index 0) and the other peer becomes
      // player 2. This keeps the lobby symmetric — no awkward
      // "waiting for host to press a button" UX.
      if (
        s.status !== 'connected' ||
        !s.peerProfile ||
        !currentPeer ||
        s.gameStarted // race-guard against a near-simultaneous remote START
      ) {
        return false;
      }
      const profiles: [Profile, Profile] = [selfProfile, s.peerProfile];
      const seed =
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random()
              .toString(36)
              .slice(2, 10)}`;

      const startMsg: NetMessage = {
        v: PROTOCOL_VERSION,
        gameId: s.code ?? '',
        senderId: getDeviceId(),
        seq: outgoingSeq++,
        t: Date.now(),
        type: 'START',
        options,
        profiles,
        hostPlayerIndex: 0,
        seed,
      };

      try {
        currentPeer.send(startMsg);
      } catch (err) {
        set({ status: 'error', error: `Failed to start: ${String(err)}` });
        return false;
      }

      try {
        useGameStore.getState().startGame({
          options,
          profiles,
          seed,
          mode: 'network',
          localPlayerIndex: 0,
        });
      } catch (err) {
        set({ status: 'error', error: `Failed to start: ${String(err)}` });
        return false;
      }

      // Wire the gameStore → peer broadcaster so subsequent local
      // moves auto-ship over the DataChannel.
      installActionBroadcaster();

      set({ localPlayerIndex: 0, gameStarted: true });
      return true;
    },

    endNetworkSession() {
      teardown();
      set({
        status: 'idle',
        code: null,
        role: null,
        mode: null,
        localPlayerIndex: null,
        gameStarted: false,
        peerProfile: null,
        peerDeviceId: null,
        quality: null,
        lastRttMs: null,
        lastSeenAt: null,
        error: null,
      });
    },
  };
});
