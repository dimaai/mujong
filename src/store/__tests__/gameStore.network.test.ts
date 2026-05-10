// ============================================================
// src/store/__tests__/gameStore.network.test.ts
//
// PURPOSE
//   Step 17 unit tests for the network-mode entry points on
//   `useGameStore`. The reducer body is already covered by the
//   local-play tests; here we only exercise the new gates:
//
//     1. A local move in network mode appends to `actionLog`
//        AND fires the registered broadcaster with the same
//        entry (this is what the netStore ships over the wire).
//     2. `applyRemoteAction` applies opponent moves through the
//        same reducer path; the broadcaster is NOT re-invoked
//        for remote-source moves.
//     3. A local move during the opponent's turn is a no-op.
//     4. A remote action with a stale `turnNumber` is rejected.
//
//   We use a single `useGameStore` instance and drive it from
//   both sides — full two-store convergence belongs to Step 20's
//   integration test, which can simulate gaps + resync.
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setActionBroadcaster,
  useGameStore,
  type ActionLogEntry,
} from '../gameStore';
import type { GameOptions, Profile, TurnAction } from '../../domain/types';

// ── Fixtures ──────────────────────────────────────────────────

const OPTIONS: GameOptions = {
  difficulty: 'normal',
  // 'medium' = 6 cols × 9 rows in src/data/boardSizes.ts.
  boardSizeId: 'medium',
  timerMinutes: 5,
  againstView: false,
  walls: false,
};

const PROFILES: [Profile, Profile] = [
  { name: 'Local', color: '#0066ff' },
  { name: 'Remote', color: '#ff3300' },
];

/** Convenience: pick the first AVAILABLE figure for a player. */
function firstAvailable(playerId: string): string {
  const fig = useGameStore
    .getState()
    .game!.figures.find(
      (f) => f.playerId === playerId && f.status === 'available',
    );
  if (!fig) throw new Error(`no available figure for ${playerId}`);
  return fig.instanceId;
}

// ── Lifecycle ─────────────────────────────────────────────────

let broadcasts: ActionLogEntry[] = [];

beforeEach(() => {
  broadcasts = [];
  setActionBroadcaster((entry) => {
    broadcasts.push(entry);
  });
  useGameStore.getState().startGame({
    options: OPTIONS,
    profiles: PROFILES,
    seed: 'test-seed',
    mode: 'network',
    localPlayerIndex: 0,
  });
});

afterEach(() => {
  setActionBroadcaster(null);
  useGameStore.getState().resetGame();
});

// ── Tests ─────────────────────────────────────────────────────

describe('gameStore network mode (Step 17)', () => {
  it('initialises with the right network fields', () => {
    const s = useGameStore.getState();
    expect(s.mode).toBe('network');
    expect(s.localPlayerIndex).toBe(0);
    expect(s.actionLog).toEqual([]);
    expect(s.game?.currentPlayerIndex).toBe(0);
  });

  it('local PLACE appends to actionLog AND broadcasts', () => {
    const localFig = firstAvailable('p1');
    const action: TurnAction = {
      type: 'PLACE',
      instanceId: localFig,
      // Player 0 places on the bottom row (boardHeight - 1 = 8).
      position: { col: 0, row: 8 },
    };
    useGameStore.getState().executeAction(action);

    const s = useGameStore.getState();
    expect(s.actionLog).toHaveLength(1);
    expect(s.actionLog[0]).toMatchObject({
      seq: 0,
      turnNumber: 1,
      action,
    });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toEqual(s.actionLog[0]);
    // Turn advanced to the opponent.
    expect(s.game?.currentPlayerIndex).toBe(1);
    expect(s.game?.turnNumber).toBe(2);
  });

  it('applyRemoteAction applies the opponent move without re-broadcasting', () => {
    // Local plays first to flip the turn to the opponent.
    const localFig = firstAvailable('p1');
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: localFig,
      position: { col: 0, row: 8 },
    });
    expect(broadcasts).toHaveLength(1);

    const remoteFig = firstAvailable('p2');
    const remoteAction: TurnAction = {
      type: 'PLACE',
      instanceId: remoteFig,
      // Player 1 places on the top row (row 0).
      position: { col: 0, row: 0 },
    };
    const ok = useGameStore.getState().applyRemoteAction({
      action: remoteAction,
      turnNumber: 2,
    });

    expect(ok).toBe(true);
    const s = useGameStore.getState();
    expect(s.actionLog).toHaveLength(2);
    expect(s.actionLog[1]).toMatchObject({
      seq: 1,
      turnNumber: 2,
      action: remoteAction,
    });
    // Crucially: applying a remote move must NOT bounce back over
    // the wire — the broadcasts list is unchanged.
    expect(broadcasts).toHaveLength(1);
    expect(s.game?.currentPlayerIndex).toBe(0);
    expect(s.game?.turnNumber).toBe(3);
  });

  it('drops local moves during the opponent\u2019s turn', () => {
    // Burn the first turn so it is now the opponent's move.
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p1'),
      position: { col: 0, row: 8 },
    });
    broadcasts.length = 0;

    const before = useGameStore.getState().game!;
    // Try to sneak in a second local move — illegal because it is
    // now player 1's turn and the local player is index 0.
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p1'),
      position: { col: 1, row: 8 },
    });

    const after = useGameStore.getState().game!;
    expect(after.turnNumber).toBe(before.turnNumber);
    expect(after.figures).toEqual(before.figures);
    expect(broadcasts).toHaveLength(0);
  });

  it('rejects remote actions with a stale turnNumber', () => {
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p1'),
      position: { col: 0, row: 8 },
    });
    // Current turn is now 2; pretend the peer claims turn 1.
    const ok = useGameStore.getState().applyRemoteAction({
      action: {
        type: 'PLACE',
        instanceId: firstAvailable('p2'),
        position: { col: 0, row: 0 },
      },
      turnNumber: 1,
    });
    expect(ok).toBe(false);
    const s = useGameStore.getState();
    expect(s.actionLog).toHaveLength(1);
    expect(s.game?.currentPlayerIndex).toBe(1);
  });

  it('runs four moves in lockstep without losing the turn cursor', () => {
    const swallow = vi.fn();
    setActionBroadcaster(swallow);

    // Move 1: local PLACE.
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p1'),
      position: { col: 0, row: 8 },
    });
    // Move 2: remote PLACE (opponent).
    useGameStore.getState().applyRemoteAction({
      action: {
        type: 'PLACE',
        instanceId: firstAvailable('p2'),
        position: { col: 0, row: 0 },
      },
      turnNumber: 2,
    });
    // Move 3: local PLACE again.
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p1'),
      position: { col: 1, row: 8 },
    });
    // Move 4: remote PLACE again.
    useGameStore.getState().applyRemoteAction({
      action: {
        type: 'PLACE',
        instanceId: firstAvailable('p2'),
        position: { col: 1, row: 0 },
      },
      turnNumber: 4,
    });

    const s = useGameStore.getState();
    expect(s.actionLog).toHaveLength(4);
    expect(s.actionLog.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    expect(s.actionLog.map((e) => e.turnNumber)).toEqual([1, 2, 3, 4]);
    expect(s.game?.turnNumber).toBe(5);
    expect(s.game?.currentPlayerIndex).toBe(0);
    // Only the two local moves should have been broadcast.
    expect(swallow).toHaveBeenCalledTimes(2);
  });
});
