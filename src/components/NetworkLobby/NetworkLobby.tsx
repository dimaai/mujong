// ============================================================
// src/components/NetworkLobby/NetworkLobby.tsx
//
// PURPOSE
//   The /network route's only screen. Three modes share one card:
//
//     1. PICK    — show "Create" or "Join" buttons + code input.
//     2. WAITING — host: code in big type with copy button.
//     3. RESULT  — both peers shown side-by-side, disabled
//                  "Start Game" button (next slice wires it).
//
//   All connection logic lives in `useNetStore`. This file is
//   pure presentation + glue: it reads `status`/`code`/etc. and
//   calls `host()` / `join()` / `leave()`.
//
// CLEANUP
//   `useEffect` cleanup calls `leave()` so leaving the route
//   never leaks an `RTCPeerConnection`.
// ============================================================

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  NET_CODE_REGEX,
  normaliseNetCode,
  useNetStore,
  type NetState,
} from '../../store/netStore';
import { useProfileStore } from '../../store/profileStore';
import type { LogEntry } from '../../net/log';

import styles from './NetworkLobby.module.css';

/**
 * NetworkLobby — root component for the /network route.
 *
 * Inputs : none (state from `useNetStore`).
 * Outputs: rendered lobby card.
 * Side fx: kicks off `host()` / `join()` on user action; calls
 *          `leave()` on unmount.
 */
export function NetworkLobby(): React.ReactElement {
  const router = useRouter();
  const status = useNetStore((s: NetState) => s.status);
  const code = useNetStore((s: NetState) => s.code);
  const role = useNetStore((s: NetState) => s.role);
  const peerProfile = useNetStore((s: NetState) => s.peerProfile);
  const error = useNetStore((s: NetState) => s.error);
  const logs = useNetStore((s: NetState) => s.logs);
  const host = useNetStore((s: NetState) => s.host);
  const join = useNetStore((s: NetState) => s.join);
  const leave = useNetStore((s: NetState) => s.leave);

  const selfProfile = useProfileStore((s) => s.player1);

  const [joinInput, setJoinInput] = useState('');
  const [showDebug, setShowDebug] = useState(false);

  // Tear down on unmount or route change.
  useEffect(() => {
    return () => {
      leave();
    };
  }, [leave]);

  const isBusy =
    status === 'hosting' ||
    status === 'joining' ||
    status === 'connecting';

  // ── Handlers ───────────────────────────────────────────────

  function handleHost(): void {
    void host(selfProfile);
  }

  function handleJoin(): void {
    void join(joinInput, selfProfile);
  }

  function handleCopy(): void {
    if (!code) return;
    void navigator.clipboard?.writeText(code);
  }

  function handleBack(): void {
    leave();
    router.push('/');
  }

  function handleTryAgain(): void {
    leave();
    setJoinInput('');
  }

  // ── Render branches ────────────────────────────────────────

  // Each branch returns the card. The shared wrapper at the end
  // mounts the debug panel below it so a tester can see logs on
  // any branch without us repeating the markup five times.
  let card: React.ReactElement;

  // Error state: explicit, with a "Try again" path.
  if (status === 'error') {
    card = (
      <div className={styles.card}>
        <h1 className={styles.title}>Network Game</h1>
        <p className={styles.error}>{error ?? 'Unknown error.'}</p>
        <div className={styles.actionsRow}>
          <button className={styles.button} onClick={handleBack}>
            Back to menu
          </button>
          <button
            className={`${styles.button} ${styles.primary}`}
            onClick={handleTryAgain}
          >
            Try again
          </button>
        </div>
      </div>
    );
  } else if (status === 'connected' && peerProfile) {
    // Connected state: both player cards + disabled Start.
    const leftLabel = role === 'host' ? 'You (Host)' : 'You (Joiner)';
    const rightLabel = role === 'host' ? 'Joiner' : 'Host';
    card = (
      <div className={styles.card}>
        <h1 className={styles.title}>Connected</h1>
        {code && <p className={styles.subtitle}>Session {code}</p>}
        <div className={styles.players}>
          <PlayerCard label={leftLabel} profile={selfProfile} />
          <span className={styles.vs}>vs</span>
          <PlayerCard label={rightLabel} profile={peerProfile} />
        </div>
        <button
          className={`${styles.button} ${styles.primary}`}
          disabled
          title="Wired in the next step"
        >
          Start Game
        </button>
        <div className={styles.actionsRow}>
          <button className={styles.button} onClick={handleBack}>
            Leave
          </button>
        </div>
      </div>
    );
  } else if (status === 'hosting' && code) {
    // Hosting state: show the code prominently.
    card = (
      <div className={styles.card}>
        <h1 className={styles.title}>Share this code</h1>
        <p className={styles.codeBig}>{code}</p>
        <div className={styles.actionsRow}>
          <button className={styles.button} onClick={handleCopy}>
            Copy code
          </button>
          <button className={styles.button} onClick={handleBack}>
            Cancel
          </button>
        </div>
        <div className={styles.spinnerRow}>
          <span className={styles.spinner} aria-hidden />
          <span>Waiting for opponent…</span>
        </div>
      </div>
    );
  } else if (status === 'joining' || status === 'connecting') {
    // Joining / connecting state: spinner only.
    card = (
      <div className={styles.card}>
        <h1 className={styles.title}>Connecting</h1>
        {code && <p className={styles.subtitle}>Session {code}</p>}
        <div className={styles.spinnerRow}>
          <span className={styles.spinner} aria-hidden />
          <span>{status === 'joining' ? 'Joining…' : 'Connecting…'}</span>
        </div>
        <div className={styles.actionsRow}>
          <button className={styles.button} onClick={handleBack}>
            Cancel
          </button>
        </div>
      </div>
    );
  } else {
    // Default (idle): pick host or join.
    const joinValid = normaliseNetCode(joinInput) !== null;
    card = (
      <div className={styles.card}>
        <h1 className={styles.title}>Network Game</h1>
        <p className={styles.subtitle}>
          Create a code to share, or enter one from a friend.
        </p>
        <button
          className={`${styles.button} ${styles.primary}`}
          onClick={handleHost}
          disabled={isBusy}
        >
          Create session
        </button>
        <div className={styles.codeRow}>
          <input
            className={styles.codeInput}
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={6}
            inputMode="text"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Session code"
          />
          <button
            className={styles.button}
            onClick={handleJoin}
            disabled={isBusy || !joinValid}
            title={
              joinValid
                ? 'Join this session'
                : `Enter a 6-char code (allowed: ${NET_CODE_REGEX.source})`
            }
          >
            Join
          </button>
        </div>
        <div className={styles.actionsRow}>
          <button className={styles.button} onClick={handleBack}>
            Back to menu
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className={styles.wrapper}>
      {card}
      <DebugPanel
        logs={logs}
        open={showDebug}
        onToggle={() => setShowDebug((v) => !v)}
      />
    </main>
  );
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * One player's card. Tiny presentational helper kept private to
 * the lobby; if it's ever wanted elsewhere we can promote it.
 */
function PlayerCard({
  label,
  profile,
}: {
  label: string;
  profile: { name: string; color: string };
}): React.ReactElement {
  return (
    <div className={styles.player}>
      <div className={styles.swatch} style={{ background: profile.color }} />
      <div className={styles.playerName}>{profile.name}</div>
      <div className={styles.playerLabel}>{label}</div>
    </div>
  );
}

/**
 * Collapsible on-screen mirror of the net-layer ring buffer.
 * Useful on mobile installs where DevTools is out of reach.
 *
 * Inputs : `logs` array (already capped by the ring buffer),
 *          `open` toggle state, `onToggle` callback.
 * Outputs: a button + (when open) a scrollable monospace panel.
 */
function DebugPanel({
  logs,
  open,
  onToggle,
}: {
  logs: LogEntry[];
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <div style={{ width: '100%', maxWidth: 420 }}>
      <button className={styles.debugToggle} onClick={onToggle}>
        {open ? 'Hide debug log' : `Show debug log (${logs.length})`}
      </button>
      {open && (
        <div className={styles.debugPanel} role="log" aria-live="polite">
          {logs.length === 0 ? (
            <div className={styles.debugRow}>(no log entries yet)</div>
          ) : (
            logs.map((e, i) => {
              const levelClass =
                e.level === 'error'
                  ? styles.debugLevelError
                  : e.level === 'warn'
                    ? styles.debugLevelWarn
                    : e.level === 'info'
                      ? styles.debugLevelInfo
                      : styles.debugLevelDebug;
              const time = new Date(e.ts).toLocaleTimeString();
              const data =
                e.data === undefined ? '' : ' ' + safeStringify(e.data);
              return (
                <div key={i} className={`${styles.debugRow} ${levelClass}`}>
                  {time} [{e.tag}] {data}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/**
 * JSON.stringify but tolerant of cyclic refs and BigInts. We do
 * not control what `data` shapes the net layer logs, so this
 * keeps the overlay from crashing on edge cases.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
