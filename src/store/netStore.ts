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
import { STORAGE_KEYS } from '../persistence/keys';
import { getEnvelope, removeItem, setEnvelope } from '../persistence/storage';
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
  type ByeReason,
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
   * Step 19: when the underlying DataChannel reports `'closed'` or
   * `'failed'` MID-GAME, we no longer instantly forfeit the
   * opponent — that punishes brief WiFi blips. Instead we set
   * `connectionLost = true` (and capture `connectionLostAt`), and
   * the ReconnectOverlay takes over: a 60 s grace window, after
   * which the user can Claim Win or Resign. `null` while connected.
   */
  connectionLost: boolean;
  /** Wall-clock (ms) at which the channel was first reported down. */
  connectionLostAt: number | null;
  /**
   * Step 19.5: a background `attemptReconnect` is in flight. UI
   * surfaces this on the ReconnectOverlay ("Reconnecting…")
   * instead of the bare "Waiting for opponent" copy. Cleared on
   * success, on give-up, and on `endNetworkSession`.
   */
  reconnecting: boolean;

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

  /**
   * Broadcast a draw offer to the peer. Caller is expected to also
   * call `useGameStore.offerDraw(playerId)` locally so the offerer
   * sees their own "waiting…" panel. No-op if there's no live peer.
   *
   * Inputs : `offererId` — the local player's id (e.g. `'p1'`).
   * Outputs: none.
   * Side fx: one `DRAW_OFFER` frame on the DataChannel.
   */
  sendDrawOffer: (offererId: string) => void;

  /**
   * Broadcast the response to a peer's draw offer. Caller is
   * expected to also call `acceptDraw()` / `rejectDraw()` on the
   * gameStore so the local state matches what we just told the peer.
   *
   * Inputs : `accepted` — true to agree, false to decline.
   * Outputs: none.
   * Side fx: one `DRAW_RESPONSE` frame on the DataChannel.
   */
  sendDrawResponse: (accepted: boolean) => void;

  /**
   * Withdraw a pending draw offer. The offerer calls this when
   * they click "Cancel" before the receiver has answered. The
   * peer clears their pending offer panel.
   *
   * Side fx: one `DRAW_CANCEL` frame on the DataChannel.
   */
  sendDrawCancel: () => void;

  /**
   * Step 19: end the game in the LOCAL player's favour because
   * the peer is unreachable and the grace timer expired. Sends a
   * best-effort `BYE { reason: 'timeout' }` so a peer that comes
   * back online learns it lost.
   *
   * Side fx: ends the local `useGameStore` game; tears the
   *          session down via the existing phase-change subscriber.
   */
  claimWin: () => void;

  /**
   * Step 19: end the game in the OPPONENT'S favour because the
   * local player chose to resign during a disconnect. Sends a
   * best-effort `BYE { reason: 'forfeit' }`.
   */
  resign: () => void;

  /**
   * Step 19.5: best-effort attempt to re-establish the DataChannel
   * after a transient drop. Reads the persisted netSession record,
   * re-attaches to the existing signaling session with our stored
   * token, runs a fresh SDP/ICE handshake, and re-exchanges HELLO.
   *
   * Inputs : none (all needed state lives in the netSession envelope).
   * Output : resolves when the DataChannel is open again, or rejects
   *          internally (sets `reconnecting: false` and leaves the
   *          overlay's grace timer to expire).
   * Side fx: tears down the dead peer, allocates a new one, and
   *          updates `reconnecting` / `connectionLost` accordingly.
   *          On 401/404/410/429 from the server we drop the
   *          netSession envelope so the loop stops trying.
   */
  attemptReconnect: () => Promise<void>;
}

/** Invitation code shape (matches the server's regex). */
export const NET_CODE_REGEX = /^[2-9A-HJ-KMNP-Z]{6}$/;

/** Convenience: validate + normalise a user-typed code. */
export function normaliseNetCode(input: string): string | null {
  const upper = input.trim().toUpperCase();
  return NET_CODE_REGEX.test(upper) ? upper : null;
}

/**
 * Persisted record (Step 19.5) used by `attemptReconnect` to
 * re-attach to an existing signaling session after a transient
 * channel drop. Stored under `STORAGE_KEYS.netSession` via the
 * standard `Persisted<T>` envelope.
 */
export interface NetSessionRecord {
  code: string;
  role: Role;
  ownToken: string;
  selfProfile: Profile;
  savedAt: number;
}

/** Auto-reconnect cadence while `connectionLost === true`. */
const RECONNECT_RETRY_MS = 8_000;

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
/**
 * Step 19: when `claimWin` / `resign` are about to set the
 * gameStore phase to 'finished', they stash the reason here so
 * the phase-change subscriber sends the correct BYE verb instead
 * of the default `'forfeit'`. Reset to `null` after each game-end.
 */
let pendingByeReason: ByeReason | null = null;

/**
 * Step 19.5: handle of the auto-reconnect interval that ticks
 * while `connectionLost === true`. Started by the peer-state
 * branch that flips `connectionLost` to `true`; cleared on
 * success or on any teardown path.
 */
let reconnectTimer: ReturnType<typeof setInterval> | null = null;

// ── netSession persistence helpers (Step 19.5) ───────────────

/** Write the re-attach record so a brief drop can resume cleanly. */
function persistNetSession(record: NetSessionRecord): void {
  setEnvelope<NetSessionRecord>(STORAGE_KEYS.netSession, record);
}

/** Drop the re-attach record. Idempotent. */
function clearNetSession(): void {
  removeItem(STORAGE_KEYS.netSession);
}

/** Read the re-attach record, or `null` if none / corrupt. */
function readNetSession(): NetSessionRecord | null {
  const env = getEnvelope<NetSessionRecord>(STORAGE_KEYS.netSession);
  if (!env) return null;
  const d = env.data;
  if (
    !d ||
    typeof d.code !== 'string' ||
    typeof d.ownToken !== 'string' ||
    (d.role !== 'host' && d.role !== 'joiner') ||
    !d.selfProfile
  ) {
    return null;
  }
  return d;
}

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
      // Step 19.5: a successful (re)handshake clears any pending
      // reconnect state and stops the auto-retry loop.
      connectionLost: false,
      connectionLostAt: null,
      reconnecting: false,
    });
    stopReconnectTimer();
    // Step 19.5: snapshot the re-attach record so a tab reload
    // (or a transient channel drop) can find it again. The token
    // is the SignalingClient's bearer token issued at host()/join().
    if (client.token) {
      persistNetSession({
        code,
        role,
        ownToken: client.token,
        selfProfile,
        savedAt: Date.now(),
      });
    }
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

      if (msg.type === 'DRAW_OFFER') {
        // Mirror the offerer's id into the local gameStore so the
        // opponent's UI renders Accept/Decline. Idempotent if the
        // offer was already pending (gameStore.offerDraw no-ops).
        if (msg.seq === expectedRemoteSeq) expectedRemoteSeq = msg.seq + 1;
        try {
          useGameStore.getState().offerDraw(msg.offererId);
        } catch (err) {
          logger.log('warn', 'draw.offer.apply', String(err));
        }
        return;
      }

      if (msg.type === 'DRAW_RESPONSE') {
        if (msg.seq === expectedRemoteSeq) expectedRemoteSeq = msg.seq + 1;
        try {
          if (msg.accepted) {
            useGameStore.getState().acceptDraw({ source: 'remote' });
          } else {
            useGameStore.getState().rejectDraw();
          }
        } catch (err) {
          logger.log('warn', 'draw.response.apply', String(err));
        }
        return;
      }

      if (msg.type === 'DRAW_CANCEL') {
        // Offerer withdrew. Clear our local pending-offer state
        // so the Accept/Decline panel disappears. Equivalent to
        // a local rejectDraw, but driven by the peer's intent.
        if (msg.seq === expectedRemoteSeq) expectedRemoteSeq = msg.seq + 1;
        try {
          useGameStore.getState().rejectDraw();
        } catch (err) {
          logger.log('warn', 'draw.cancel.apply', String(err));
        }
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
        // user can retry.
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
          return;
        }
        // Step 19: branch by reason during a game.
        //   'forfeit' / 'normal' — peer resigned (or natural close-
        //                          out without action/draw growth):
        //                          local player wins.
        //   'timeout'            — peer claimed-win because we were
        //                          unreachable: local player LOSES.
        //   'protocol'           — fatal bug on either side; tear
        //                          the session down with an error.
        if (msg.reason === 'timeout') {
          // We lose. Forfeit the LOCAL player so the gameStore
          // marks the opponent as winner. The phase-change
          // subscriber will then tear the session down.
          const gs = useGameStore.getState();
          if (gs.game && gs.game.phase === 'playing') {
            const localIdx = gs.localPlayerIndex ?? 0;
            gs.forfeit(gs.game.players[localIdx].id);
          }
          return;
        }
        // Mid-game BYE: end the local game in favour of the
        // surviving player (the local one, since the peer left),
        // then tear the session down so any future "Network Game"
        // click starts clean. The GameCanvas already routes back
        // to the main menu after `phase === 'finished'`.
        handleRemoteAbort('left');
        return;
      }
    });

    // Long-lived state listener: if the channel drops *after* the
    // handshake (peer closed their tab / network died), tell the
    // local game so the survivor isn't stranded on a frozen board.
    peer.on('state', (s) => {
      if (s !== 'closed' && s !== 'failed') return;
      // Don't clobber an existing error (e.g. from BYE handler).
      if (get().status === 'error') return;
      if (get().gameStarted) {
        // Step 19: mid-game disconnect no longer auto-forfeits.
        // We flip into a grace state and the ReconnectOverlay
        // gives the user 60 s before they may Claim Win / Resign.
        // The peer is left as-is — teardown happens when the user
        // actually ends the game.
        if (!get().connectionLost) {
          set({ connectionLost: true, connectionLostAt: Date.now() });
          // Step 19.5: kick off the auto-reconnect loop. We retry
          // every RECONNECT_RETRY_MS until the channel is back,
          // the user resigns/claims, or the netSession record is
          // dropped because the server says it's gone.
          startReconnectTimer();
        }
        return;
      }
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
   * Common path for "peer is gone while the game is in progress".
   *
   * Inputs : `cause` — short tag used in logs only.
   * Outputs: none.
   * Side fx: marks the LOCAL player as the winner (the peer
   *          forfeited by leaving), then tears down the session.
   *
   * Why forfeit the opponent? In v1 there's no grace timer or
   * reconnect (those land in Step 19). A surviving player should
   * still see a clean end-screen instead of a dead board, and
   * "the player who walked away loses" is the most defensible
   * default. The CanvasGame's existing `phase === 'finished'`
   * UI handles routing back to the main menu on tap.
   */
  function handleRemoteAbort(cause: string): void {
    const gs = useGameStore.getState();
    const game = gs.game;
    if (game && game.phase === 'playing') {
      const localIdx = gs.localPlayerIndex ?? 0;
      const opponent = game.players[localIdx === 0 ? 1 : 0];
      gs.forfeit(opponent.id); // sets winnerId = local player
    }
    // Drop the wire immediately. The store reset clears
    // `gameStarted` so the user can launch a new network game
    // without a hard refresh.
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
    // `cause` is purely diagnostic — no UI surface in v1.
    void cause;
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
    stopReconnectTimer();
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

  /**
   * Step 19.5: schedule (or no-op) the auto-reconnect interval.
   * Each tick calls `attemptReconnect()` if no attempt is already
   * in flight. Idempotent.
   */
  function startReconnectTimer(): void {
    if (reconnectTimer) return;
    // Fire one attempt immediately so the user doesn't wait the
    // full interval after the channel drops.
    void get().attemptReconnect();
    reconnectTimer = setInterval(() => {
      const s = get();
      if (!s.connectionLost) {
        stopReconnectTimer();
        return;
      }
      if (!s.reconnecting) void get().attemptReconnect();
    }, RECONNECT_RETRY_MS);
  }

  /** Stop the auto-reconnect interval if running. */
  function stopReconnectTimer(): void {
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
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
    connectionLost: false,
    connectionLostAt: null,
    reconnecting: false,

    async host(selfProfile) {
      if (inFlight) return;
      inFlight = true;
      // Drop any stale re-attach record from a prior session so a
      // failed handshake here doesn't leave a misleading envelope
      // on disk that a future tab might try to resume from.
      clearNetSession();
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
      clearNetSession();
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
      clearNetSession();
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
        connectionLost: false,
        connectionLostAt: null,
        reconnecting: false,
      });
    },

    sendDrawOffer(offererId) {
      if (!currentPeer) return;
      try {
        currentPeer.send({
          v: PROTOCOL_VERSION,
          gameId: get().code ?? '',
          senderId: getDeviceId(),
          seq: outgoingSeq++,
          t: Date.now(),
          type: 'DRAW_OFFER',
          offererId,
        });
      } catch {
        // ignore — peer may be down; the local UI already shows
        // the pending offer and the user can resign instead.
      }
    },

    sendDrawResponse(accepted) {
      if (!currentPeer) return;
      try {
        currentPeer.send({
          v: PROTOCOL_VERSION,
          gameId: get().code ?? '',
          senderId: getDeviceId(),
          seq: outgoingSeq++,
          t: Date.now(),
          type: 'DRAW_RESPONSE',
          accepted,
        });
      } catch {
        // ignore — best effort
      }
    },

    sendDrawCancel() {
      if (!currentPeer) return;
      try {
        currentPeer.send({
          v: PROTOCOL_VERSION,
          gameId: get().code ?? '',
          senderId: getDeviceId(),
          seq: outgoingSeq++,
          t: Date.now(),
          type: 'DRAW_CANCEL',
        });
      } catch {
        // ignore — best effort
      }
    },

    claimWin() {
      const gs = useGameStore.getState();
      if (!gs.game || gs.game.phase !== 'playing') return;
      const localIdx = gs.localPlayerIndex ?? 0;
      const opponent = gs.game.players[localIdx === 0 ? 1 : 0];
      // The subscriber at the bottom of this module will read
      // `pendingByeReason` and send the BYE for us. We don't send
      // it here because the channel is likely already dead.
      pendingByeReason = 'timeout';
      gs.forfeit(opponent.id);
    },

    resign() {
      const gs = useGameStore.getState();
      if (!gs.game || gs.game.phase !== 'playing') return;
      const localIdx = gs.localPlayerIndex ?? 0;
      const localId = gs.game.players[localIdx].id;
      pendingByeReason = 'forfeit';
      gs.forfeit(localId);
    },

    async attemptReconnect() {
      // Step 19.5: idempotent guard. The auto-loop calls this every
      // RECONNECT_RETRY_MS and the user / boot path may also fire
      // it manually. We only want one in-flight attempt at a time.
      if (inFlight || get().reconnecting) return;
      // Only meaningful while a connection drop is being graced.
      // (App-boot restoration after a tab reload is intentionally
      // out of scope for this slice — see Step 19.5 plan notes.)
      if (!get().connectionLost) return;

      const record = readNetSession();
      if (!record) {
        // Nothing to resume against — stop the loop so the user
        // sees the grace timer expire and can Claim Win / Resign.
        stopReconnectTimer();
        return;
      }

      inFlight = true;
      set({ reconnecting: true });

      // Tear down the dead peer + signaling client BUT keep the
      // netSession envelope on disk so subsequent retries can find
      // it. teardown() doesn't touch the envelope.
      try {
        currentPeer?.close();
      } catch {
        /* best effort */
      }
      try {
        currentClient?.close();
      } catch {
        /* best effort */
      }
      stopHeartbeat();
      setActionBroadcaster(null);
      currentPeer = null;
      currentClient = null;
      // Reset our seq cursors: after a fresh handshake the peer
      // restarts at 0 too, so any stale expectedRemoteSeq from
      // before the drop would otherwise fire spurious gap warnings.
      outgoingSeq = 1;
      expectedRemoteSeq = 1;

      const client = createSignalingClient();
      currentClient = client;
      try {
        client.attach({
          code: record.code,
          role: record.role,
          token: record.ownToken,
        });
        await client.reattach();
        await runHandshake(
          record.role,
          record.selfProfile,
          record.code,
          client,
        );
        // The handshake clears `connectionLost` and stops the
        // reconnect timer. If a game was in progress we must also
        // re-install the gameStore→peer broadcaster (teardown
        // cleared it) so subsequent local moves resume going over
        // the wire on the NEW DataChannel.
        if (get().gameStarted) {
          installActionBroadcaster();
          // Step 20 will consume this and reply with the missed
          // actions. Until then the peer's handler falls through
          // (no-op) and we simply rely on the channel being open.
          const liveP = currentPeer as Peer | null;
          if (liveP) {
            try {
              liveP.send({
                v: PROTOCOL_VERSION,
                gameId: record.code,
                senderId: getDeviceId(),
                seq: outgoingSeq++,
                t: Date.now(),
                type: 'RESYNC_REQ',
                fromSeq: expectedRemoteSeq,
              });
            } catch {
              /* best effort — peer may already be flapping again */
            }
          }
        }
      } catch (err) {
        // Fatal vs transient. SignalingError with these codes means
        // the server has disowned the session and no amount of
        // retrying will help — drop the envelope and let the grace
        // timer expire so the user can Claim Win / Resign.
        const fatal =
          err instanceof SignalingError &&
          (err.code === 'not_found' ||
            err.code === 'bad_token' ||
            err.code === 'reneg_limit');
        if (fatal) {
          clearNetSession();
          stopReconnectTimer();
        }
        set({ reconnecting: false });
      } finally {
        inFlight = false;
      }
    },
  };
});

// ── Auto-cleanup when the network game ends ───────────────────
//
// Without this, finishing a networked game leaves `gameStarted`
// stuck at `true`; opening the lobby afterwards then bounces the
// user straight back to `/play` (the stale game) because the
// lobby reacts to `gameStarted`. We watch the gameStore for the
// `'playing' → 'finished' | 'draw'` transition and clean up the
// session here so the next "Network Game" click starts fresh.
//
// Best-effort BYE: it tells the peer we're done so their UI can
// also leave to the menu. A `send` throw is swallowed because the
// channel may already be half-closed (peer left first).

useGameStore.subscribe((state, prev) => {
  const wasPlaying = prev.game?.phase === 'playing';
  const nowEnded =
    state.game?.phase === 'finished' || state.game?.phase === 'draw';
  if (!wasPlaying || !nowEnded) return;

  const net = useNetStore.getState();
  if (!net.gameStarted) return;

  // The peer learns about the game ending one of three ways:
  //   1. ACTION    — a winning move (or repetition draw); actionLog grew.
  //   2. DRAW_RESPONSE — they accepted/were-told of an accepted offer.
  //   3. BYE       — true forfeit / "Give Up", no other signal goes out.
  // Only case 3 needs a BYE here. Sending BYE for cases 1 and 2 races
  // the real signal: BYE arrives first, peer's handleRemoteAbort runs,
  // and the peer ends up declared the winner regardless of what
  // actually happened. We detect (1) via actionLog growth and (2) via
  // a draw offer that was pending in `prev`.
  const actionAdvanced =
    state.actionLog.length > prev.actionLog.length;
  const drawAccepted =
    prev.game?.drawOfferFrom != null && state.game?.phase === 'draw';
  // If `claimWin` / `resign` queued a reason, send BYE with that
  // reason regardless of the heuristics above (the heuristics only
  // matter for moves and drawn-by-agreement endings).
  const overrideReason = pendingByeReason;
  pendingByeReason = null;
  const sendBye = overrideReason != null || (!actionAdvanced && !drawAccepted);
  const reason: ByeReason = overrideReason ?? 'forfeit';

  if (sendBye && currentPeer) {
    try {
      currentPeer.send({
        v: PROTOCOL_VERSION,
        gameId: net.code ?? '',
        senderId: getDeviceId(),
        seq: outgoingSeq++,
        t: Date.now(),
        type: 'BYE',
        reason,
      });
    } catch {
      // ignore — channel may already be down
    }
  }
  useNetStore.getState().endNetworkSession();
});

