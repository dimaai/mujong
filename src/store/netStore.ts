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
import { connectViaSignaling, createPeer, type Peer } from '../net/peer';
import {
  PROTOCOL_VERSION,
  type NetMessage,
  type Profile,
} from '../net/protocol';
import {
  createSignalingClient,
  SignalingError,
  type Role,
  type SignalingClient,
} from '../net/signaling';

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

/** Strings the UI shows under the spinner. */
export interface NetState {
  status: NetStatus;
  /** 6-char invitation code once allocated/joined. */
  code: string | null;
  /** Which role this client plays in the session. */
  role: Role | null;
  /** Peer's profile, populated after their HELLO arrives. */
  peerProfile: Profile | null;
  /** Human-readable error text, valid only when status === 'error'. */
  error: string | null;

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
   */
  leave: () => void;
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
/** Guards re-entrant `host()` / `join()` calls. */
let inFlight = false;

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
    const helloPromise = new Promise<Profile>((resolve, reject) => {
      const offMsg = peer.on('message', (msg) => {
        if (msg.type === 'HELLO') {
          offMsg();
          offState();
          resolve(msg.profile);
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
    const peerProfile = await helloPromise;
    set({ status: 'connected', peerProfile });
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
    inFlight = false;
  }

  return {
    status: 'idle',
    code: null,
    role: null,
    peerProfile: null,
    error: null,
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
        peerProfile: null,
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
        peerProfile: null,
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
        peerProfile: null,
        error: wasError ? get().error : null,
      });
      // After a deliberate leave we always clear the error too;
      // the `wasError` branch above is defensive in case future
      // callers want to inspect it after teardown.
      set({ error: null });
    },
  };
});
