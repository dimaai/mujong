// ============================================================
// src/store/gameStore.ts
//
// PURPOSE: The single source of truth for a running game session.
// Built with Zustand — a minimal state library that works in both
// React (web) and React Native (mobile) without changes.
//
// HOW ZUSTAND WORKS:
//   `create<Shape>((set, get) => ({ ...state, ...actions }))` returns
//   a hook called `useGameStore`. Inside any React component you call:
//     const { game, startGame } = useGameStore();
//   Zustand re-renders ONLY the components that read the changed slice.
// ============================================================

import { create } from 'zustand';
import type {
  GameState,
  GamePhase,
  GameOptions,
  Player,
  Profile,
  Level,
  Position,
  TurnAction,
  PlayerFigureInstance,
} from '../domain/types';
import { FIGURE_TYPE_MAP, getFigureRosterFor } from '../data/figuretypes';
import { BOARD_SIZE_MAP } from '../data/boardSizes';
import { createInitialFigures, getFigureAt, placeWalls } from '../domain/board';
import { getValidMoves, getValidPlacements, isWinningMove } from '../domain/rules';

// ── Position key for threefold-repetition ─────────────────────
// Encodes whose turn it is + every placed figure's position into a
// single comparable string. Two keys are equal ⟺ the board state
// (and side to move) is identical.
function computePositionKey(
  figures: PlayerFigureInstance[],
  currentPlayerIndex: 0 | 1,
): string {
  const placed = figures
    .filter((f) => f.status === 'placed')
    .map((f) => `${f.instanceId}:${f.position!.col},${f.position!.row}`)
    .sort()
    .join('|');
  return `${currentPlayerIndex};${placed}`;
}

// ── Skin defaults ─────────────────────────────────────────────
// Maps figureTypeId → the skinId each type uses by default.
// When level-specific skins are added, this map will be overridden.
const DEFAULT_SKIN_MAP: Record<string, string> = {
  ft_slon: 'skin_default_blue',
  ft_runner: 'skin_default_blue',
  ft_cross: 'skin_default_blue',
  ft_ziraf: 'skin_default_blue',
};

// ── Store shape ───────────────────────────────────────────────

/**
 * Everything the UI needs from the store, split into:
 *   - state   (data React reads)
 *   - actions (functions React calls to change state)
 */
interface GameStore {
  // State
  game: GameState | null;
  /** The instanceId of the figure the current player has tapped/clicked. */
  selectedInstanceId: string | null;
  /** Highlighted squares showing where the selected figure CAN go. */
  validMoveTargets: Position[];

  // Actions
  /**
   * Initializes a brand-new game session from the user's persisted
   * settings + profiles (Step 7).
   *
   * @param args.options  - the live `GameOptions` from `useSettingsStore`
   *                        (difficulty, boardSizeId, timer, againstView, walls)
   * @param args.profiles - tuple `[player1Profile, player2Profile]` from
   *                        `useProfileStore` (name + color)
   *
   * Side effects: replaces the current `game` with a fresh `GameState`.
   * Note: `walls` is read but not yet honoured by the rules engine
   * (lands in Step 8); `timerMinutes` seeds `playerTimers` only.
   */
  startGame: (args: { options: GameOptions; profiles: [Profile, Profile] }) => void;

  /**
   * Selects a PLACED figure on the board and computes its legal moves.
   * Only the current player's own pieces can be selected.
   * @param instanceId - the piece to select
   */
  selectFigure: (instanceId: string) => void;

  /**
   * Selects an AVAILABLE (not yet placed) figure from the side panel.
   * Highlights valid placement squares on the starting row.
   * @param instanceId - the available piece to select
   */
  selectAvailableFigure: (instanceId: string) => void;

  /**
   * Applies a validated PLACE or MOVE action to the game state.
   * Handles captures, win detection, and turn advancement.
   * @param action - the action to execute
   */
  executeAction: (action: TurnAction) => void;

  /** Clears selection and valid-move highlights without changing game state. */
  resetSelection: () => void;

  /**
   * A player forfeits — the opponent wins.
   * @param playerId - the id of the player who gives up
   */
  forfeit: (playerId: string) => void;

  /**
   * Current player offers a draw to the opponent.
   * @param playerId - the id of the player making the offer
   */
  offerDraw: (playerId: string) => void;

  /** The opponent accepts the pending draw offer. */
  acceptDraw: () => void;

  /** The opponent rejects the pending draw offer. */
  rejectDraw: () => void;

  /**
   * Decrements the active player's timer by 1 second.
   * @returns true when the timer hits 0 (time-out loss)
   */
  tickTimer: () => boolean;

  /** Tears down the current game so the setup screen is shown again. */
  resetGame: () => void;
}

// ── Store implementation ──────────────────────────────────────

export const useGameStore = create<GameStore>((set, get) => ({
  game: null,
  selectedInstanceId: null,
  validMoveTargets: [],

  startGame: ({ options, profiles }) => {
    // Resolve the named board-size preset to concrete dimensions.
    // Falls back to 'medium' if a stale id ever lands here so the
    // game still starts rather than crashing.
    const sizePreset =
      BOARD_SIZE_MAP[options.boardSizeId] ?? BOARD_SIZE_MAP.medium;

    // Difficulty → per-player piece roster.
    const allowedFigures = getFigureRosterFor(options.difficulty);

    // Build runtime Player objects from the persisted profiles.
    // Profiles intentionally don't carry id/rating — those are
    // session-scoped values supplied here.
    const player1: Player = {
      id: 'p1',
      name: profiles[0].name.trim() || 'Player 1',
      rating: 1000,
    };
    const player2: Player = {
      id: 'p2',
      name: profiles[1].name.trim() || 'Player 2',
      rating: 1000,
    };

    // Synthesize the legacy `Level` shape so the rules engine,
    // Board, and GameCanvas can keep reading `game.level.*`
    // unchanged. Phase I will retire `Level` entirely.
    const level: Level = {
      levelId: `synthetic_${options.boardSizeId}_${options.difficulty}`,
      levelNumber: 0,
      levelName: 'Custom',
      boardWidth: sizePreset.width,
      boardHeight: sizePreset.height,
      allowedFigures,
      player1Color: profiles[0].color,
      player2Color: profiles[1].color,
      timerMinutes: options.timerMinutes,
    };

    const figures = createInitialFigures(
      allowedFigures,
      [player1, player2],
      DEFAULT_SKIN_MAP,
    );

    // Step 8: walls are deterministic terrain. Empty array when the
    // option is off so the rules engine simply has nothing to skip.
    const walls = options.walls
      ? placeWalls(sizePreset.width, sizePreset.height)
      : [];

    const timerSeconds = options.timerMinutes * 60;

    const newGame: GameState = {
      gameId: `game_${Date.now()}`,
      level,
      players: [player1, player2],
      currentPlayerIndex: 0, // Player 1 always goes first
      figures,
      phase: 'playing',
      winnerId: null,
      turnNumber: 1,
      history: [],
      positionHashes: [computePositionKey(figures, 0)],
      drawOfferFrom: null,
      drawReason: null,
      playerTimers: [timerSeconds, timerSeconds],
      againstView: options.againstView,
      walls,
    };

    set({ game: newGame, selectedInstanceId: null, validMoveTargets: [] });
  },

  selectFigure: (instanceId) => {
    const { game } = get();
    if (!game || game.phase !== 'playing') return;

    const instance = game.figures.find((f) => f.instanceId === instanceId);
    if (!instance || instance.status !== 'placed') return;

    // Guard: only current player can select their own pieces
    const currentPlayer = game.players[game.currentPlayerIndex];
    if (instance.playerId !== currentPlayer.id) return;

    const figureType = FIGURE_TYPE_MAP[instance.figureTypeId];
    if (!figureType) return;

    // getValidMoves is the pure rules function — no state mutation.
    const moves = getValidMoves(
      instance,
      figureType,
      game.currentPlayerIndex,
      game.figures,
      game.level,
      game.walls,
    );

    set({ selectedInstanceId: instanceId, validMoveTargets: moves });
  },

  selectAvailableFigure: (instanceId) => {
    const { game } = get();
    if (!game || game.phase !== 'playing') return;

    const instance = game.figures.find((f) => f.instanceId === instanceId);
    if (!instance || instance.status !== 'available') return;

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (instance.playerId !== currentPlayer.id) return;

    // getValidPlacements returns unoccupied, non-wall squares on the
    // player's starting row (Step 8 added the walls argument).
    const placements = getValidPlacements(
      game.currentPlayerIndex,
      game.figures,
      game.level,
      game.walls,
    );

    set({ selectedInstanceId: instanceId, validMoveTargets: placements });
  },

  executeAction: (action) => {
    const { game } = get();
    if (!game || game.phase !== 'playing') return;

    const currentPlayer = game.players[game.currentPlayerIndex];

    // Spread to avoid mutating the existing array — React needs new references
    // to detect state changes. This is immutable update pattern.
    let updatedFigures = [...game.figures];
    let winnerId: string | null = null;
    let phase: GamePhase = 'playing';

    if (action.type === 'PLACE') {
      // Move the selected figure from "available" to the board.
      updatedFigures = updatedFigures.map((f) =>
        f.instanceId === action.instanceId
          ? { ...f, status: 'placed' as const, position: action.position }
          : f,
      );
    } else if (action.type === 'MOVE') {
      // 1. Check if an opponent's piece occupies the target square (capture).
      const targetOccupant = getFigureAt(action.to.col, action.to.row, updatedFigures);
      if (targetOccupant && targetOccupant.playerId !== currentPlayer.id) {
        // Mark the captured piece as "taken" and remove its board position.
        updatedFigures = updatedFigures.map((f) =>
          f.instanceId === targetOccupant.instanceId
            ? { ...f, status: 'taken' as const, position: null }
            : f,
        );
      }

      // 2. Check win condition — did this move step off the board?
      if (isWinningMove(action.to, game.currentPlayerIndex, game.level)) {
        winnerId = currentPlayer.id;
        phase = 'finished';
        // The winning figure has left the board — mark it taken so it
        // no longer renders on the grid.
        updatedFigures = updatedFigures.map((f) =>
          f.instanceId === action.instanceId
            ? { ...f, status: 'taken' as const, position: null }
            : f,
        );
      } else {
        // Normal move — update the figure's position.
        updatedFigures = updatedFigures.map((f) =>
          f.instanceId === action.instanceId ? { ...f, position: action.to } : f,
        );
      }
    }

    // After a PLACE or MOVE, switch to the other player's turn.
    // TypeScript infers `0 | 1` here because of the explicit type annotation.
    const nextPlayerIndex: 0 | 1 = game.currentPlayerIndex === 0 ? 1 : 0;

    const updatedHistory = [...game.history, action];

    // ── Threefold repetition draw detection ────────────────────
    // Compute a position key from the new board state + next player.
    // If the same position has occurred 3 times during the game, it's a draw.
    const posKey = computePositionKey(
      updatedFigures,
      phase === 'finished' ? game.currentPlayerIndex : nextPlayerIndex,
    );
    const updatedHashes = [...game.positionHashes, posKey];

    let drawReason: 'repetition' | 'agreement' | null = null;
    if (phase === 'playing') {
      const count = updatedHashes.filter((h) => h === posKey).length;
      if (count >= 3) {
        phase = 'draw';
        drawReason = 'repetition';
      }
    }
    // ──────────────────────────────────────────────────────────

    set({
      game: {
        ...game,
        figures: updatedFigures,
        // Keep currentPlayerIndex on the winner so the UI can show who won.
        currentPlayerIndex: phase === 'finished' ? game.currentPlayerIndex : nextPlayerIndex,
        phase,
        winnerId,
        turnNumber: game.turnNumber + 1,
        // Append the action to the history log (enables future undo/replay).
        history: updatedHistory,
        positionHashes: updatedHashes,
        // Any move cancels a pending draw offer.
        drawOfferFrom: null,
        drawReason,
      },
      selectedInstanceId: null,
      validMoveTargets: [],
    });
  },

  resetSelection: () => set({ selectedInstanceId: null, validMoveTargets: [] }),

  forfeit: (playerId) => {
    const { game } = get();
    if (!game || game.phase !== 'playing') return;

    // The opponent of whoever forfeited wins.
    const opponentId = game.players.find((p) => p.id !== playerId)?.id ?? null;

    set({
      game: { ...game, phase: 'finished', winnerId: opponentId },
      selectedInstanceId: null,
      validMoveTargets: [],
    });
  },

  offerDraw: (playerId) => {
    const { game } = get();
    if (!game || game.phase !== 'playing') return;
    // Only the current player can offer a draw.
    if (game.players[game.currentPlayerIndex].id !== playerId) return;
    set({ game: { ...game, drawOfferFrom: playerId } });
  },

  acceptDraw: () => {
    const { game } = get();
    if (!game || game.phase !== 'playing' || !game.drawOfferFrom) return;
    set({
      game: { ...game, phase: 'draw', drawOfferFrom: null, drawReason: 'agreement' },
      selectedInstanceId: null,
      validMoveTargets: [],
    });
  },

  rejectDraw: () => {
    const { game } = get();
    if (!game || !game.drawOfferFrom) return;
    set({ game: { ...game, drawOfferFrom: null } });
  },

  tickTimer: () => {
    const { game } = get();
    if (!game || game.phase !== 'playing') return false;
    // Don't tick when a draw offer is pending.
    if (game.drawOfferFrom) return false;

    const idx = game.currentPlayerIndex;
    const newTimers: [number, number] = [...game.playerTimers];
    newTimers[idx] = Math.max(0, newTimers[idx] - 1);

    if (newTimers[idx] <= 0) {
      // Time-out: the opponent wins.
      const opponentId = game.players[idx === 0 ? 1 : 0].id;
      set({
        game: { ...game, playerTimers: newTimers, phase: 'finished', winnerId: opponentId },
        selectedInstanceId: null,
        validMoveTargets: [],
      });
      return true;
    }

    set({ game: { ...game, playerTimers: newTimers } });
    return false;
  },

  resetGame: () => set({ game: null, selectedInstanceId: null, validMoveTargets: [] }),
}));
