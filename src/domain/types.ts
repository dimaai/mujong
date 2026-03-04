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
   * Remaining time in seconds for each player.
   * [0] = Player 1, [1] = Player 2.
   */
  playerTimers: [number, number];
  /**
   * When true, the top player's panel is rendered upside-down
   * so two players can sit across from each other on one screen.
   */
  againstView: boolean;
}
