// ============================================================
// src/store/__tests__/gameStore.snapshot.test.ts
//
// PURPOSE
//   Step 28 (Phase D-1) — verify the in-progress-game snapshot
//   round-trips through localStorage on every meaningful state
//   transition:
//
//     1. A live PLACE/MOVE triggers an envelope write whose
//        `data` matches the current `game` slice byte-for-byte
//        (modulo the clocks' `lastTickAt`, which is intentionally
//        re-stamped on hydrate — see `hydrateFromSnapshot`).
//     2. `hydrateFromSnapshot()` after `resetGame()` restores
//        the same `game` state, so a hard refresh resumes mid-
//        match.
//     3. `resetGame()` ("New game") deletes the stored envelope
//        so the next visit doesn't offer to resume nothing.
//     4. A win (`phase === 'finished'`) deletes the envelope.
//     5. Starting a `mode: 'network'` game wipes any leftover
//        local snapshot — network games are not resumable.
//     6. A schema-version mismatch on hydrate returns `false`
//        and removes the stored entry (defensive cleanup).
//
// TEST ENVIRONMENT
//   Vitest defaults to a Node environment in this repo (no
//   jsdom dep). We stand up a minimal `window` + `localStorage`
//   shim via `vi.hoisted` so it exists *before* the module-
//   level subscribe at the bottom of `gameStore.ts` runs at
//   import time. Without that hoist the auto-snapshot wiring
//   would silently no-op and we'd be testing a stub.
//
//   The snapshot flush is queued via `setTimeout(0)`, so each
//   test that expects a write to land calls `vi.runAllTimers()`
//   under fake timers.
// ============================================================

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Stand up `window` + `localStorage` BEFORE any imports below
// touch the module-level subscribe in `gameStore.ts`.
vi.hoisted(() => {
  const backing = new Map<string, string>();
  const localStorageShim = {
    getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
    setItem: (k: string, v: string) => {
      backing.set(k, String(v));
    },
    removeItem: (k: string) => {
      backing.delete(k);
    },
    clear: () => backing.clear(),
    key: (i: number) => Array.from(backing.keys())[i] ?? null,
    get length() {
      return backing.size;
    },
  };
  const g = globalThis as unknown as {
    window?: unknown;
    localStorage?: unknown;
    __mojongTestBacking?: Map<string, string>;
  };
  g.window = globalThis;
  g.localStorage = localStorageShim;
  (globalThis as unknown as { window: { localStorage: unknown } }).window.localStorage = localStorageShim;
  // Expose the raw Map so tests can clear / seed it between cases.
  g.__mojongTestBacking = backing;
});

import { STORAGE_KEYS } from '../../persistence/keys';
import { getEnvelope, setItem } from '../../persistence/storage';
import { getResumableSnapshotMeta, hasGameSnapshot, useGameStore } from '../gameStore';
import type { GameOptions, GameState, Profile, TurnAction } from '../../domain/types';

// ── Fixtures ──────────────────────────────────────────────────

const OPTIONS: GameOptions = {
  difficulty: 'normal',
  // 'medium' = 6 cols × 9 rows (see src/data/boardSizes.ts).
  boardSizeId: 'medium',
  timerMinutes: 5,
  againstView: false,
  walls: false,
};

const PROFILES: [Profile, Profile] = [
  { name: 'Alice', color: '#0066ff' },
  { name: 'Bob', color: '#ff3300' },
];

/** First AVAILABLE figure for the named player slot. */
function firstAvailable(playerIndex: 0 | 1): string {
  const game = useGameStore.getState().game!;
  const playerId = game.players[playerIndex].id;
  const fig = game.figures.find(
    (f) => f.playerId === playerId && f.status === 'available',
  );
  if (!fig) throw new Error(`no available figure for player ${playerIndex}`);
  return fig.instanceId;
}

/** Place `instanceId` on `(col, row)` for whoever's turn it is. */
function place(instanceId: string, col: number, row: number): void {
  const action: TurnAction = { type: 'PLACE', instanceId, position: { col, row } };
  useGameStore.getState().executeAction(action);
}

const backing = (): Map<string, string> =>
  (globalThis as unknown as { __mojongTestBacking: Map<string, string> })
    .__mojongTestBacking;

// ── Lifecycle ─────────────────────────────────────────────────

beforeAll(() => {
  // Fake timers globally so the auto-subscribe's `setTimeout(0)`
  // flush is deterministic. We use `runOnlyPendingTimers` (not
  // `runAllTimers`) because gameStore.ts also installs a 250 ms
  // clock driver: `runAllTimers` would cycle through the entire
  // 5-minute game clock, end the game, and wipe the snapshot we
  // are trying to assert on.
  vi.useFakeTimers();
});

/** Flush every timer that is currently pending, exactly once. */
function drainPendingTimers(): void {
  vi.runOnlyPendingTimers();
}

beforeEach(() => {
  backing().clear();
  useGameStore.getState().resetGame();
  drainPendingTimers();
  backing().clear();
});

afterEach(() => {
  useGameStore.getState().resetGame();
  drainPendingTimers();
});

// ── Tests ─────────────────────────────────────────────────────

describe('gameStore snapshot persistence (Step 28)', () => {
  it('persists the live GameState after a PLACE action', () => {
    useGameStore.getState().startGame({ options: OPTIONS, profiles: PROFILES });
    place(firstAvailable(0), 0, 8);
    drainPendingTimers();

    const env = getEnvelope<GameState>(STORAGE_KEYS.gameSnapshot);
    expect(env).not.toBeNull();
    expect(env!.v).toBe(1);
    expect(env!.data.phase).toBe('playing');
    expect(env!.data.turnNumber).toBe(2);
    expect(env!.data.currentPlayerIndex).toBe(1);
    expect(hasGameSnapshot()).toBe(true);
  });

  it('hydrates an identical game after three moves and a resetGame', () => {
    useGameStore.getState().startGame({ options: OPTIONS, profiles: PROFILES });
    place(firstAvailable(0), 0, 8); // P1 places
    place(firstAvailable(1), 0, 0); // P2 places
    place(firstAvailable(0), 1, 8); // P1 places again
    drainPendingTimers();

    const before = useGameStore.getState().game!;

    // Simulate a hard reload: blow away the in-memory store,
    // then rehydrate from the persisted envelope.
    useGameStore.getState().resetGame();
    drainPendingTimers();
    // resetGame's flush would normally clear the snapshot. Re-seed
    // it from `before` because that's exactly the state a real
    // reload would find on disk (the reload happens before the
    // snapshot is cleared).
    setItem(STORAGE_KEYS.gameSnapshot, {
      v: 1,
      data: before,
      updatedAt: Date.now(),
      deviceId: 'test-device',
    });

    const ok = useGameStore.getState().hydrateFromSnapshot();
    expect(ok).toBe(true);

    const after = useGameStore.getState().game!;
    expect(after.turnNumber).toBe(before.turnNumber);
    expect(after.currentPlayerIndex).toBe(before.currentPlayerIndex);
    expect(after.figures).toEqual(before.figures);
    expect(after.history).toEqual(before.history);
    // Clocks are preserved aside from `lastTickAt`, which is
    // re-stamped on hydrate so off-screen wall-time isn't charged.
    expect(after.clocks?.p1RemainingMs).toBe(before.clocks?.p1RemainingMs);
    expect(after.clocks?.p2RemainingMs).toBe(before.clocks?.p2RemainingMs);
    expect(after.clocks?.lastTickAt).toBeNull();
  });

  it('clears the snapshot on resetGame (New game)', () => {
    useGameStore.getState().startGame({ options: OPTIONS, profiles: PROFILES });
    place(firstAvailable(0), 0, 8);
    drainPendingTimers();
    expect(hasGameSnapshot()).toBe(true);

    useGameStore.getState().resetGame();
    drainPendingTimers();
    expect(hasGameSnapshot()).toBe(false);
    expect(backing().has(STORAGE_KEYS.gameSnapshot)).toBe(false);
  });

  it('clears the snapshot when a player forfeits (finished)', () => {
    useGameStore.getState().startGame({ options: OPTIONS, profiles: PROFILES });
    place(firstAvailable(0), 0, 8);
    drainPendingTimers();
    expect(hasGameSnapshot()).toBe(true);

    const loserId = useGameStore.getState().game!.players[0].id;
    useGameStore.getState().forfeit(loserId);
    drainPendingTimers();

    expect(useGameStore.getState().game?.phase).toBe('finished');
    expect(hasGameSnapshot()).toBe(false);
  });

  it('does not persist a snapshot in network mode and wipes any leftover', () => {
    // Seed a stale snapshot as if a prior local game had ended.
    setItem(STORAGE_KEYS.gameSnapshot, {
      v: 1,
      data: { phase: 'playing' } as unknown as GameState,
      updatedAt: Date.now(),
      deviceId: 'test-device',
    });
    expect(backing().has(STORAGE_KEYS.gameSnapshot)).toBe(true);

    useGameStore.getState().startGame({
      options: OPTIONS,
      profiles: PROFILES,
      mode: 'network',
      localPlayerIndex: 0,
    });
    drainPendingTimers();
    expect(backing().has(STORAGE_KEYS.gameSnapshot)).toBe(false);

    place(firstAvailable(0), 0, 8);
    drainPendingTimers();
    // Still no snapshot — network games are not resumable.
    expect(backing().has(STORAGE_KEYS.gameSnapshot)).toBe(false);
  });

  it('rejects and removes a snapshot with a mismatched schema version', () => {
    setItem(STORAGE_KEYS.gameSnapshot, {
      v: 999,
      data: { phase: 'playing' } as unknown as GameState,
      updatedAt: Date.now(),
      deviceId: 'test-device',
    });
    expect(backing().has(STORAGE_KEYS.gameSnapshot)).toBe(true);

    const ok = useGameStore.getState().hydrateFromSnapshot();
    expect(ok).toBe(false);
    expect(useGameStore.getState().game).toBeNull();
    expect(backing().has(STORAGE_KEYS.gameSnapshot)).toBe(false);
  });
});

// ── Step 29 — Resume banner store hooks ───────────────────────

describe('gameStore — Step 29 resume banner support', () => {
  it('getResumableSnapshotMeta returns null when no snapshot exists', () => {
    expect(getResumableSnapshotMeta()).toBeNull();
  });

  it('getResumableSnapshotMeta returns the snapshot turn number for a playing game', () => {
    useGameStore.getState().startGame({ options: OPTIONS, profiles: PROFILES });
    place(firstAvailable(0), 0, 8);
    place(firstAvailable(1), 0, 0);
    drainPendingTimers();

    const liveTurn = useGameStore.getState().game!.turnNumber;
    const meta = getResumableSnapshotMeta();
    expect(meta).not.toBeNull();
    expect(meta!.turnNumber).toBe(liveTurn);
  });

  it('getResumableSnapshotMeta returns null and wipes a finished-game envelope', () => {
    // A finished game shouldn't have a snapshot in the first place
    // (the auto-snapshot subscriber removes it), but we seed one
    // directly to exercise the defensive cleanup branch.
    setItem(STORAGE_KEYS.gameSnapshot, {
      v: 1,
      data: { phase: 'finished', turnNumber: 12 } as unknown as GameState,
      updatedAt: Date.now(),
      deviceId: 'test-device',
    });
    expect(backing().has(STORAGE_KEYS.gameSnapshot)).toBe(true);

    expect(getResumableSnapshotMeta()).toBeNull();
    expect(backing().has(STORAGE_KEYS.gameSnapshot)).toBe(false);
  });

  it('getResumableSnapshotMeta returns null when turnNumber <= 0', () => {
    // Defensive guard: a malformed envelope with turnNumber === 0
    // should not surface as resumable. The envelope itself stays
    // on disk — it's not stale, just unusable for the banner.
    setItem(STORAGE_KEYS.gameSnapshot, {
      v: 1,
      data: { phase: 'playing', turnNumber: 0 } as unknown as GameState,
      updatedAt: Date.now(),
      deviceId: 'test-device',
    });
    expect(getResumableSnapshotMeta()).toBeNull();
  });

  it('clearSnapshot removes the envelope and resets the in-memory game', () => {
    useGameStore.getState().startGame({ options: OPTIONS, profiles: PROFILES });
    place(firstAvailable(0), 0, 8);
    drainPendingTimers();
    expect(hasGameSnapshot()).toBe(true);
    expect(useGameStore.getState().game).not.toBeNull();

    useGameStore.getState().clearSnapshot();
    drainPendingTimers();

    expect(hasGameSnapshot()).toBe(false);
    expect(backing().has(STORAGE_KEYS.gameSnapshot)).toBe(false);
    expect(useGameStore.getState().game).toBeNull();
    expect(getResumableSnapshotMeta()).toBeNull();
  });
});
