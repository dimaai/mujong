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
  const host = useNetStore((s: NetState) => s.host);
  const join = useNetStore((s: NetState) => s.join);
  const leave = useNetStore((s: NetState) => s.leave);

  // Profiles for our HELLO. We use `player1` as the "self" profile
  // because there's only one device per side in network mode —
  // there is no second local seat. (The settings flow that picks
  // which slot represents the local player will land with the game
  // wiring; for the lobby Player 1 is a sensible default.)
  const selfProfile = useProfileStore((s) => s.player1);

  const [joinInput, setJoinInput] = useState('');

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

  // Error state: explicit, with a "Try again" path.
  if (status === 'error') {
    return (
      <main className={styles.wrapper}>
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
      </main>
    );
  }

  // Connected state: both player cards + disabled Start.
  if (status === 'connected' && peerProfile) {
    // Render in a stable left-to-right order: this client first.
    const leftLabel = role === 'host' ? 'You (Host)' : 'You (Joiner)';
    const rightLabel = role === 'host' ? 'Joiner' : 'Host';
    return (
      <main className={styles.wrapper}>
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
      </main>
    );
  }

  // Hosting state: show the code prominently.
  if (status === 'hosting' && code) {
    return (
      <main className={styles.wrapper}>
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
      </main>
    );
  }

  // Joining / connecting state: spinner only.
  if (status === 'joining' || status === 'connecting') {
    return (
      <main className={styles.wrapper}>
        <div className={styles.card}>
          <h1 className={styles.title}>Connecting</h1>
          {code && <p className={styles.subtitle}>Session {code}</p>}
          <div className={styles.spinnerRow}>
            <span className={styles.spinner} aria-hidden />
            <span>
              {status === 'joining' ? 'Joining…' : 'Connecting…'}
            </span>
          </div>
          <div className={styles.actionsRow}>
            <button className={styles.button} onClick={handleBack}>
              Cancel
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Default (idle): pick host or join.
  const joinValid = normaliseNetCode(joinInput) !== null;
  return (
    <main className={styles.wrapper}>
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
            // Tooltip helps explain why the button is disabled
            // before the user has typed all 6 chars.
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
