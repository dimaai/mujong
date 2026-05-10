// ============================================================
// src/net/peer.ts
//
// PURPOSE
//   Typed adapter around `RTCPeerConnection` + a single
//   `RTCDataChannel` (IMPLEMENTATION_PLAN Step 12).
//
//   The peer is a pure transport — it knows nothing about the
//   game store, React, or the DOM beyond the WebRTC API itself.
//   Higher layers (signaling client, store glue) consume the
//   `Peer` interface and never touch `RTCPeerConnection`
//   directly. This keeps WebRTC quirks confined to one file and
//   lets a future React Native build swap the implementation
//   without rewriting callers.
//
//   What this file owns:
//     1. The `Peer` interface and its event shape.
//     2. The `createPeer({ role, logger, rtcConfig, rtcFactory })`
//        factory. `rtcFactory` is an injection seam so unit
//        tests can run under Node with a fake RTC shim — Step 12
//        explicitly requires this.
//     3. ICE-candidate buffering: candidates received before the
//        remote description is set are queued and flushed once
//        it is, avoiding the well-known Chrome ordering bug.
//
//   What this file deliberately does NOT do:
//     - No signaling. Step 12 is "manual SDP, no signaling yet".
//       Callers obtain offer/answer SDPs and trade ICE candidates
//       however they like (Step 13/14 will plug in the real
//       service).
//     - No automatic reconnection. The peer surfaces `'failed'`
//       and `'closed'` and lets the caller decide what to do.
// ============================================================

import {
  decode,
  encode,
  NetProtocolError,
  type NetMessage,
} from './protocol';
import type { NetLogger } from './log';
import { SignalingAbortError, type SignalingClient } from './signaling';

// ── Public types ──────────────────────────────────────────────

/** Which side of the handshake this peer plays. */
export type PeerRole = 'host' | 'joiner';

/**
 * High-level connection state surfaced to consumers. We collapse
 * the various low-level WebRTC fields (`iceConnectionState`,
 * `connectionState`, `RTCDataChannel.readyState`) into the small
 * vocabulary the rest of the app actually cares about.
 */
export type PeerState = 'new' | 'connecting' | 'open' | 'closed' | 'failed';

/**
 * Strongly-typed event map for `Peer.on`. Adding a new event here
 * forces every caller to handle it (or explicitly ignore it),
 * which is what we want — a silent transport event is a bug.
 */
export interface PeerEvents {
  /** Connection state changed. Idempotent: same state twice is suppressed. */
  state: PeerState;
  /** A successfully decoded application message arrived. */
  message: NetMessage;
  /**
   * A local ICE candidate was discovered and should be relayed
   * to the remote peer. `null` signals end-of-candidates.
   */
  ice: RTCIceCandidateInit | null;
  /**
   * A non-fatal error occurred (e.g. a malformed inbound message).
   * Fatal failures are reported via `state: 'failed'` instead.
   */
  error: Error;
}

/**
 * The transport surface the rest of the net layer talks to.
 *
 * Lifecycle:
 *   host:    createOffer → (relay SDP) → acceptAnswer → exchange ICE → 'open'
 *   joiner:  acceptOffer → createAnswer → (relay SDP) → exchange ICE → 'open'
 *
 * `send` is safe to call only when `state === 'open'`; calling
 * earlier throws synchronously. We could buffer instead, but
 * silently buffering pre-open writes hides bugs more often than
 * it helps.
 */
export interface Peer {
  /** Host: build an SDP offer and start gathering ICE. */
  createOffer(): Promise<string>;
  /** Joiner: consume the host's SDP offer. */
  acceptOffer(sdp: string): Promise<void>;
  /** Joiner: build an SDP answer in response to the offer. */
  createAnswer(): Promise<string>;
  /** Host: consume the joiner's SDP answer. */
  acceptAnswer(sdp: string): Promise<void>;
  /** Add a remote ICE candidate. Buffered if remote SDP isn't set yet. */
  addIceCandidate(c: RTCIceCandidateInit): Promise<void>;
  /** Send a protocol message. Throws unless `state === 'open'`. */
  send(msg: NetMessage): void;
  /** Subscribe to an event. Returns an unsubscribe function. */
  on<E extends keyof PeerEvents>(
    event: E,
    handler: (payload: PeerEvents[E]) => void,
  ): () => void;
  /** Tear down the connection. Idempotent; emits `state: 'closed'`. */
  close(): void;
  /** Current high-level state. */
  readonly state: PeerState;
  /** Underlying role, mostly for diagnostics / debug pages. */
  readonly role: PeerRole;
}

// ── Factory options ───────────────────────────────────────────

/**
 * `createPeer` options. Almost everything is optional so callers
 * can stay terse; the only required field is `role`.
 */
export interface CreatePeerOptions {
  role: PeerRole;
  /** Net-layer logger (Step 11). When omitted, logging is dropped. */
  logger?: NetLogger;
  /** Passed straight through to `RTCPeerConnection`. */
  rtcConfig?: RTCConfiguration;
  /**
   * Test seam: produces an `RTCPeerConnection`. Defaults to
   * `(cfg) => new RTCPeerConnection(cfg)`. Tests pass a fake.
   * Kept narrow on purpose — no logger/role visibility here.
   */
  rtcFactory?: (config?: RTCConfiguration) => RTCPeerConnection;
}

/** DataChannel label is part of the wire contract. Both sides must agree. */
export const DATA_CHANNEL_LABEL = 'mojong';

// ── Implementation ────────────────────────────────────────────

/**
 * Build a `Peer`.
 *
 * Inputs : `CreatePeerOptions`.
 * Output : a `Peer` implementing the lifecycle above.
 * Side effects: constructs one `RTCPeerConnection`. No globals,
 * no DOM access; safe to call from a Web Worker or React Native.
 */
export function createPeer(options: CreatePeerOptions): Peer {
  const { role, logger, rtcConfig, rtcFactory } = options;

  // Tiny typed event bus. We avoid a 3rd-party emitter to keep
  // the bundle small and the dependency graph clean.
  const handlers: { [E in keyof PeerEvents]: Set<(p: PeerEvents[E]) => void> } = {
    state: new Set(),
    message: new Set(),
    ice: new Set(),
    error: new Set(),
  };

  const emit = <E extends keyof PeerEvents>(event: E, payload: PeerEvents[E]): void => {
    // Snapshot the set first: a handler is allowed to unsubscribe
    // itself (or others) without disturbing the current dispatch.
    for (const h of [...handlers[event]]) {
      try {
        h(payload);
      } catch (err) {
        logger?.log('error', 'peer', { msg: 'handler threw', event, err: String(err) });
      }
    }
  };

  const factory = rtcFactory ?? ((cfg) => new RTCPeerConnection(cfg));
  // Default ICE configuration:
  //   - Multiple public STUN servers for redundancy.
  //   - Open Relay Project's free public TURN servers as a
  //     fallback for symmetric-NAT networks (corporate Wi-Fi,
  //     mobile CGNAT) where STUN alone can't traverse.
  // Caller can override entirely or pass `{}` to opt out.
  const effectiveConfig: RTCConfiguration = rtcConfig ?? {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
  };
  const pc = factory(effectiveConfig);

  // ICE candidates received before the remote description is set
  // must be queued — `addIceCandidate` rejects otherwise.
  const pendingRemoteIce: RTCIceCandidateInit[] = [];
  let remoteDescriptionSet = false;

  let dataChannel: RTCDataChannel | null = null;
  let currentState: PeerState = 'new';

  const setState = (next: PeerState): void => {
    if (next === currentState) return;
    currentState = next;
    logger?.log('debug', 'peer', { role, state: next });
    emit('state', next);
  };

  // ── DataChannel wiring ──────────────────────────────────────

  /**
   * Hook up message/open/close handlers on a DataChannel. Used
   * by both sides — host creates the channel up front, joiner
   * receives it via `ondatachannel`.
   */
  const attachDataChannel = (ch: RTCDataChannel): void => {
    dataChannel = ch;
    ch.onopen = () => setState('open');
    ch.onclose = () => setState('closed');
    ch.onerror = (ev) => {
      const err = (ev as RTCErrorEvent).error ?? new Error('datachannel error');
      logger?.log('error', 'peer', { role, msg: 'datachannel error', err: String(err) });
      emit('error', err);
    };
    ch.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') {
        const err = new Error('non-string DataChannel payload');
        logger?.log('warn', 'peer', { role, msg: err.message });
        emit('error', err);
        return;
      }
      try {
        const msg = decode(ev.data);
        emit('message', msg);
      } catch (err) {
        if (err instanceof NetProtocolError) {
          logger?.log('warn', 'peer', { role, msg: 'bad inbound message', err: err.message });
          emit('error', err);
        } else {
          throw err;
        }
      }
    };
  };

  if (role === 'host') {
    // Host opens the channel; the SDP offer will advertise it.
    attachDataChannel(pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true }));
  } else {
    // Joiner waits for the channel to arrive in the offer.
    pc.ondatachannel = (ev) => {
      if (ev.channel.label !== DATA_CHANNEL_LABEL) {
        logger?.log('warn', 'peer', {
          role,
          msg: 'unexpected channel label',
          label: ev.channel.label,
        });
        return;
      }
      attachDataChannel(ev.channel);
    };
  }

  // ── Connection-level events ─────────────────────────────────

  pc.onicecandidate = (ev) => {
    // `null` candidate marks end-of-candidates and is forwarded
    // verbatim so the signaling layer can stop polling.
    if (ev.candidate) {
      // Log candidate type (host/srflx/prflx/relay) so we can tell
      // from the on-device debug overlay whether TURN actually
      // produced a relay candidate. A failed connect with zero
      // relay candidates almost always means the TURN server is
      // broken or unreachable (e.g. retired public service).
      const c = ev.candidate;
      const m = /typ (\w+)/.exec(c.candidate);
      logger?.log('debug', 'peer', {
        role,
        ice: 'local',
        type: m?.[1] ?? 'unknown',
        protocol: c.protocol,
        address: c.address,
        port: c.port,
        url: (c as RTCIceCandidate & { url?: string }).url,
      });
      emit('ice', c.toJSON());
    } else {
      logger?.log('debug', 'peer', { role, ice: 'local', type: 'end-of-candidates' });
      emit('ice', null);
    }
  };

  // Both `connectionState` and `iceConnectionState` can move us
  // between high-level states; whichever fires first wins.
  // We deliberately ignore the transient `'disconnected'` state —
  // it commonly appears mid-handshake before settling, and treating
  // it as a terminal failure aborts otherwise-healthy connections.
  // The DataChannel's `onclose` will fire if the channel actually
  // dies, and `'failed'` is fatal per the spec.
  const reflectConnectionState = (): void => {
    const cs = pc.connectionState;
    if (cs === 'connecting' || cs === 'new') setState('connecting');
    else if (cs === 'failed') setState('failed');
    else if (cs === 'closed') setState('closed');
    // 'connected' and 'disconnected' are intentionally ignored:
    //  - 'connected' → wait for DataChannel.onopen (when send works)
    //  - 'disconnected' → transient; let it settle or escalate to 'failed'
  };
  pc.onconnectionstatechange = reflectConnectionState;
  pc.oniceconnectionstatechange = () => {
    logger?.log('debug', 'peer', {
      role,
      iceConnectionState: pc.iceConnectionState,
    });
    if (pc.iceConnectionState === 'failed') setState('failed');
  };
  pc.onicegatheringstatechange = () => {
    logger?.log('debug', 'peer', {
      role,
      iceGatheringState: pc.iceGatheringState,
    });
  };
  pc.onicecandidateerror = (ev: Event) => {
    // Cast: lib.dom types this as Event in older lib versions.
    const e = ev as RTCPeerConnectionIceErrorEvent;
    logger?.log('warn', 'peer', {
      role,
      msg: 'ice candidate error',
      url: e.url,
      errorCode: e.errorCode,
      errorText: e.errorText,
    });
  };

  // ── Public methods ──────────────────────────────────────────

  const flushPendingRemoteIce = async (): Promise<void> => {
    while (pendingRemoteIce.length > 0) {
      const c = pendingRemoteIce.shift()!;
      try {
        await pc.addIceCandidate(c);
      } catch (err) {
        logger?.log('warn', 'peer', { role, msg: 'flush ice failed', err: String(err) });
      }
    }
  };

  const createOffer = async (): Promise<string> => {
    if (role !== 'host') throw new Error('createOffer called on joiner');
    setState('connecting');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // `pc.localDescription` is normalized by the browser; prefer it
    // over the raw `offer` object because Trickle ICE may augment it.
    return pc.localDescription?.sdp ?? offer.sdp ?? '';
  };

  const acceptOffer = async (sdp: string): Promise<void> => {
    if (role !== 'joiner') throw new Error('acceptOffer called on host');
    setState('connecting');
    await pc.setRemoteDescription({ type: 'offer', sdp });
    remoteDescriptionSet = true;
    await flushPendingRemoteIce();
  };

  const createAnswer = async (): Promise<string> => {
    if (role !== 'joiner') throw new Error('createAnswer called on host');
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return pc.localDescription?.sdp ?? answer.sdp ?? '';
  };

  const acceptAnswer = async (sdp: string): Promise<void> => {
    if (role !== 'host') throw new Error('acceptAnswer called on joiner');
    await pc.setRemoteDescription({ type: 'answer', sdp });
    remoteDescriptionSet = true;
    await flushPendingRemoteIce();
  };

  const addIceCandidate = async (c: RTCIceCandidateInit): Promise<void> => {
    // Log remote candidate types alongside the local ones so the
    // debug overlay shows the full picture of what each side
    // contributed to the candidate pair pool.
    if (c.candidate) {
      const m = /typ (\w+)/.exec(c.candidate);
      logger?.log('debug', 'peer', {
        role,
        ice: 'remote',
        type: m?.[1] ?? 'unknown',
      });
    }
    if (!remoteDescriptionSet) {
      pendingRemoteIce.push(c);
      return;
    }
    await pc.addIceCandidate(c);
  };

  const send = (msg: NetMessage): void => {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      throw new Error(
        `peer.send called while state=${currentState}; DataChannel not open`,
      );
    }
    dataChannel.send(encode(msg));
  };

  const on: Peer['on'] = (event, handler) => {
    // Cast: TS can't see that `handler` matches `PeerEvents[event]`
    // through the index signature, but the public signature does.
    (handlers[event] as Set<typeof handler>).add(handler);
    return () => {
      (handlers[event] as Set<typeof handler>).delete(handler);
    };
  };

  const close = (): void => {
    try {
      dataChannel?.close();
    } catch {
      // best-effort; the channel may already be gone
    }
    try {
      pc.close();
    } catch {
      // ditto
    }
    setState('closed');
  };

  return {
    createOffer,
    acceptOffer,
    createAnswer,
    acceptAnswer,
    addIceCandidate,
    send,
    on,
    close,
    get state() {
      return currentState;
    },
    get role() {
      return role;
    },
  };
}

// ── connectViaSignaling ───────────────────────────────────────

/**
 * Drive a `Peer` end-to-end using a `SignalingClient`.
 *
 *   Inputs : `peer`   — built by `createPeer({ role })`
 *            `client` — already past `host()` / `join()`, so it
 *                       has a code + bearer token
 *            `role`   — must match how `peer` was built; passed
 *                       in explicitly to keep this orchestrator
 *                       a pure adapter that doesn't read the
 *                       peer's private `role` field
 *            `logger` — optional, same as `createPeer`
 *
 *   Output : a Promise that resolves once `peer.state === 'open'`
 *            and rejects on `'failed'`, `'closed'`, or any
 *            signaling error.
 *
 *   Side fx: subscribes the peer's `'ice'` event to
 *            `client.postIce`; runs an async loop draining
 *            `client.pollIce` into `peer.addIceCandidate` until
 *            the peer is open / closed. The loop is detached:
 *            callers don't need to await it. Any errors from
 *            the loop surface as `peer.error` events.
 *
 *   Cleanup: on resolve OR reject this function unsubscribes
 *            its listeners. It does NOT close the peer or the
 *            client — that's the caller's call (e.g. the lobby
 *            UI keeps the peer alive long after open).
 */
export async function connectViaSignaling(
  peer: Peer,
  client: SignalingClient,
  role: PeerRole,
  logger?: NetLogger,
): Promise<void> {
  const otherRole: PeerRole = role === 'host' ? 'joiner' : 'host';
  let stopped = false;

  // Forward local ICE candidates to the server. We swallow errors
  // here (logging them) because losing one candidate doesn't have
  // to be fatal — WebRTC will pick another path if it can.
  const offIce = peer.on('ice', (cand) => {
    client.postIce(role, cand).catch((err: unknown) => {
      if (stopped) return;
      logger?.log('warn', 'signaling', { msg: 'postIce failed', err: String(err) });
    });
  });

  // Drain the remote side's ICE queue into the peer until we
  // stop. `pollIce` returns one batch (possibly empty after a 204)
  // per call, so we re-enter the loop immediately.
  const drainIce = async (): Promise<void> => {
    while (!stopped) {
      try {
        const batch = await client.pollIce(otherRole);
        for (const c of batch) {
          if (c === null) continue; // end-of-candidates marker
          await peer.addIceCandidate(c);
        }
      } catch (err) {
        if (stopped || err instanceof SignalingAbortError) return;
        logger?.log('warn', 'signaling', { msg: 'pollIce failed', err: String(err) });
        // brief pause so a server-error storm doesn't pin a CPU
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  };
  // Detached on purpose — no top-level await.
  void drainIce();

  // Watch peer state to know when we're done.
  // Initialised to a no-op so TS sees `onState` as always callable;
  // the real unsubscribe is wired up inside the Promise executor.
  let onState: () => void = () => {};
  const stateGate = new Promise<void>((resolve, reject) => {
    onState = peer.on('state', (s) => {
      if (s === 'open') resolve();
      else if (s === 'failed' || s === 'closed') {
        reject(new Error(`peer entered terminal state: ${s}`));
      }
    });
    // If the peer is already in a terminal/open state when we
    // subscribe, the event has already fired — check up front.
    if (peer.state === 'open') resolve();
    else if (peer.state === 'failed' || peer.state === 'closed') {
      reject(new Error(`peer entered terminal state: ${peer.state}`));
    }
  });
  // Defensive: if the surrounding `try` block throws before we
  // reach `await stateGate`, the gate may resolve/reject with no
  // observer. Attaching a no-op catch keeps it from surfacing as
  // an unhandled rejection in Next.js's dev overlay; the real
  // `await stateGate` below still sees the eventual outcome.
  stateGate.catch(() => {});

  try {
    if (role === 'host') {
      const offer = await peer.createOffer();
      await client.putSdp('host', offer);
      const answer = await client.pollSdp('joiner');
      await peer.acceptAnswer(answer);
    } else {
      const offer = await client.pollSdp('host');
      await peer.acceptOffer(offer);
      const answer = await peer.createAnswer();
      await client.putSdp('joiner', answer);
    }
    await stateGate;
  } finally {
    stopped = true;
    offIce();
    onState();
  }
}
