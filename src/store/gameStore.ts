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
  Player,
  Level,
  Position,
  TurnAction,
  PlayerFigureInstance,
} from '../domain/types';
import { FIGURE_TYPE_MAP } from '../data/figuretypes';
import { createInitialFigures, getFigureAt } from '../domain/board';
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
   * Initializes a brand-new game session.
   * @param level   - the chosen level (board size, allowed figures, colors)
   * @param player1 - bottom player (moves toward row 0)
   * @param player2 - top player    (moves toward last row)
   */
  startGame: (level: Level, player1: Player, player2: Player) => void;

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

  /** Tears down the current game so the setup screen is shown again. */
  resetGame: () => void;
}

// ── Store implementation ──────────────────────────────────────

export const useGameStore = create<GameStore>((set, get) => ({
  game: null,
  selectedInstanceId: null,
  validMoveTargets: [],

  startGame: (level, player1, player2) => {
    // createInitialFigures builds all PlayerFigureInstances for both players.
    // All start with status "available" and position null.
    const figures = createInitialFigures(level, [player1, player2], DEFAULT_SKIN_MAP);

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

    // getValidPlacements returns unoccupied squares on the player's starting row.
    const placements = getValidPlacements(
      game.currentPlayerIndex,
      game.figures,
      game.level,
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

    if (phase === 'playing') {
      const count = updatedHashes.filter((h) => h === posKey).length;
      if (count >= 3) {
        phase = 'draw';
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

  resetGame: () => set({ game: null, selectedInstanceId: null, validMoveTargets: [] }),
}));
