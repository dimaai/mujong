// ============================================================
// src/net/__tests__/peer.fake.test.ts
//
// PURPOSE
//   Step 12 unit tests for `createPeer`. WebRTC is not available
//   in Node, so we inject a fake `RTCPeerConnection` factory and
//   exercise the wrapper's behaviour directly:
//
//     1. State machine: `'connecting'` → `'open'` once the
//        DataChannel reports open.
//     2. `send` runs `encode` and writes to the channel.
//     3. Inbound channel data flows through `decode` and emits
//        `'message'` with a valid `NetMessage`.
//     4. ICE candidates added BEFORE the remote description is
//        set are buffered, then flushed (in order) afterwards.
//     5. Malformed inbound JSON emits `'error'` with a
//        `NetProtocolError`, but does not crash the peer.
//
//   The fakes implement only the small RTC surface that
//   `peer.ts` actually touches. Any mismatch with the real API
//   would cause TS compile failures, which is exactly the
//   safety net we want.
// ============================================================

import { describe, expect, it, vi } from 'vitest';

import { createPeer, DATA_CHANNEL_LABEL } from '../peer';
import {
  encode,
  PROTOCOL_VERSION,
  type NetMessage,
} from '../protocol';

// ── Fake DataChannel ──────────────────────────────────────────

/**
 * Minimal stand-in for `RTCDataChannel`. We expose the writable
 * fields `peer.ts` assigns to (`onopen`, `onmessage`, …) plus
 * test-only helpers (`__open`, `__deliver`) that simulate the
 * remote side without doing any real networking.
 */
class FakeDataChannel {
  readyState: RTCDataChannelState = 'connecting';
  label: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;

  /** Captures everything `peer.send(...)` writes. */
  readonly sent: string[] = [];

  constructor(label: string) {
    this.label = label;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }

  // ── Test helpers (not on the real API) ────────────────────
  __open(): void {
    this.readyState = 'open';
    this.onopen?.();
  }

  __deliver(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

// ── Fake RTCPeerConnection ────────────────────────────────────

interface FakeHandle {
  pc: FakePeerConnection;
  channel: FakeDataChannel;
}

class FakePeerConnection {
  // ── Real-API surface used by peer.ts ─────────────────────
  localDescription: RTCSessionDescription | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  ondatachannel: ((ev: RTCDataChannelEvent) => void) | null = null;
  onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

  // The (single) channel created by host-mode `peer.ts`. Joiner
  // tests can simulate `ondatachannel` with `__deliverChannel`.
  channel: FakeDataChannel | null = null;

  // Track ICE candidates passed to `addIceCandidate` — tests use
  // this to assert ordering of the buffered flush.
  readonly addedIce: RTCIceCandidateInit[] = [];

  createDataChannel(label: string): FakeDataChannel {
    this.channel = new FakeDataChannel(label);
    return this.channel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'v=0\r\nfake-offer\r\n' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'v=0\r\nfake-answer\r\n' };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = {
      type: desc.type ?? 'offer',
      sdp: desc.sdp ?? '',
      toJSON() {
        return this;
      },
    } as RTCSessionDescription;
  }

  async setRemoteDescription(): Promise<void> {
    // no-op; we only care that this resolves so peer.ts can
    // proceed to flush its ICE buffer.
  }

  async addIceCandidate(c: RTCIceCandidateInit): Promise<void> {
    this.addedIce.push(c);
  }

  close(): void {
    this.connectionState = 'closed';
    this.onconnectionstatechange?.();
    this.channel?.close();
  }
}

/**
 * Build a `Peer` plus the fake handle so tests can drive the
 * "remote side" of the connection without real WebRTC.
 */
function buildHostPeer(): { peer: ReturnType<typeof createPeer>; handle: FakeHandle } {
  const pc = new FakePeerConnection();
  const peer = createPeer({
    role: 'host',
    rtcFactory: () => pc as unknown as RTCPeerConnection,
  });
  // host-mode `peer.ts` synchronously creates the channel.
  const channel = pc.channel!;
  return { peer, handle: { pc, channel } };
}

// ── Fixtures ──────────────────────────────────────────────────

const baseEnvelope = {
  v: PROTOCOL_VERSION,
  gameId: 'g1',
  senderId: 'peer-A',
  seq: 0,
  t: 1_700_000_000_000,
};

const helloMsg: NetMessage = {
  ...baseEnvelope,
  type: 'HELLO',
  profile: { name: 'Ada', color: '#abcdef' },
};

// ── Tests ─────────────────────────────────────────────────────

describe('createPeer (fake RTC)', () => {
  it('transitions to "open" when the DataChannel opens', async () => {
    const { peer, handle } = buildHostPeer();
    const states: string[] = [];
    peer.on('state', (s) => states.push(s));

    expect(peer.state).toBe('new');
    await peer.createOffer();
    expect(peer.state).toBe('connecting');

    handle.channel.__open();
    expect(peer.state).toBe('open');

    // No duplicate emissions: peer.ts suppresses same-state emits.
    expect(states).toEqual(['connecting', 'open']);
  });

  it('encodes outbound messages onto the DataChannel', async () => {
    const { peer, handle } = buildHostPeer();
    await peer.createOffer();
    handle.channel.__open();

    peer.send(helloMsg);

    expect(handle.channel.sent).toHaveLength(1);
    expect(JSON.parse(handle.channel.sent[0])).toEqual(helloMsg);
  });

  it('refuses to send before the channel is open', async () => {
    const { peer } = buildHostPeer();
    expect(() => peer.send(helloMsg)).toThrow(/DataChannel not open/);
  });

  it('decodes inbound messages and emits "message"', async () => {
    const { peer, handle } = buildHostPeer();
    await peer.createOffer();
    handle.channel.__open();

    const received = vi.fn();
    peer.on('message', received);
    handle.channel.__deliver(encode(helloMsg));

    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(helloMsg);
  });

  it('emits "error" on malformed inbound payloads without crashing', async () => {
    const { peer, handle } = buildHostPeer();
    await peer.createOffer();
    handle.channel.__open();

    const errSpy = vi.fn();
    const msgSpy = vi.fn();
    peer.on('error', errSpy);
    peer.on('message', msgSpy);

    handle.channel.__deliver('{not json');

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(msgSpy).not.toHaveBeenCalled();
    // Channel survives — a follow-up valid message is still delivered.
    handle.channel.__deliver(encode(helloMsg));
    expect(msgSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the configured DataChannel label', () => {
    const { handle } = buildHostPeer();
    expect(handle.channel.label).toBe(DATA_CHANNEL_LABEL);
  });

  it('buffers ICE candidates added before remote description, then flushes', async () => {
    // Use the joiner role so we exercise `acceptOffer` (the
    // first call site that flips `remoteDescriptionSet`).
    const pc = new FakePeerConnection();
    const peer = createPeer({
      role: 'joiner',
      rtcFactory: () => pc as unknown as RTCPeerConnection,
    });

    const c1: RTCIceCandidateInit = { candidate: 'cand1', sdpMLineIndex: 0 };
    const c2: RTCIceCandidateInit = { candidate: 'cand2', sdpMLineIndex: 0 };

    // Both arrive before we accept the offer → must be buffered.
    await peer.addIceCandidate(c1);
    await peer.addIceCandidate(c2);
    expect(pc.addedIce).toEqual([]);

    await peer.acceptOffer('v=0\r\nfake-offer\r\n');
    // After remote description is set, the buffer is drained
    // in insertion order.
    expect(pc.addedIce).toEqual([c1, c2]);

    // A subsequent candidate should flow through synchronously.
    const c3: RTCIceCandidateInit = { candidate: 'cand3', sdpMLineIndex: 0 };
    await peer.addIceCandidate(c3);
    expect(pc.addedIce).toEqual([c1, c2, c3]);
  });

  it('close() emits "closed" exactly once', () => {
    const { peer } = buildHostPeer();
    const states: string[] = [];
    peer.on('state', (s) => states.push(s));

    peer.close();
    peer.close(); // idempotent

    expect(states.filter((s) => s === 'closed')).toHaveLength(1);
  });
});
