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
        // Deterministic id: identical across peers in a network game
        // so PLACE/MOVE actions referencing this id resolve on both
        // sides. Uniqueness is guaranteed by (playerId, figureTypeId, i).
        instances.push({
          instanceId: `${player.id}__${allowed.figureTypeId}__${i}`,
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
 *         row, on two RANDOMLY chosen distinct columns.
 *
 * Side effects: reads `Math.random()`. The result is therefore not
 *               deterministic — call once at game start and store
 *               the result in `GameState.walls` so the layout is
 *               stable for the rest of the match (and survives the
 *               localStorage snapshot, which persists `walls`).
 *
 * Placement rule:
 *   - `midRow = floor(boardHeight / 2)` (unchanged from the
 *     previous implementation).
 *   - Two distinct columns picked uniformly from `0..boardWidth-1`.
 *
 * Edge case: if `boardWidth < 2` we return whatever fits (one or
 * zero walls) rather than spinning forever. Our presets are all
 * `width >= 6` so this only matters for defensive correctness.
 *
 * Behaviour note (per user direction): pieces may pass *over* a
 * wall during a move (the rules engine doesn't iterate intermediate
 * squares — see `getValidMoves` in `rules.ts`). Walls only block a
 * piece from *landing* on the wall cell itself. This is intentional.
 */
export function placeWalls(
  boardWidth: number,
  boardHeight: number,
  rng: () => number = Math.random,
): Position[] {
  const midRow = Math.floor(boardHeight / 2);
  if (boardWidth <= 0) return [];
  if (boardWidth === 1) return [{ col: 0, row: midRow }];

  const firstCol = Math.floor(rng() * boardWidth);
  // Pick a second column uniformly from the remaining `boardWidth - 1`
  // options, then shift past `firstCol` to skip it. Cheaper and
  // bias-free vs. rejection sampling.
  let secondCol = Math.floor(rng() * (boardWidth - 1));
  if (secondCol >= firstCol) secondCol += 1;

  return [
    { col: firstCol, row: midRow },
    { col: secondCol, row: midRow },
  ];
}

/**
 * Deterministic 32-bit PRNG (mulberry32). Seeded from a string so
 * both peers in a network game can compute identical wall layouts
 * from the shared `seed`. Not cryptographically secure — only used
 * for game-setup randomness.
 */
export function seededRng(seed: string): () => number {
  // FNV-1a 32-bit hash of the string → starting state.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
