// ============================================================
// src/components/Network/ReconnectOverlay.tsx
//
// PURPOSE
//   Mid-game disconnect UX (Step 19). When the underlying
//   DataChannel reports closed/failed, this overlay covers the
//   board and gives the local player three options:
//
//     1. Wait — Channel might recover (rare without a real
//                reconnect path; v1 has none, so this is just a
//                grace window before the user decides).
//     2. Claim Win — Enabled after a 60 s countdown. Calls
//                netStore.claimWin() which marks the local
//                player as winner and sends BYE { timeout }.
//     3. Resign — Always enabled. Local player loses; sends
//                BYE { forfeit }.
//
//   The component is purely presentational. It does NOT decide
//   whether to mount — that's the GameCanvas's job, driven by
//   `useNetStore(s => s.connectionLost)`.
//
//   INPUTS
//     `lostAt`    - ms-since-epoch when the channel went down.
//     `onClaim`   - called when the user clicks Claim Win.
//     `onResign`  - called when the user clicks Resign.
//
//   OUTPUTS
//     Fires the two callbacks. Owns no state beyond a 1 s clock
//     tick so the countdown re-renders.
//
//   SIDE EFFECTS
//     One `setInterval` while mounted; cleared on unmount.
// ============================================================

'use client';

import React, { useEffect, useState } from 'react';

const GRACE_MS = 60_000;

interface ReconnectOverlayProps {
  lostAt: number;
  onClaim: () => void;
  onResign: () => void;
}

export function ReconnectOverlay({ lostAt, onClaim, onResign }: ReconnectOverlayProps) {
  // Tick once per second so the countdown re-renders. We don't
  // use `setTimeout(GRACE_MS)` because we also want to show the
  // remaining seconds during the wait.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - lostAt;
  const remaining = Math.max(0, GRACE_MS - elapsed);
  const secondsLeft = Math.ceil(remaining / 1000);
  const canClaim = remaining <= 0;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.78)',
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
        textAlign: 'center',
        gap: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reconnect-title"
    >
      <h2 id="reconnect-title" style={{ margin: 0, fontSize: 22 }}>
        Connection lost
      </h2>
      <p style={{ margin: 0, maxWidth: 340, lineHeight: 1.4 }}>
        {canClaim
          ? "Your opponent hasn't come back."
          : `Waiting for your opponent to reconnect… ${secondsLeft}s`}
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          onClick={onClaim}
          disabled={!canClaim}
          style={{
            padding: '10px 18px',
            fontSize: 16,
            background: canClaim ? '#2e7d32' : '#444',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: canClaim ? 'pointer' : 'not-allowed',
            minWidth: 130,
          }}
        >
          Claim win
        </button>
        <button
          onClick={onResign}
          style={{
            padding: '10px 18px',
            fontSize: 16,
            background: '#b71c1c',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            minWidth: 130,
          }}
        >
          Resign
        </button>
      </div>
    </div>
  );
}
