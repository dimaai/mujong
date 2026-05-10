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
import { createInitialFigures, getFigureAt, placeWalls, seededRng } from '../domain/board';
import { getValidMoves, getValidPlacements, isWinningMove } from '../domain/rules';
import { getEnvelope, removeItem, setEnvelope } from '../persistence/storage';
import { STORAGE_KEYS } from '../persistence/keys';

// ── In-progress game persistence (Step 10) ────────────────────
//
// We persist the live `GameState` to localStorage so a refresh,
// a tab close, or a relaunch from the iOS home screen can resume
// the same match. Implementation notes:
//
//   - The full `GameState` is the snapshot. It's already a plain
//     JSON-friendly shape (no functions, no class instances), so
//     `JSON.stringify`/`parse` round-trip cleanly.
//   - Writes are debounced via `requestIdleCallback` (falling back
//     to `setTimeout(0)`) so each move doesn't block the UI on
//     localStorage I/O. We coalesce: while a flush is pending,
//     additional changes don't enqueue another one — the flush
//     reads the *latest* state via `useGameStore.getState()`.
//   - Schema version: the envelope's `v` is compared to
//     `SNAPSHOT_VERSION` on read. Any mismatch deletes the entry
//     (no migration in v1, per the plan).

const SNAPSHOT_VERSION = 1;
let snapshotPending = false;

function flushSnapshot(): void {
  snapshotPending = false;
  const current = useGameStore.getState().game;
  // Only an actively-playing game is worth resuming. If it ended,
  // got drawn, or was torn down, drop the entry entirely.
  if (!current || current.phase !== 'playing') {
    removeItem(STORAGE_KEYS.gameSnapshot);
    return;
  }
  setEnvelope<GameState>(STORAGE_KEYS.gameSnapshot, current);
}

function scheduleSnapshot(): void {
  if (typeof window === 'undefined') return;
  if (snapshotPending) return;
  snapshotPending = true;
  const ric = (
    window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(flushSnapshot);
  } else {
    window.setTimeout(flushSnapshot, 0);
  }
}

/**
 * Returns true when a resumable game snapshot exists in localStorage.
 *
 * Purpose:      lets MainMenu decide whether to show "Resume game".
 * Inputs:       none
 * Outputs:      boolean
 * Side effects: deletes a stored envelope whose schema version no
 *               longer matches `SNAPSHOT_VERSION` (defensive cleanup).
 */
export function hasGameSnapshot(): boolean {
  const env = getEnvelope<GameState>(STORAGE_KEYS.gameSnapshot);
  if (env === null) return false;
  if (env.v !== SNAPSHOT_VERSION) {
    removeItem(STORAGE_KEYS.gameSnapshot);
    return false;
  }
  // A snapshot of a finished game shouldn't have been written, but
  // if one slipped through (e.g. older code), don't offer to resume it.
  if (env.data?.phase !== 'playing') {
    removeItem(STORAGE_KEYS.gameSnapshot);
    return false;
  }
  return true;
}

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
 * One entry per applied action — both local and remote — appended
 * in the order the rules engine processed them. Step 17 only
 * writes to it; Step 20's `getActionsSince(seq)` will read from
 * it to satisfy `RESYNC_REQ`. `seq` is a per-store counter that
 * advances in lockstep on both peers, so identical positions on
 * each side end up with identical seqs.
 */
export interface ActionLogEntry {
  seq: number;
  turnNumber: number;
  action: TurnAction;
}

/**
 * Callback registered by the network layer to ship a locally-
 * applied action over the DataChannel. Lives at module scope so
 * `gameStore` does NOT import `netStore` (which would create a
 * cycle: netStore already imports gameStore). Exactly one
 * broadcaster is active at a time; clearing it (pass `null`) is
 * the teardown contract used by `endNetworkSession()`.
 */
export type ActionBroadcaster = (entry: ActionLogEntry) => void;
let actionBroadcaster: ActionBroadcaster | null = null;
export function setActionBroadcaster(cb: ActionBroadcaster | null): void {
  actionBroadcaster = cb;
}

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
  /**
   * 'local'   — both players use this device (default; Phase A–F).
   * 'network' — moves round-trip through the peer DataChannel and
   *             only `localPlayerIndex` may interact (Step 17).
   */
  mode: 'local' | 'network';
  /**
   * Which `players[]` slot belongs to this device when `mode ===
   * 'network'`. Null in local play.
   */
  localPlayerIndex: 0 | 1 | null;
  /**
   * Append-only log of every applied action, in order. Used by
   * Step 20's resync; written here so we don't grow a second copy
   * of `history` later.
   */
  actionLog: ActionLogEntry[];

  // Actions
  /**
   * Initializes a brand-new game session from the user's persisted
   * settings + profiles (Step 7).
   *
   * @param args.options  - the live `GameOptions` from `useSettingsStore`
   *                        (difficulty, boardSizeId, timer, againstView, walls)
   * @param args.profiles - tuple `[player1Profile, player2Profile]` from
   *                        `useProfileStore` (name + color)
   * @param args.seed     - (Step 16) optional shared seed used to derive
   *                        `gameId` deterministically so a host + joiner
   *                        produce byte-identical `GameState`. Future RNG
   *                        (e.g. randomised wall layouts) will key off it too.
   *
   * Side effects: replaces the current `game` with a fresh `GameState`.
   */
  startGame: (args: {
    options: GameOptions;
    profiles: [Profile, Profile];
    seed?: string;
    /** Defaults to 'local'. Pass 'network' from the netStore. */
    mode?: 'local' | 'network';
    /** Required when `mode === 'network'`; ignored otherwise. */
    localPlayerIndex?: 0 | 1;
  }) => void;

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
   *
   * Step 17 splits the entry point by `source`:
   *   - 'local'  (default): the local user just clicked. In
   *               network mode this requires it to be the local
   *               player's turn; on success the action is also
   *               broadcast over the DataChannel.
   *   - 'remote': came in over the wire via `applyRemoteAction`
   *               and was already validated. We never re-broadcast.
   *
   * The reducer body is unchanged — only the entry guard differs.
   */
  executeAction: (
    action: TurnAction,
    opts?: { source?: 'local' | 'remote' },
  ) => void;

  /**
   * Step 17: receive an ACTION from the peer. Validates that it
   * matches the expected turn (a defensive double-check on top of
   * the netStore's seq/sender validation) and dispatches through
   * the same reducer path as a local move.
   *
   * @returns true when the action was applied; false on any
   *          mismatch (logged by the caller).
   */
  applyRemoteAction: (entry: { action: TurnAction; turnNumber: number }) => boolean;

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

  /**
   * The opponent accepts the pending draw offer.
   *
   * `opts.source = 'remote'` bypasses the network-mode gate that
   * normally forbids the offerer from accepting their own offer.
   * It is used by `netStore` when applying a `DRAW_RESPONSE` from
   * the peer (the offerer's own store must end the game on accept).
   */
  acceptDraw: (opts?: { source?: 'local' | 'remote' }) => void;

  /** The opponent rejects the pending draw offer. */
  rejectDraw: () => void;

  /**
   * Decrements the active player's timer by 1 second.
   * @returns true when the timer hits 0 (time-out loss)
   */
  tickTimer: () => boolean;

  /** Tears down the current game so the setup screen is shown again. */
  resetGame: () => void;

  /**
   * Step 10: rehydrate the live game from the localStorage snapshot.
   * Called by /play on mount when there's no in-memory game (e.g. the
   * user refreshed mid-match or relaunched the PWA).
   *
   * @returns true if a valid snapshot was loaded into the store,
   *          false otherwise (caller should redirect home).
   * Side effects: sets `game` (and clears selection) on success;
   *               deletes a stale/invalid snapshot on failure.
   */
  hydrateFromSnapshot: () => boolean;
}

// ── Store implementation ──────────────────────────────────────

export const useGameStore = create<GameStore>((set, get) => ({
  game: null,
  selectedInstanceId: null,
  validMoveTargets: [],
  mode: 'local',
  localPlayerIndex: null,
  actionLog: [],

  startGame: ({ options, profiles, seed, mode = 'local', localPlayerIndex }) => {
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
    // In network mode we feed `placeWalls` a seeded RNG so both
    // peers compute identical wall positions from the shared `seed`.
    const wallsRng = seed ? seededRng(`walls:${seed}`) : Math.random;
    const walls = options.walls
      ? placeWalls(sizePreset.width, sizePreset.height, wallsRng)
      : [];

    const timerSeconds = options.timerMinutes * 60;

    const newGame: GameState = {
      // Deterministic when `seed` is supplied so a networked host +
      // joiner end up with byte-identical state (Step 16).
      gameId: seed ? `game_${seed}` : `game_${Date.now()}`,
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

    set({
      game: newGame,
      selectedInstanceId: null,
      validMoveTargets: [],
      mode,
      // Only meaningful in network mode; explicit null in local play
      // so a stale value from a previous networked match can't leak.
      localPlayerIndex: mode === 'network' ? (localPlayerIndex ?? 0) : null,
      actionLog: [],
    });
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

  executeAction: (action, opts) => {
    const source = opts?.source ?? 'local';
    const { game, mode, localPlayerIndex, actionLog } = get();
    if (!game || game.phase !== 'playing') return;

    // Network-mode guard: a local click during the opponent's turn
    // must NOT mutate state — the UI also blocks it, but we double-
    // gate here so a stray dispatch from a future codepath can't
    // desync the boards.
    if (
      source === 'local' &&
      mode === 'network' &&
      localPlayerIndex !== null &&
      game.currentPlayerIndex !== localPlayerIndex
    ) {
      return;
    }

    // Captured BEFORE the reducer runs so the broadcast carries
    // the turnNumber the action represents (not the next one).
    const turnNumberOfAction = game.turnNumber;

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

    const newEntry: ActionLogEntry = {
      seq: actionLog.length,
      turnNumber: turnNumberOfAction,
      action,
    };

    // Broadcast BEFORE applying the local set(): the gameStore phase
    // change triggers netStore listeners that can tear the peer
    // down (on game-end). If we broadcast AFTER set, a winning
    // ACTION can lose the race against a teardown-driven BYE and
    // arrive after the channel is closed — leaving the opponent
    // without the final move.
    if (source === 'local' && mode === 'network' && actionBroadcaster) {
      try {
        actionBroadcaster(newEntry);
      } catch {
        // Transport failures don't roll back the local state — the
        // peer will request a resync via Step 20 once it reconnects.
      }
    }

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
      actionLog: [...actionLog, newEntry],
    });
  },

  applyRemoteAction: ({ action, turnNumber }) => {
    const { game, mode, localPlayerIndex } = get();
    if (!game || game.phase !== 'playing') return false;
    if (mode !== 'network' || localPlayerIndex === null) return false;
    // Defensive: must be the opponent's turn AND the turnNumber
    // they claim must match ours. A mismatch means the boards have
    // already drifted; Step 20 will recover via RESYNC_REQ.
    if (game.currentPlayerIndex === localPlayerIndex) return false;
    if (turnNumber !== game.turnNumber) return false;

    get().executeAction(action, { source: 'remote' });
    return true;
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

  acceptDraw: (opts) => {
    const source = opts?.source ?? 'local';
    const { game, mode, localPlayerIndex } = get();
    if (!game || game.phase !== 'playing' || !game.drawOfferFrom) return;
    // In a networked game only the OPPONENT of the offerer may
    // accept locally. Remote-source calls bypass this gate because
    // they apply the peer's decision (and on the offerer's side,
    // `drawOfferFrom` IS the local player — exactly the case the
    // gate would otherwise block).
    if (source === 'local' && mode === 'network' && localPlayerIndex !== null) {
      const localId = game.players[localPlayerIndex].id;
      if (game.drawOfferFrom === localId) return;
    }
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

  resetGame: () =>
    set({
      game: null,
      selectedInstanceId: null,
      validMoveTargets: [],
      mode: 'local',
      localPlayerIndex: null,
      actionLog: [],
    }),

  hydrateFromSnapshot: () => {
    const env = getEnvelope<GameState>(STORAGE_KEYS.gameSnapshot);
    if (env === null) return false;
    if (env.v !== SNAPSHOT_VERSION) {
      removeItem(STORAGE_KEYS.gameSnapshot);
      return false;
    }
    if (!env.data || env.data.phase !== 'playing') {
      removeItem(STORAGE_KEYS.gameSnapshot);
      return false;
    }
    set({
      game: env.data,
      selectedInstanceId: null,
      validMoveTargets: [],
    });
    return true;
  },
}));

// ── Auto-snapshot subscription (Step 10) ──────────────────────
//
// One module-level subscription writes the snapshot whenever the
// `game` slice changes. Putting this *outside* every action keeps
// the actions readable: they don't have to remember to call a
// snapshot helper, and we have a single chokepoint where the
// debounce + clear-on-end policy lives. The flush itself reads
// the latest state via `getState()`, so this works even when many
// rapid mutations fire in the same tick.
if (typeof window !== 'undefined') {
  let lastGame: GameState | null = useGameStore.getState().game;
  useGameStore.subscribe((state) => {
    if (state.game === lastGame) return;
    lastGame = state.game;
    scheduleSnapshot();
  });
}
