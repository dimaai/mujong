// ============================================================
// src/store/__tests__/gameStore.resync.test.ts
//
// PURPOSE
//   Step 20 unit tests for the gameStore-level pieces of the
//   resync flow: `getActionsSince(seq)` + the existing
//   `applyRemoteAction` reducer. Verifies that a receiver who
//   missed a contiguous batch can catch up by applying the
//   sender's `actionLog.slice(fromSeq)` in order.
//
//   The transport-level wiring (RESYNC_REQ / RESYNC_RES on the
//   DataChannel) lives in netStore and is exercised end-to-end
//   manually per the Step 20 STOP condition; here we cover the
//   reducer convergence — the part most likely to silently drift
//   if a future change to `executeAction` breaks the contract
//   that "applying a slice equals applying the originals".
// ============================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  setActionBroadcaster,
  useGameStore,
  type ActionLogEntry,
} from '../gameStore';
import type { GameOptions, Profile, TurnAction } from '../../domain/types';

// ── Fixtures ──────────────────────────────────────────────────

const OPTIONS: GameOptions = {
  difficulty: 'normal',
  boardSizeId: 'medium',
  timerMinutes: 5,
  againstView: false,
  walls: false,
};

const PROFILES: [Profile, Profile] = [
  { name: 'A', color: '#0066ff' },
  { name: 'B', color: '#ff3300' },
];

function startAs(localPlayerIndex: 0 | 1): void {
  useGameStore.getState().startGame({
    options: OPTIONS,
    profiles: PROFILES,
    seed: 'test-seed',
    mode: 'network',
    localPlayerIndex,
  });
}

function firstAvailable(playerId: string): string {
  const fig = useGameStore
    .getState()
    .game!.figures.find(
      (f) => f.playerId === playerId && f.status === 'available',
    );
  if (!fig) throw new Error(`no available figure for ${playerId}`);
  return fig.instanceId;
}

let captured: ActionLogEntry[] = [];

beforeEach(() => {
  captured = [];
  setActionBroadcaster((entry) => {
    captured.push(entry);
  });
});

afterEach(() => {
  setActionBroadcaster(null);
  useGameStore.getState().resetGame();
});

// ── Tests ─────────────────────────────────────────────────────

describe('gameStore resync (Step 20)', () => {
  it('getActionsSince returns the requested suffix of actionLog', () => {
    startAs(0);
    // Local PLACE — turn 1.
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p1'),
      position: { col: 0, row: 8 },
    });
    // Remote PLACE — turn 2.
    useGameStore.getState().applyRemoteAction({
      action: {
        type: 'PLACE',
        instanceId: firstAvailable('p2'),
        position: { col: 0, row: 0 },
      },
      turnNumber: 2,
    });
    // Local PLACE — turn 3.
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p1'),
      position: { col: 1, row: 8 },
    });

    const all = useGameStore.getState().getActionsSince(0);
    expect(all.map((e) => e.seq)).toEqual([0, 1, 2]);

    const tail = useGameStore.getState().getActionsSince(1);
    expect(tail.map((e) => e.seq)).toEqual([1, 2]);

    const empty = useGameStore.getState().getActionsSince(99);
    expect(empty).toEqual([]);
  });

  it('a receiver that drops a 3-action batch converges via resync', () => {
    // Sender side: play 4 moves and capture every locally-broadcast
    // entry. We simulate "remote opponent" via applyRemoteAction on
    // the same store to advance the turn — `captured` only fills
    // from the LOCAL moves, which is exactly what the wire would
    // carry to a receiver.
    startAs(0);

    // Turn 1 (local).
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p1'),
      position: { col: 0, row: 8 },
    });
    // Turn 2 (remote ← simulated; not captured).
    useGameStore.getState().applyRemoteAction({
      action: {
        type: 'PLACE',
        instanceId: firstAvailable('p2'),
        position: { col: 0, row: 0 },
      },
      turnNumber: 2,
    });
    // Turn 3 (local).
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p1'),
      position: { col: 1, row: 8 },
    });
    useGameStore.getState().applyRemoteAction({
      action: {
        type: 'PLACE',
        instanceId: firstAvailable('p2'),
        position: { col: 1, row: 0 },
      },
      turnNumber: 4,
    });
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p1'),
      position: { col: 2, row: 8 },
    });

    // The wire carried exactly the local moves (3 of them).
    const senderActions: TurnAction[] = captured.map((e) => e.action);
    expect(senderActions).toHaveLength(3);

    // Snapshot the sender's final state for the convergence assert.
    const senderFinal = useGameStore.getState().game!;

    // ── Receiver simulation ────────────────────────────────────
    // Reset to a fresh game with the receiver's perspective: the
    // remote player is index 0 (the original sender), so the local
    // player is index 1. Play out the same remote moves the
    // sender's "opponent" did, but DROP all of the sender's local
    // moves — simulating a 3-message gap on the receiver's side.
    setActionBroadcaster(null); // receiver doesn't broadcast
    useGameStore.getState().resetGame();
    useGameStore.getState().startGame({
      options: OPTIONS,
      profiles: PROFILES,
      seed: 'test-seed',
      mode: 'network',
      localPlayerIndex: 1,
    });

    // The receiver's "local" player is p2; they make their own
    // moves locally (no broadcaster registered, so `captured` is
    // unaffected). These match the moves we fed via
    // applyRemoteAction on the sender side, so both stores stay
    // on the same turn cursor — minus the sender's three drops.
    // Receiver's first turn: opponent (p1 → sender) is supposed
    // to play but the message was dropped. Skip directly to the
    // resync apply below — we never call applyRemoteAction here
    // for the missed actions, mimicking a real gap.

    // Now: apply the missing batch as a RESYNC_RES would. The
    // receiver's gameStore is at turn 1 with p1 to move. Feed
    // sender's first action (turn 1) → applyRemoteAction. That
    // advances to turn 2, p2 to move; the receiver plays its own
    // local move locally; etc. We model this by interleaving the
    // receiver's locals with the resynced actions.

    // Replay: t1 sender (resync), t2 receiver (local), t3 sender
    // (resync), t4 receiver (local), t5 sender (resync).
    function applyResynced(action: TurnAction): void {
      const turnNumber = useGameStore.getState().game!.turnNumber;
      const ok = useGameStore.getState().applyRemoteAction({
        action,
        turnNumber,
      });
      expect(ok).toBe(true);
    }

    applyResynced(senderActions[0]); // turn 1
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p2'),
      position: { col: 0, row: 0 },
    }); // turn 2
    applyResynced(senderActions[1]); // turn 3
    useGameStore.getState().executeAction({
      type: 'PLACE',
      instanceId: firstAvailable('p2'),
      position: { col: 1, row: 0 },
    }); // turn 4
    applyResynced(senderActions[2]); // turn 5

    const receiverFinal = useGameStore.getState().game!;

    // Convergence: identical figure positions and same turn cursor.
    expect(receiverFinal.turnNumber).toBe(senderFinal.turnNumber);
    expect(receiverFinal.currentPlayerIndex).toBe(senderFinal.currentPlayerIndex);
    expect(receiverFinal.figures).toEqual(senderFinal.figures);
    expect(receiverFinal.phase).toBe(senderFinal.phase);
  });
});
