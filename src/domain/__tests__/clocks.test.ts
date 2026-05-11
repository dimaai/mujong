// ============================================================
// src/domain/__tests__/clocks.test.ts
//
// PURPOSE
//   Step 21 unit tests for the pure `tickClock` helper.
//   Covers four cases:
//     1. Disabled timer (`clocks === null`) is a no-op.
//     2. First tick after game start only stamps `lastTickAt`.
//     3. Subsequent tick charges only the current player.
//     4. Flag-fall flips `phase` to 'finished' with opponent as winner.
//
//   No React, no Zustand, no DOM. Pure deterministic input/output.
// ============================================================

import { describe, expect, it } from 'vitest';

import { tickClock } from '../board';
import type { GameState, Level, Player } from '../types';

// ── Fixtures ──────────────────────────────────────────────────

const LEVEL: Level = {
  levelId: 'lvl_test',
  levelNumber: 0,
  levelName: 'Test',
  boardWidth: 4,
  boardHeight: 4,
  allowedFigures: [],
  player1Color: '#000',
  player2Color: '#fff',
  timerMinutes: 1,
};

const P1: Player = { id: 'p1', name: 'P1', rating: 1000 };
const P2: Player = { id: 'p2', name: 'P2', rating: 1000 };

/** Build a minimal GameState with optional overrides. */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    gameId: 'g1',
    level: LEVEL,
    players: [P1, P2],
    currentPlayerIndex: 0,
    figures: [],
    phase: 'playing',
    winnerId: null,
    turnNumber: 1,
    history: [],
    positionHashes: [],
    drawOfferFrom: null,
    drawReason: null,
    clocks: {
      p1RemainingMs: 60_000,
      p2RemainingMs: 60_000,
      lastTickAt: null,
    },
    againstView: false,
    walls: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('tickClock', () => {
  it('returns the same state when clocks are disabled', () => {
    const s = makeState({ clocks: null });
    const r = tickClock(s, 1_000);
    expect(r).toBe(s);
  });

  it('only stamps lastTickAt on the first tick (no charge yet)', () => {
    const s = makeState();
    const r = tickClock(s, 5_000);
    expect(r.clocks!.lastTickAt).toBe(5_000);
    expect(r.clocks!.p1RemainingMs).toBe(60_000);
    expect(r.clocks!.p2RemainingMs).toBe(60_000);
    expect(r.phase).toBe('playing');
  });

  it('charges the current player on subsequent ticks', () => {
    const s = makeState({
      currentPlayerIndex: 0,
      clocks: { p1RemainingMs: 60_000, p2RemainingMs: 60_000, lastTickAt: 1_000 },
    });
    const r = tickClock(s, 11_000); // 10 s elapsed
    expect(r.clocks!.p1RemainingMs).toBe(50_000);
    expect(r.clocks!.p2RemainingMs).toBe(60_000);
    expect(r.clocks!.lastTickAt).toBe(11_000);
    expect(r.phase).toBe('playing');
  });

  it('charges player 2 when it is their turn', () => {
    const s = makeState({
      currentPlayerIndex: 1,
      clocks: { p1RemainingMs: 30_000, p2RemainingMs: 30_000, lastTickAt: 0 },
    });
    const r = tickClock(s, 5_000);
    expect(r.clocks!.p1RemainingMs).toBe(30_000);
    expect(r.clocks!.p2RemainingMs).toBe(25_000);
  });

  it('flag-fall: opponent wins when remaining hits zero', () => {
    const s = makeState({
      currentPlayerIndex: 0,
      clocks: { p1RemainingMs: 1_000, p2RemainingMs: 30_000, lastTickAt: 0 },
    });
    const r = tickClock(s, 2_000); // 2 s elapsed, only 1 s remained
    expect(r.clocks!.p1RemainingMs).toBe(0);
    expect(r.phase).toBe('finished');
    expect(r.winnerId).toBe('p2');
  });

  it('pauses while a draw offer is pending', () => {
    const s = makeState({
      drawOfferFrom: 'p1',
      clocks: { p1RemainingMs: 60_000, p2RemainingMs: 60_000, lastTickAt: 1_000 },
    });
    const r = tickClock(s, 10_000);
    expect(r).toBe(s);
  });

  it('clamps negative deltas (clock skew) to zero', () => {
    const s = makeState({
      clocks: { p1RemainingMs: 60_000, p2RemainingMs: 60_000, lastTickAt: 10_000 },
    });
    const r = tickClock(s, 5_000); // now < lastTickAt
    // No-op fast path: delta clamps to 0 → same state reference.
    expect(r).toBe(s);
  });
});
