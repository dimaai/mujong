// ============================================================
// src/domain/__tests__/walls.test.ts
//
// PURPOSE
//   Step 8 unit tests for walls in the rules engine. Three slices:
//     1. `placeWalls` is deterministic and 180°-symmetric.
//     2. `getValidPlacements` skips wall cells.
//     3. `getValidMoves` blocks non-jumpers and lets `canJump`
//        figures pass through walls (TODO(Q-walls) — see
//        `rules.ts` if the clarification flips).
//
// NO FRAMEWORK COUPLING
//   Pure-domain tests — no React, no Zustand, no DOM. They run
//   under `vitest` (added in Step 8 / package.json) but the file
//   could be ported to any standard runner unchanged.
// ============================================================

import { describe, expect, it } from 'vitest';

import { placeWalls } from '../board';
import { getValidMoves, getValidPlacements } from '../rules';
import type {
  FigureType,
  Level,
  PlayerFigureInstance,
  Position,
} from '../types';

// ── Fixtures ──────────────────────────────────────────────────

/** Tiny synthetic level — only the rules engine reads board size. */
function makeLevel(boardWidth: number, boardHeight: number): Level {
  return {
    levelId: 'lvl_test',
    levelNumber: 0,
    levelName: 'Test',
    boardWidth,
    boardHeight,
    allowedFigures: [],
    player1Color: '#000',
    player2Color: '#fff',
    timerMinutes: 0,
  };
}

/** A non-jumping piece: 1 square in every direction. */
const TYPE_WALKER: FigureType = {
  id: 'ft_walker',
  name: 'Walker',
  movement: { vertical: 1, horizontal: 1, diagonal: 1 },
  canJump: false,
};

/** A jumper that can travel 2 vertically — long enough to hop a wall. */
const TYPE_JUMPER: FigureType = {
  id: 'ft_jumper',
  name: 'Jumper',
  movement: { vertical: 2, horizontal: 0, diagonal: 0 },
  canJump: true,
};

/** Builds one placed figure at (col, row) owned by `playerId`. */
function placedAt(
  instanceId: string,
  playerId: string,
  figureTypeId: string,
  col: number,
  row: number,
): PlayerFigureInstance {
  return {
    instanceId,
    figureTypeId,
    skinId: 'skin_default_blue',
    playerId,
    status: 'placed',
    position: { col, row },
  };
}

// ── 1. placeWalls ─────────────────────────────────────────────

describe('placeWalls', () => {
  it('returns exactly two distinct positions for typical presets', () => {
    for (const [w, h] of [
      [6, 9],
      [8, 10],
      [6, 11],
    ] as const) {
      const walls = placeWalls(w, h);
      expect(walls).toHaveLength(2);
      expect(walls[0]).not.toEqual(walls[1]);
    }
  });

  it('is deterministic (same input → same output)', () => {
    expect(placeWalls(8, 10)).toEqual(placeWalls(8, 10));
    expect(placeWalls(6, 9)).toEqual(placeWalls(6, 9));
  });

  it('places both walls on the single middle row (rounded down)', () => {
    for (const [w, h] of [
      [6, 9],
      [8, 10],
      [6, 11],
    ] as const) {
      const midRow = Math.floor(h / 2);
      const walls = placeWalls(w, h);
      for (const wall of walls) expect(wall.row).toBe(midRow);
    }
  });

  it('places walls mirror-symmetrically across the vertical centre line', () => {
    for (const [w, h] of [
      [6, 9],
      [8, 10],
      [6, 11],
    ] as const) {
      const walls = placeWalls(w, h);
      // Mirror each wall horizontally; the resulting set must equal the original.
      const key = (p: Position) => `${p.col},${p.row}`;
      const original = new Set(walls.map(key));
      const mirrored = new Set(
        walls.map((p) => key({ col: w - 1 - p.col, row: p.row })),
      );
      expect(mirrored).toEqual(original);
    }
  });

  it('keeps walls inside the board', () => {
    const w = 8;
    const h = 10;
    for (const wall of placeWalls(w, h)) {
      expect(wall.col).toBeGreaterThanOrEqual(0);
      expect(wall.col).toBeLessThan(w);
      expect(wall.row).toBeGreaterThanOrEqual(0);
      expect(wall.row).toBeLessThan(h);
    }
  });

  it('collapses to a single wall when boardWidth is odd (centre column)', () => {
    // For odd widths, leftCol === rightCol, so the helper returns just
    // one wall rather than two overlapping entries.
    const walls = placeWalls(5, 9);
    expect(walls).toHaveLength(1);
    expect(walls[0]).toEqual({ col: 2, row: 4 });
  });
});

// ── 2. getValidPlacements ─────────────────────────────────────

describe('getValidPlacements with walls', () => {
  it('omits wall cells from the placement row', () => {
    const level = makeLevel(6, 9);
    // Place a wall on the bottom row (player 0's placement row).
    const walls: Position[] = [{ col: 2, row: 8 }];
    const positions = getValidPlacements(0, [], level, walls);
    expect(positions).toHaveLength(level.boardWidth - 1);
    expect(positions.find((p) => p.col === 2 && p.row === 8)).toBeUndefined();
  });

  it('returns the full row when no walls intersect it', () => {
    const level = makeLevel(6, 9);
    // Wall sits on a non-placement row → does not affect placements.
    const walls: Position[] = [{ col: 2, row: 4 }];
    const positions = getValidPlacements(0, [], level, walls);
    expect(positions).toHaveLength(level.boardWidth);
  });
});

// ── 3. getValidMoves ──────────────────────────────────────────

describe('getValidMoves with walls', () => {
  it('blocks a non-jumper from landing on a wall cell', () => {
    const level = makeLevel(5, 5);
    // Walker at (2,2). Wall directly above at (2,1).
    const walker = placedAt('w1', 'p1', TYPE_WALKER.id, 2, 2);
    const walls: Position[] = [{ col: 2, row: 1 }];

    const moves = getValidMoves(walker, TYPE_WALKER, 0, [walker], level, walls);

    // (2,1) must NOT appear — the wall blocks landing on it.
    expect(moves.find((m) => m.col === 2 && m.row === 1)).toBeUndefined();
  });

  it('blocks a jumper from landing on a wall cell either', () => {
    // Per the user-confirmed rule: walls are never a valid LANDING
    // square, regardless of `canJump`. Pieces may still pass *over*
    // walls during a multi-square move (the engine doesn't iterate
    // intermediate squares) — this test only asserts the landing
    // restriction.
    const level = makeLevel(5, 5);
    const jumper = placedAt('j1', 'p1', TYPE_JUMPER.id, 2, 4);
    const walls: Position[] = [{ col: 2, row: 2 }];

    const moves = getValidMoves(jumper, TYPE_JUMPER, 0, [jumper], level, walls);

    // The jumper can move 2 squares vertically; the destination (2,2)
    // is a wall, so it must NOT appear in the valid-moves list.
    expect(moves.find((m) => m.col === 2 && m.row === 2)).toBeUndefined();
  });

  it('omits the wall as a valid destination even when path is clear', () => {
    const level = makeLevel(5, 5);
    const walker = placedAt('w1', 'p1', TYPE_WALKER.id, 2, 2);
    // Diagonal wall right next to walker.
    const walls: Position[] = [{ col: 3, row: 3 }];

    const moves = getValidMoves(walker, TYPE_WALKER, 0, [walker], level, walls);

    expect(moves.find((m) => m.col === 3 && m.row === 3)).toBeUndefined();
  });

  it('treats an empty walls array exactly like the pre-Step-8 behaviour', () => {
    // Sanity: passing `[]` (or omitting the parameter) keeps the
    // legacy result so existing call sites stay safe during rollout.
    const level = makeLevel(5, 5);
    const walker = placedAt('w1', 'p1', TYPE_WALKER.id, 2, 2);

    const withoutWalls = getValidMoves(walker, TYPE_WALKER, 0, [walker], level);
    const withEmptyWalls = getValidMoves(
      walker,
      TYPE_WALKER,
      0,
      [walker],
      level,
      [],
    );

    expect(withEmptyWalls).toEqual(withoutWalls);
  });
});
