// ============================================================
// src/domain/types.ts
//
// PURPOSE: Every TypeScript type and interface used across the
// entire app lives here. This file has ZERO framework imports —
// no React, no Next.js, no Zustand. That means it is safe to
// copy into a future React Native project unchanged.
//
// HOW TO READ: Start from the smallest building blocks
// (MovementRules) and work down toward the full GameState.
// ============================================================

// ── Figure types and skins ────────────────────────────────────

/**
 * Defines how far a figure can move in each axis.
 * Each number is a maximum — 0 means "cannot move in this direction at all."
 *
 * Example: { vertical: 2, horizontal: 0, diagonal: 1 }
 *   → can move up to 2 squares up/down, cannot go sideways, 1 square diagonal.
 */
export interface MovementRules {
  /** Maximum squares up OR down (along the Y-axis / rows). */
  vertical: number;
  /** Maximum squares left OR right (along the X-axis / columns). */
  horizontal: number;
  /** Maximum squares in any of the four diagonal directions. */
  diagonal: number;
}

/**
 * A figure *type* — the reusable template that defines what a piece can do.
 * Many figures in a game can share the same FigureType (like chess pawns).
 */
export interface FigureType {
  id: string;
  name: string;
  movement: MovementRules;
  /**
   * When true, this figure may jump over other pieces (like a chess knight).
   * When false, other pieces block its path.
   */
  canJump: boolean;
}

/**
 * Visual skin — purely decorative, no effect on rules.
 * imageFile is a path relative to /public, e.g. "/skins/warrior.svg".
 */
export interface Skin {
  skinId: string;
  name: string;
  imageFile: string;
}

// ── Players and levels ────────────────────────────────────────

/**
 * A registered player. Rating is a number used to match players
 * of similar skill — starts at 1000 by convention.
 */
export interface Player {
  id: string;
  name: string;
  rating: number;
}

/**
 * A persisted, device-local *profile* the user edits on the main menu.
 * Distinct from `Player` (a runtime participant in a game session):
 * `Profile` is what the user sees in the lobby/settings; it gets copied
 * into a `Player` when a game actually starts.
 *
 * Kept intentionally tiny so it is safe to sync to the cloud later.
 */
export interface Profile {
  /** Display name shown in panels and lobby. */
  name: string;
  /** CSS color string used as the player's accent color. */
  color: string;
}

/**
 * Specifies how many of a given FigureType each player gets in a level.
 * e.g. { figureTypeId: 'ft_runner', quantity: 2 } → 2 Runners per player.
 */
export interface AllowedFigure {
  figureTypeId: string;
  quantity: number;
}

/**
 * A level definition. Controls board size, which pieces are available,
 * and the visual accent colors for each player's side of the UI.
 */
export interface Level {
  levelId: string;
  levelNumber: number;
  levelName: string;
  /** How many columns wide the board is (X-axis). */
  boardWidth: number;
  /** How many rows tall the board is (Y-axis). */
  boardHeight: number;
  /** Which figure types are available and in what quantity per player. */
  allowedFigures: AllowedFigure[];
  /** CSS color string for Player 1 (bottom). Used in strips and panels. */
  player1Color: string;
  /** CSS color string for Player 2 (top). Used in strips and panels. */
  player2Color: string;
  /** Per-player timer in minutes (default 5). 0 = no timer. */
  timerMinutes: number;
}

// ── Runtime game-state types ──────────────────────────────────

/**
 * A coordinate on the board.
 *   col 0 = leftmost column
 *   row 0 = topmost row  (Player 2's starting side)
 *   row (boardHeight - 1) = bottommost row (Player 1's starting side)
 */
export interface Position {
  col: number;
  row: number;
}

/**
 * The lifecycle state of a single figure instance during a game.
 *   available → in the side panel, not yet placed on the board
 *   placed    → on the board at a specific position
 *   taken     → captured by the opponent (shown crossed-out)
 */
export type FigureStatus = 'available' | 'placed' | 'taken';

/**
 * A concrete piece belonging to one player within an active game session.
 * This is distinct from FigureType — FigureType is the template,
 * PlayerFigureInstance is the live copy with ownership and position.
 */
export interface PlayerFigureInstance {
  /** Unique ID for this specific piece in this specific game. */
  instanceId: string;
  figureTypeId: string;
  skinId: string;
  /** ID of the player who owns this piece. */
  playerId: string;
  status: FigureStatus;
  /** Board position — null when status is "available" or "taken". */
  position: Position | null;
}

/**
 * Describes one player action during their turn.
 * PLACE: puts an available figure onto the board for the first time.
 * MOVE:  slides an already-placed figure to a new square.
 */
export type TurnAction =
  | { type: 'PLACE'; instanceId: string; position: Position }
  | { type: 'MOVE'; instanceId: string; from: Position; to: Position };

/** The high-level phase of the game session. */
export type GamePhase = 'playing' | 'finished' | 'draw';

/**
 * Per-player remaining time, in milliseconds. Step 21 replaced the
 * coarser seconds-based `playerTimers` with this shape so the
 * domain can charge wall-time precisely between actions instead of
 * relying on a 1 Hz UI tick.
 */
export interface GameClocks {
  /** Player 1 (`players[0]`) remaining time in ms. Floors at 0. */
  p1RemainingMs: number;
  /** Player 2 (`players[1]`) remaining time in ms. Floors at 0. */
  p2RemainingMs: number;
  /**
   * `Date.now()` at which the current player's clock was last
   * charged. `null` = paused (game just started, or just resumed
   * from a snapshot).
   */
  lastTickAt: number | null;
}

/**
 * The complete runtime state of a game session.
 * This is what Zustand stores and React reads.
 *
 * Important: the board is NOT stored as a 2D array here.
 * Instead it is derived from `figures` by filtering for placed pieces.
 * One source of truth → no sync bugs.
 */
export interface GameState {
  gameId: string;
  level: Level;
  /**
   * players[0] = Player 1, starts at the bottom, moves toward row 0.
   * players[1] = Player 2, starts at the top, moves toward the last row.
   */
  players: [Player, Player];
  /** 0 = Player 1's turn, 1 = Player 2's turn. */
  currentPlayerIndex: 0 | 1;
  /** All figure instances for both players combined. */
  figures: PlayerFigureInstance[];
  phase: GamePhase;
  /** Populated with a player's id when phase becomes "finished". */
  winnerId: string | null;
  turnNumber: number;
  /** Full log of every action taken — enables undo and replay. */
  history: TurnAction[];
  /**
   * Hashes of every board position reached during the game.
   * Each entry encodes whose turn it is + all placed-figure positions.
   * Used for threefold-repetition draw detection.
   */
  positionHashes: string[];
  /**
   * When non-null, contains the playerId of the player who offered a draw.
   * The opponent can accept or reject.
   */
  drawOfferFrom: string | null;
  /** Why the game ended in a draw: repetition or mutual agreement. */
  drawReason: 'repetition' | 'agreement' | null;
  /**
   * Per-player game clocks (Step 21). `null` when the user disabled
   * the timer (`options.timerMinutes === 0`) — no countdown UI and
   * no flag-fall path exists in that case.
   *
   * `lastTickAt` is the wall-clock ms (Date.now()) at which the
   * current player's clock was last charged. `null` means the
   * clock is paused — used at game start (before any tick) and
   * after rehydrating a snapshot, so a tab that was closed
   * overnight doesn't deduct the gap.
   */
  clocks: GameClocks | null;
  /**
   * When true, the top player's panel is rendered upside-down
   * so two players can sit across from each other on one screen.
   */
  againstView: boolean;
  /**
   * Wall cells on the board (Step 8). Empty when `options.walls` is
   * false. Walls are deterministic terrain — never enter, never
   * capturable. Per the current Q-walls branch (see ARCHITECTURE
   * §4.2 + IMPLEMENTATION_PLAN Step 8), `canJump` figures may pass
   * over walls; non-jumpers are blocked.
   */
  walls: Position[];
}

// ── Settings (Step 3) ─────────────────────────────────────────
//
// These types describe the *user-configurable* options the player
// edits in the (future) Settings screen. They live ALONGSIDE the
// existing `Level` type — `Level` is the legacy, fully-baked level
// definition still used by the current game flow; `GameOptions`
// is the new shape that will replace it once Phase B wires the
// Settings UI and Phase C splits difficulty / board size apart.
//
// Keeping both in parallel lets us land Step 3 with zero gameplay
// regressions: nothing reads `GameOptions` yet.

/**
 * Difficulty selects which roster of pieces each player gets.
 * The mapping `Difficulty → AllowedFigure[]` is defined in Phase C
 * (see ARCHITECTURE.md §3) — this type just names the choices.
 */
export type Difficulty = 'beginner' | 'normal' | 'advanced';

/**
 * A named board-dimensions preset shown in the Settings screen.
 * `id` is what we persist (stable, machine-readable);
 * `label` is what we render to the user.
 */
export interface BoardSizePreset {
  /** Stable identifier persisted in `GameOptions.boardSizeId`. */
  id: string;
  /** Human-friendly label, e.g. "Medium (8 × 10)". */
  label: string;
  /** Number of columns (X-axis). */
  width: number;
  /** Number of rows (Y-axis). */
  height: number;
}

/**
 * The persisted bundle of user-tweakable game settings.
 *
 * NOTE: per IMPLEMENTATION_PLAN.md Step 3 we intentionally exclude
 * player names and colors here — those live in `Profile` (see the
 * `Profile` type above) so they can be edited and synced
 * independently of the per-game settings.
 */
export interface GameOptions {
  /** Which roster of pieces both players receive. */
  difficulty: Difficulty;
  /** Lookup key into the `BOARD_SIZE_MAP` registry. */
  boardSizeId: string;
  /** Per-player clock in minutes. 0 disables the timer entirely. */
  timerMinutes: number;
  /** When true, the top player's UI is flipped 180° (shared device). */
  againstView: boolean;
  /** When true, two blocking walls are placed on the middle row. */
  walls: boolean;
}
