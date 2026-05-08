// ============================================================
// src/domain/board.ts
//
// PURPOSE: Read-only utility functions for querying board state.
// The board is NOT a stored 2D array — it is always derived from
// the `figures` array in GameState. These helpers abstract that.
// ============================================================

import type { Position, PlayerFigureInstance, AllowedFigure } from './types';

// ── Query helpers ─────────────────────────────────────────────

/**
 * Returns the placed figure at (col, row), or null if the square is empty.
 *
 * @param col     - column (0 = leftmost)
 * @param row     - row (0 = topmost)
 * @param figures - all instances in the game
 */
export function getFigureAt(
  col: number,
  row: number,
  figures: PlayerFigureInstance[],
): PlayerFigureInstance | null {
  return (
    figures.find(
      (f) =>
        f.status === 'placed' &&
        f.position?.col === col &&
        f.position?.row === row,
    ) ?? null
  );
}

/**
 * Returns true if any placed figure occupies the given position.
 *
 * @param pos     - the position to check
 * @param figures - all instances in the game
 */
export function isOccupied(pos: Position, figures: PlayerFigureInstance[]): boolean {
  return getFigureAt(pos.col, pos.row, figures) !== null;
}

/**
 * Returns all figures currently on the board for a given player.
 *
 * @param playerId - the player's id
 * @param figures  - all instances in the game
 */
export function getPlacedFigures(
  playerId: string,
  figures: PlayerFigureInstance[],
): PlayerFigureInstance[] {
  return figures.filter((f) => f.playerId === playerId && f.status === 'placed');
}

/**
 * Returns all figures still available (not yet placed) for a given player.
 *
 * @param playerId - the player's id
 * @param figures  - all instances in the game
 */
export function getAvailableFigures(
  playerId: string,
  figures: PlayerFigureInstance[],
): PlayerFigureInstance[] {
  return figures.filter((f) => f.playerId === playerId && f.status === 'available');
}

/**
 * Returns all figures that were captured from a given player.
 *
 * @param playerId - the player whose captured pieces to find
 * @param figures  - all instances in the game
 */
export function getTakenFigures(
  playerId: string,
  figures: PlayerFigureInstance[],
): PlayerFigureInstance[] {
  return figures.filter((f) => f.playerId === playerId && f.status === 'taken');
}

// ── Factory helpers ───────────────────────────────────────────

/**
 * Generates a unique id for a new figure instance.
 * Uses a module-level counter + timestamp to avoid collisions
 * even when called many times in the same millisecond.
 */
let _instanceCounter = 0;
export function generateInstanceId(): string {
  return `fig_${++_instanceCounter}_${Date.now()}`;
}

/**
 * Builds the initial set of PlayerFigureInstances for a new game.
 *
 * Step 7 note: this used to take a full `Level`, but the per-game
 * piece roster now comes from the difficulty mapping
 * (`getFigureRosterFor`) instead of being baked into the level.
 * Decoupling roster from board dimensions lets Settings drive
 * each axis independently.
 *
 * For each entry in `allowedFigures`, creates `quantity` instances
 * for EACH player, all starting with status "available" and no
 * position.
 *
 * @param allowedFigures - per-player roster (figure type + quantity)
 * @param players        - tuple of [player1, player2]
 * @param skinMap        - maps figureTypeId → skinId so each type
 *                         gets a default skin
 * @returns flat array of all instances for both players
 */
export function createInitialFigures(
  allowedFigures: AllowedFigure[],
  players: [{ id: string }, { id: string }],
  skinMap: Record<string, string>,
): PlayerFigureInstance[] {
  const instances: PlayerFigureInstance[] = [];

  for (const playerIndex of [0, 1] as const) {
    const player = players[playerIndex];
    for (const allowed of allowedFigures) {
      for (let i = 0; i < allowed.quantity; i++) {
        instances.push({
          instanceId: generateInstanceId(),
          figureTypeId: allowed.figureTypeId,
          skinId: skinMap[allowed.figureTypeId] ?? 'skin_default_blue',
          playerId: player.id,
          status: 'available',
          position: null,
        });
      }
    }
  }

  return instances;
}

// ── Walls (Step 8) ────────────────────────────────────────────

/**
 * Returns the deterministic positions of the two terrain walls for a
 * board of the given dimensions.
 *
 * Inputs:
 *   - `boardWidth`  — number of columns (must be ≥ 2).
 *   - `boardHeight` — number of rows    (must be ≥ 2).
 *
 * Output: an array of exactly two `Position`s on the single middle
 *         row, mirror-symmetric across the vertical centre line so
 *         the layout reads identically from either player's side.
 *
 * Side effects: none. Pure function — same inputs always return the
 *               same positions, so unit tests don't need RNG.
 *
 * Placement rule (per the user-confirmed simplification of Q-002):
 *   - `midRow   = floor(boardHeight / 2)`     — round down for evens
 *   - `leftCol  = floor((boardWidth - 1) / 2)`
 *   - `rightCol = boardWidth - 1 - leftCol`
 *   - Walls = `(leftCol, midRow)` and `(rightCol, midRow)`.
 *
 * For odd `boardWidth` (e.g. 5) `leftCol === rightCol`, so we
 * collapse to a single wall — the helper still returns one entry
 * in that edge case rather than two overlapping walls.
 *
 * Behaviour note (per user direction): pieces may pass *over* a
 * wall during a move (the rules engine doesn't iterate intermediate
 * squares — see `getValidMoves` in `rules.ts`). Walls only block a
 * piece from *landing* on the wall cell itself. This is intentional.
 */
export function placeWalls(
  boardWidth: number,
  boardHeight: number,
): Position[] {
  const midRow = Math.floor(boardHeight / 2);
  const leftCol = Math.floor((boardWidth - 1) / 2);
  const rightCol = boardWidth - 1 - leftCol;
  if (leftCol === rightCol) {
    return [{ col: leftCol, row: midRow }];
  }
  return [
    { col: leftCol, row: midRow },
    { col: rightCol, row: midRow },
  ];
}
