// ============================================================
// src/app/debug/peer/page.tsx
//
// PURPOSE
//   Manual-SDP harness for the Step 12 `Peer` wrapper.
//
//   Until Step 13/14 add a real signaling service, the only way
//   to bring two browser tabs together is to copy/paste SDP and
//   ICE candidates by hand. This page provides the textareas and
//   buttons to do that, plus a live log so we can watch the
//   transport's state transitions.
//
//   It is gated behind `process.env.NODE_ENV !== 'production'`
//   (Next.js performs the substitution at build time) so it
//   never ships in the deployed bundle.
//
//   This page intentionally has no styles file: visual polish is
//   irrelevant for a debug surface, and a CSS module would just
//   slow the iteration loop. Inline styles keep the file
//   self-contained.
// ============================================================

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createNetLogger, type LogEntry, type NetLogger } from '../../../net/log';
import { connectViaSignaling, createPeer, type Peer, type PeerRole, type PeerState } from '../../../net/peer';
import { PROTOCOL_VERSION, type NetMessage } from '../../../net/protocol';
import { createSignalingClient, type SignalingClient } from '../../../net/signaling';

// Cheap unique-ish id: generated client-side after mount so SSR
// and client agree on the initial render (otherwise Math.random
// would diverge between the two and trigger a hydration error).

/**
 * DebugPeerPage — /_ debug/peer route.
 *
 * Inputs : none (route component).
 * Outputs: rendered controls for either the host or joiner side
 *          of a manual WebRTC handshake.
 * Side effects: constructs an `RTCPeerConnection` once a role is
 * chosen; tears it down on unmount.
 */
export default function DebugPeerPage(): React.ReactElement {
  if (process.env.NODE_ENV === 'production') {
    return (
      <main style={{ padding: 24, fontFamily: 'system-ui' }}>
        <h1>Debug page disabled</h1>
        <p>This route is only available in non-production builds.</p>
      </main>
    );
  }
  return <DebugPeerHarness />;
}

// Separated so the production-gate `return` short-circuits the
// hooks below — calling `createPeer` on the server would explode.
function DebugPeerHarness(): React.ReactElement {
  const logger = useMemo<NetLogger>(() => createNetLogger({ capacity: 500 }), []);
  // Empty on first render (matches SSR), filled in on mount.
  const [tabSenderId, setTabSenderId] = useState<string>('');
  useEffect(() => {
    setTabSenderId(`dbg-${Math.random().toString(36).slice(2, 8)}`);
  }, []);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [mode, setMode] = useState<'manual' | 'signaling'>('manual');
  const [role, setRole] = useState<PeerRole | null>(null);
  const [state, setState] = useState<PeerState>('new');
  const [localSdp, setLocalSdp] = useState('');
  const [remoteSdp, setRemoteSdp] = useState('');
  const [outgoingText, setOutgoingText] = useState('Hello');
  const [received, setReceived] = useState<NetMessage[]>([]);
  const [localIce, setLocalIce] = useState<string[]>([]);
  const [remoteIceText, setRemoteIceText] = useState('');
  const [sessionCode, setSessionCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [signalingError, setSignalingError] = useState<string | null>(null);
  const [signalingBusy, setSignalingBusy] = useState(false);

  const peerRef = useRef<Peer | null>(null);
  const clientRef = useRef<SignalingClient | null>(null);

  // Pump logger snapshots into local state every 250ms. Polling is
  // fine for a debug surface — we don't need a sub to the logger.
  useEffect(() => {
    const id = window.setInterval(() => {
      setLogEntries(logger.snapshot());
    }, 250);
    return () => window.clearInterval(id);
  }, [logger]);

  // Tear down on unmount so leaving the page closes the RTC.
  useEffect(() => {
    return () => {
      peerRef.current?.close();
      peerRef.current = null;
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  const initPeer = useCallback(
    (chosenRole: PeerRole) => {
      peerRef.current?.close();
      const peer = createPeer({ role: chosenRole, logger });
      peer.on('state', (s) => setState(s));
      peer.on('message', (m) => setReceived((prev) => [...prev, m]));
      peer.on('ice', (cand) => {
        // Render each candidate as JSON; `null` marks end-of-candidates.
        setLocalIce((prev) => [...prev, cand === null ? '"<end>"' : JSON.stringify(cand)]);
      });
      peer.on('error', (err) => {
        logger.log('error', 'debug-page', { err: String(err) });
      });
      peerRef.current = peer;
      setRole(chosenRole);
      setState(peer.state);
      setLocalSdp('');
      setRemoteSdp('');
      setLocalIce([]);
      setReceived([]);
    },
    [logger],
  );

  // ── Handshake actions ───────────────────────────────────────

  const handleCreateOffer = async (): Promise<void> => {
    const sdp = await peerRef.current!.createOffer();
    setLocalSdp(sdp);
  };

  const handleAcceptOffer = async (): Promise<void> => {
    await peerRef.current!.acceptOffer(remoteSdp);
  };

  const handleCreateAnswer = async (): Promise<void> => {
    const sdp = await peerRef.current!.createAnswer();
    setLocalSdp(sdp);
  };

  const handleAcceptAnswer = async (): Promise<void> => {
    await peerRef.current!.acceptAnswer(remoteSdp);
  };

  const handleAddRemoteIce = async (): Promise<void> => {
    // Accept either one JSON object per line OR a single JSON
    // array — both shapes happen during paste.
    const trimmed = remoteIceText.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Fallback: line-delimited candidates.
      parsed = trimmed
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => JSON.parse(s));
    }
    const arr: RTCIceCandidateInit[] = Array.isArray(parsed)
      ? (parsed as RTCIceCandidateInit[])
      : [parsed as RTCIceCandidateInit];
    for (const c of arr) {
      await peerRef.current!.addIceCandidate(c);
    }
  };

  const handleSend = (): void => {
    if (!peerRef.current) return;
    // Wrap the text in a HELLO so it's a valid NetMessage. Step 12
    // only requires that a HELLO round-trip works on the wire.
    const msg: NetMessage = {
      v: PROTOCOL_VERSION,
      gameId: 'debug',
      senderId: tabSenderId,
      seq: 0,
      t: Date.now(),
      type: 'HELLO',
      profile: { name: outgoingText, color: '#222222' },
    };
    peerRef.current.send(msg);
  };

  // ── Signaling-mode actions (Step 14) ────────────────────────

  const startHostSignaling = useCallback(async (): Promise<void> => {
    setSignalingError(null);
    setSignalingBusy(true);
    try {
      initPeer('host');
      const peer = peerRef.current!;
      const client = createSignalingClient();
      clientRef.current = client;
      const { code } = await client.host();
      setSessionCode(code);
      logger.log('info', 'debug-page', { msg: 'session created', code });
      await connectViaSignaling(peer, client, 'host', logger);
    } catch (err) {
      setSignalingError(String(err));
      logger.log('error', 'debug-page', { msg: 'host signaling failed', err: String(err) });
    } finally {
      setSignalingBusy(false);
    }
  }, [initPeer, logger]);

  const startJoinSignaling = useCallback(async (): Promise<void> => {
    setSignalingError(null);
    setSignalingBusy(true);
    try {
      initPeer('joiner');
      const peer = peerRef.current!;
      const client = createSignalingClient();
      clientRef.current = client;
      const code = joinCode.trim().toUpperCase();
      await client.join(code);
      setSessionCode(code);
      logger.log('info', 'debug-page', { msg: 'session joined', code });
      await connectViaSignaling(peer, client, 'joiner', logger);
    } catch (err) {
      setSignalingError(String(err));
      logger.log('error', 'debug-page', { msg: 'join signaling failed', err: String(err) });
    } finally {
      setSignalingBusy(false);
    }
  }, [initPeer, joinCode, logger]);

  // ── Render ──────────────────────────────────────────────────

  const containerStyle: React.CSSProperties = {
    padding: 16,
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 920,
    margin: '0 auto',
    display: 'grid',
    gap: 12,
  };
  const sectionStyle: React.CSSProperties = {
    border: '1px solid #ccc',
    borderRadius: 8,
    padding: 12,
  };
  const textareaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: 80,
    fontFamily: 'monospace',
    fontSize: 12,
  };

  return (
    <main style={containerStyle}>
      <header>
        <h1 style={{ margin: 0 }}>Peer Debug Harness</h1>
        <p style={{ margin: '4px 0', color: '#555' }}>
          Tab id <code>{tabSenderId}</code> · state{' '}
          <strong style={{ color: state === 'open' ? 'green' : '#333' }}>{state}</strong>
          {role && <> · role <code>{role}</code></>}
        </p>
      </header>

      {!role && (
        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Mode</h2>
          <label style={{ marginRight: 12 }}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'manual'}
              onChange={() => setMode('manual')}
            />{' '}
            Manual SDP paste
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              checked={mode === 'signaling'}
              onChange={() => setMode('signaling')}
            />{' '}
            Real signaling (Step 14)
          </label>
          <h3 style={{ marginBottom: 8 }}>Pick a role</h3>
          {mode === 'manual' ? (
            <>
              <button onClick={() => initPeer('host')} style={{ marginRight: 8 }}>
                Host (creates offer)
              </button>
              <button onClick={() => initPeer('joiner')}>Joiner (waits for offer)</button>
            </>
          ) : (
            <>
              <button
                onClick={() => void startHostSignaling()}
                disabled={signalingBusy}
                style={{ marginRight: 8 }}
              >
                Host (real)
              </button>
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="CODE"
                maxLength={6}
                style={{
                  fontFamily: 'monospace',
                  width: 88,
                  textTransform: 'uppercase',
                  marginRight: 8,
                }}
              />
              <button
                onClick={() => void startJoinSignaling()}
                disabled={signalingBusy || joinCode.trim().length !== 6}
              >
                Join (real)
              </button>
            </>
          )}
          {signalingError && (
            <p style={{ color: 'crimson', marginTop: 8 }}>{signalingError}</p>
          )}
        </section>
      )}

      {role && mode === 'signaling' && (
        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Signaling status</h2>
          <p>
            Code:{' '}
            <strong style={{ fontFamily: 'monospace', fontSize: 18 }}>
              {sessionCode ?? '…'}
            </strong>
            {' · '}role <code>{role}</code>
            {' · '}state <strong>{state}</strong>
          </p>
          {signalingError && <p style={{ color: 'crimson' }}>{signalingError}</p>}
          <p style={{ color: '#555', fontSize: 13 }}>
            Open this page in another tab, switch to “Real signaling”, and{' '}
            {role === 'host' ? 'enter the code above as joiner' : 'click Host'}.
          </p>
        </section>
      )}

      {role === 'host' && mode === 'manual' && (
        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Host handshake</h2>
          <button onClick={handleCreateOffer}>1. Create offer</button>
          <p>Local SDP (copy to joiner):</p>
          <textarea readOnly value={localSdp} style={textareaStyle} />
          <p>Remote answer SDP (paste from joiner):</p>
          <textarea
            value={remoteSdp}
            onChange={(e) => setRemoteSdp(e.target.value)}
            style={textareaStyle}
          />
          <button onClick={handleAcceptAnswer} disabled={!remoteSdp}>
            2. Accept answer
          </button>
        </section>
      )}

      {role === 'joiner' && mode === 'manual' && (
        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Joiner handshake</h2>
          <p>Remote offer SDP (paste from host):</p>
          <textarea
            value={remoteSdp}
            onChange={(e) => setRemoteSdp(e.target.value)}
            style={textareaStyle}
          />
          <button onClick={handleAcceptOffer} disabled={!remoteSdp}>
            1. Accept offer
          </button>
          <button onClick={handleCreateAnswer} style={{ marginLeft: 8 }}>
            2. Create answer
          </button>
          <p>Local answer SDP (copy to host):</p>
          <textarea readOnly value={localSdp} style={textareaStyle} />
        </section>
      )}

      {role && mode === 'manual' && (
        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>ICE candidates</h2>
          <p>Local (copy to remote, one per line):</p>
          <textarea readOnly value={localIce.join('\n')} style={textareaStyle} />
          <p>Remote (paste JSON object, JSON array, or one JSON per line):</p>
          <textarea
            value={remoteIceText}
            onChange={(e) => setRemoteIceText(e.target.value)}
            style={textareaStyle}
          />
          <button onClick={handleAddRemoteIce} disabled={!remoteIceText}>
            Add remote candidate(s)
          </button>
        </section>
      )}

      {role && (
        <section style={sectionStyle}>
          <h2 style={{ marginTop: 0 }}>Send HELLO</h2>
          <input
            value={outgoingText}
            onChange={(e) => setOutgoingText(e.target.value)}
            style={{ width: '70%', fontFamily: 'monospace' }}
          />
          <button onClick={handleSend} disabled={state !== 'open'} style={{ marginLeft: 8 }}>
            Send
          </button>
          <h3>Received messages</h3>
          <pre style={{ maxHeight: 160, overflow: 'auto', background: '#f4f4f4', padding: 8 }}>
            {received.map((m) => JSON.stringify(m)).join('\n') || '(none)'}
          </pre>
        </section>
      )}

      <section style={sectionStyle}>
        <h2 style={{ marginTop: 0 }}>Log</h2>
        <pre style={{ maxHeight: 200, overflow: 'auto', background: '#111', color: '#eee', padding: 8, fontSize: 12 }}>
          {logEntries
            .map((e) => `[${new Date(e.ts).toISOString().slice(11, 23)}] ${e.level} ${e.tag} ${
              e.data !== undefined ? JSON.stringify(e.data) : ''
            }`)
            .join('\n') || '(empty)'}
        </pre>
      </section>
    </main>
  );
}
