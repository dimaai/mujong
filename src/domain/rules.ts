// ============================================================
// src/domain/rules.ts
//
// PURPOSE: Pure game-rule functions. No side effects, no state
// mutation, no framework imports. Given inputs → returns result.
//
// These functions are called by the Zustand store before
// committing any state change.
// ============================================================

import type {
  Position,
  PlayerFigureInstance,
  FigureType,
  Level,
} from './types';

// ── Board boundary helpers ────────────────────────────────────

/**
 * Returns true if the column is within the board's left/right walls.
 * Figures may NEVER step off the left or right edge.
 *
 * @param pos    - the position to test
 * @param level  - provides boardWidth
 */
export function isWithinHorizontalBounds(pos: Position, level: Level): boolean {
  return pos.col >= 0 && pos.col < level.boardWidth;
}

/**
 * Returns true if the position is fully inside the board rectangle.
 * Used internally to filter non-winning candidate squares.
 *
 * @param pos   - the position to test
 * @param level - provides boardWidth and boardHeight
 */
export function isOnBoard(pos: Position, level: Level): boolean {
  return (
    pos.col >= 0 &&
    pos.col < level.boardWidth &&
    pos.row >= 0 &&
    pos.row < level.boardHeight
  );
}

// ── Win detection ─────────────────────────────────────────────

/**
 * Returns true if moving a piece to `to` wins the game for that player.
 *
 * Player 0 (bottom, moves UP)  wins by reaching row < 0 (steps off the top).
 * Player 1 (top,    moves DOWN) wins by reaching row >= boardHeight.
 *
 * @param to          - destination position (may be outside board)
 * @param playerIndex - 0 or 1
 * @param level       - provides boardHeight
 */
export function isWinningMove(
  to: Position,
  playerIndex: 0 | 1,
  level: Level,
): boolean {
  if (playerIndex === 0) return to.row < 0;
  return to.row >= level.boardHeight;
}

// ── Internal helpers ──────────────────────────────────────────

/**
 * Builds a Map from "col,row" → PlayerFigureInstance for all placed pieces.
 * This gives O(1) lookups when sliding movement rays across the board.
 * Plain Map is used instead of an object to avoid prototype-key collisions.
 *
 * @param figures - all instances in the game
 * @returns       - a Map keyed by position string
 */
function buildPositionMap(
  figures: PlayerFigureInstance[],
): Map<string, PlayerFigureInstance> {
  const map = new Map<string, PlayerFigureInstance>();
  for (const fig of figures) {
    if (fig.status === 'placed' && fig.position !== null) {
      map.set(`${fig.position.col},${fig.position.row}`, fig);
    }
  }
  return map;
}

/**
 * Builds an O(1)-lookup `Set` of `"col,row"` strings for every wall.
 * Tiny helper, but extracting it keeps `getValidMoves` readable and
 * means a one-line change if we ever switch to a different encoding.
 *
 * @param walls - wall positions from `GameState.walls`
 */
function buildWallSet(walls: Position[]): Set<string> {
  const set = new Set<string>();
  for (const w of walls) set.add(`${w.col},${w.row}`);
  return set;
}

// ── Movement validation ───────────────────────────────────────

/**
 * Returns every valid destination square for a placed figure.
 *
 * How it works:
 *   For each allowed direction (vertical, horizontal, diagonal) it
 *   "slides" a ray one square at a time, up to the movement limit.
 *   The ray stops when:
 *     1. It hits a friendly piece       → blocked, don't include square
 *     2. It hits an enemy piece         → include square (capture), then stop
 *     3. It exits horizontal bounds     → stop and don't include
 *     4. It exits vertical bounds       → include if it's a winning move, then stop
 *   If canJump is true, rays continue past occupied squares.
 *
 * @param instance    - the figure being moved (must have status "placed")
 * @param figureType  - the type definition (provides movement limits)
 * @param playerIndex - whose piece this is (0 or 1)
 * @param allFigures  - every instance in the game (for collision checks)
 * @param level       - board dimensions
 * @returns           - array of valid destination positions
 */
export function getValidMoves(
  instance: PlayerFigureInstance,
  figureType: FigureType,
  playerIndex: 0 | 1,
  allFigures: PlayerFigureInstance[],
  level: Level,
  walls: Position[] = [],
): Position[] {
  if (instance.status !== 'placed' || instance.position === null) return [];

  const { col, row } = instance.position;
  const { movement, canJump } = figureType;
  const posMap = buildPositionMap(allFigures);
  const wallSet = buildWallSet(walls);
  const valid: Position[] = [];

  /**
   * Tries to add (toCol, toRow) to valid destinations.
   * Returns true  → ray should continue past this square.
   * Returns false → ray is blocked and must stop.
   */
  const tryAdd = (toCol: number, toRow: number): boolean => {
    const candidate: Position = { col: toCol, row: toRow };

    // Winning moves leave the board vertically — special early exit.
    if (isWinningMove(candidate, playerIndex, level)) {
      // Still must be within horizontal bounds at the moment of exit.
      if (toCol >= 0 && toCol < level.boardWidth) {
        valid.push(candidate);
      }
      return false; // Stop the ray — going further off-board adds no value.
    }

    // Reject squares outside left/right walls.
    if (!isWithinHorizontalBounds(candidate, level)) return false;
    // Reject squares outside top/bottom (non-winning).
    if (!isOnBoard(candidate, level)) return false;

    // ── Walls (Step 8) ──
    // Walls are terrain: a piece may NEVER LAND on a wall, regardless
    // of `canJump`. Note that the rules engine does not iterate
    // intermediate squares along a ray, so passing OVER a wall on
    // the way to a square beyond it is not blocked here — that is
    // intentional and consistent with how the engine treats pieces
    // along a ray today.
    if (wallSet.has(`${toCol},${toRow}`)) {
      return false;
    }

    const occupant = posMap.get(`${toCol},${toRow}`);

    // Friendly piece: blocked entirely, do not add.
    if (occupant && occupant.playerId === instance.playerId) return false;

    // Empty or enemy square: add it.
    valid.push(candidate);

    // If the square had an enemy, the ray stops (we captured, can't continue).
    // If canJump is true, we continue past any piece.
    return !occupant || canJump;
  };

  // ── Vertical rays (up = row decreases, down = row increases) ─
  if (movement.vertical > 0) {
     tryAdd(col, row - movement.vertical); // up
     tryAdd(col, row + movement.vertical); // down
  }

  // ── Horizontal rays ───────────────────────────────────────────
  if (movement.horizontal > 0) {
      tryAdd(col - movement.horizontal, row); // left
      tryAdd(col + movement.horizontal, row); // right
  }

  // ── Diagonal rays (all four corners) ─────────────────────────
  if (movement.diagonal > 0) {
    tryAdd(col + movement.diagonal, row + movement.diagonal);
    tryAdd(col - movement.diagonal, row + movement.diagonal);
    tryAdd(col + movement.diagonal, row - movement.diagonal);
    tryAdd(col - movement.diagonal, row - movement.diagonal);
  }

  return valid;
}

// ── Placement validation ──────────────────────────────────────

/**
 * Returns all valid squares where a player can place a new figure.
 *
 * Rules:
 *   Player 0 places on the LAST row  (row = boardHeight - 1, bottom).
 *   Player 1 places on the FIRST row (row = 0, top).
 *   A square is only valid if it is not already occupied.
 *
 * @param playerIndex - 0 or 1
 * @param allFigures  - every instance (to detect occupancy)
 * @param level       - provides boardWidth and boardHeight
 * @returns           - unoccupied squares on the starting row
 */
export function getValidPlacements(
  playerIndex: 0 | 1,
  allFigures: PlayerFigureInstance[],
  level: Level,
  walls: Position[] = [],
): Position[] {
  const targetRow = playerIndex === 0 ? level.boardHeight - 1 : 0;
  const posMap = buildPositionMap(allFigures);
  const wallSet = buildWallSet(walls);
  const positions: Position[] = [];

  for (let col = 0; col < level.boardWidth; col++) {
    const key = `${col},${targetRow}`;
    if (!posMap.has(key) && !wallSet.has(key)) {
      positions.push({ col, row: targetRow });
    }
  }
  return positions;
}
