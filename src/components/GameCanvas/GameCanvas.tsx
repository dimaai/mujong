// ============================================================
// src/components/GameCanvas/GameCanvas.tsx
//
// PURPOSE: The main game layout — the only component that talks
// to the Zustand store. It reads state and dispatches actions,
// then passes everything down to Board and FigurePanel as props.
//
// Layout (top to bottom):
//   ┌────────────────────────────┐
//   │  Color strip (Player 2)    │  ← thin accent bar
//   ├──────┬──────────────┬──────┤
//   │ P1   │    Board     │  P2  │  ← side panels + board
//   │panel │              │panel │
//   ├──────┴──────────────┴──────┤
//   │  Color strip (Player 1)    │  ← thin accent bar
//   └────────────────────────────┘
// ============================================================

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { Board } from '../Board/Board';
import { FigurePanel } from '../FigurePanel/FigurePanel';
import type { Position, TurnAction } from '../../domain/types';
import styles from './GameCanvas.module.css';

/**
 * GameCanvas orchestrates the game view.
 * It reads from Zustand and routes user interactions to store actions.
 *
 * Inputs:  none — all data comes from useGameStore()
 * Outputs: rendered game UI
 * Side effects: calls store actions which trigger re-renders
 */
export function GameCanvas() {
  // Destructure only what we need — Zustand only re-renders this component
  // when one of these specific values changes.
  const {
    game,
    selectedInstanceId,
    validMoveTargets,
    selectFigure,
    selectAvailableFigure,
    executeAction,
    resetSelection,
    resetGame,
    forfeit,
  } = useGameStore();

  // If no game is running, show a placeholder (GameSetup handles this case).
  if (!game) {
    return <div className={styles.empty}>No game in progress.</div>;
  }

  const { level, players, currentPlayerIndex, figures, phase, winnerId } = game;
  const currentPlayer = players[currentPlayerIndex];

  // ── Responsive cell size ──────────────────────────────────
  // window.innerWidth/Height are the only values guaranteed to change in
  // BOTH directions for any resize. Element-based observers miss expansions
  // when the observed element's width is content-driven (not layout-driven).
  //
  // Reserved space deductions:
  //   height: 48px  — turn label (~20px) + canvas padding (16px) + gaps
  //   width:  220px — two side panels (≈2×88px) + gaps (2×16px) + margins
  //
  // The finish zones add 0.28 of a cell above AND below the board (total +0.56),
  // so total board height in cells = boardHeight + 0.56.
  const [cellSize, setCellSize] = useState(64);

  useEffect(() => {
    const compute = () => {
      const availH = window.innerHeight - 48;
      const availW = window.innerWidth  - 220;
      const fromHeight = Math.floor(availH / (level.boardHeight + 0.56));
      const fromWidth  = Math.floor(availW / level.boardWidth);
      setCellSize(Math.max(24, Math.min(fromHeight, fromWidth)));
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [level.boardWidth, level.boardHeight]);
  // ────────────────────────────────────────────────────────────

  // ── Timer ─────────────────────────────────────────────────
  // Starts on the first move (history.length > 0), stops when the game ends.
  // intervalRef holds the setInterval ID so we can clear it on demand.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (game.history.length > 0 && phase === 'playing' && !intervalRef.current) {
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    }
    if (phase !== 'playing' && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [game.history.length, phase]);

  // Clear on unmount (e.g. New Game / Give Up resets the store, unmounting this component).
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
  // ────────────────────────────────────────────────────────────

  /**
   * formatTime turns elapsed seconds into a MM:SS string.
   */
  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  /** is called when the user clicks an empty (or highlighted) cell.
   *
   * Flow:
   *   1. If nothing is selected, do nothing.
   *   2. If the cell is not a valid target, deselect.
   *   3. If the selected figure is "available", dispatch a PLACE action.
   *   4. If the selected figure is "placed", dispatch a MOVE action.
   *
   * @param pos - the board position that was clicked
   */
  function handleCellClick(pos: Position) {
    if (!selectedInstanceId) return;

    // Check membership in O(1) using .some() on the pre-computed targets array.
    const isValidTarget = validMoveTargets.some(
      (t) => t.col === pos.col && t.row === pos.row,
    );

    if (!isValidTarget) {
      resetSelection();
      return;
    }

    const instance = figures.find((f) => f.instanceId === selectedInstanceId);
    if (!instance) return;

    let action: TurnAction;

    if (instance.status === 'available') {
      // First time placing this piece on the board.
      action = { type: 'PLACE', instanceId: selectedInstanceId, position: pos };
    } else {
      // Moving a piece that's already on the board.
      // instance.position is guaranteed non-null because status === 'placed'.
      action = {
        type: 'MOVE',
        instanceId: selectedInstanceId,
        from: instance.position!,
        to: pos,
      };
    }

    executeAction(action);
  }

  /**
   * handleFigureClick is called when a placed figure on the board is clicked.
   * Clicking an already-selected figure deselects it (toggle behaviour).
   *
   * @param instanceId - the clicked figure's instance id
   */
  function handleFigureClick(instanceId: string) {
    if (selectedInstanceId === instanceId) {
      resetSelection(); // toggle off
    } else {
      selectFigure(instanceId);
    }
  }
  
  const PlayerColors: Record<string, string> = {
    [players[0].id]: level.player1Color,
    [players[1].id]: level.player2Color,
  };

  return (
    <div className={styles.canvas}>
      {/* ── Middle row: left col + board + right col ────────── */}
      <div className={styles.middle}>

        {/* ── Left column: New Game + Player 1 panel + Give Up ── */}
        <div className={styles.sideCol}>
          <button className={styles.newGameBtn} onClick={resetGame}>
            ← New Game
          </button>
          <FigurePanel
            playerId={players[0].id}
            playerName={players[0].name}
            playerColor={PlayerColors[players[0].id]}
            figures={figures}
            isActive={currentPlayerIndex === 0 && phase === 'playing'}
            selectedInstanceId={selectedInstanceId}
            onSelectFigure={selectAvailableFigure}
          />
          {phase === 'playing' && (
            <button
              className={styles.giveUpBtn}
              style={{ color: PlayerColors[players[0].id], borderColor: PlayerColors[players[0].id] }}
              onClick={() => forfeit(players[0].id)}
            >
              Give up
            </button>
          )}
        </div>

        {/* ── Center: board + optional winner banner ─────────── */}
        <div className={styles.boardWrapper}>
          {phase === 'finished' && winnerId && (
            <div className={styles.winnerBanner}>
              🏆 {players.find((p) => p.id === winnerId)?.name} wins!
            </div>
          )}
          {phase === 'draw' && (
            <div className={styles.drawBanner}>
              🤝 Draw — repeated moves
            </div>
          )}
          {phase === 'playing' && (
            <div className={styles.turnLabel} style={{ color: currentPlayer.id === players[0].id ? level.player1Color : level.player2Color }}>
              {currentPlayer.name}&apos;s turn
            </div>
          )}
          <Board
            level={level}
            figures={figures}
            playerColors={PlayerColors}
            cellSize={cellSize}
            selectedInstanceId={selectedInstanceId}
            validMoveTargets={validMoveTargets}
            onCellClick={handleCellClick}
            onFigureClick={handleFigureClick}
          />
        </div>

        {/* ── Right column: Timer + Player 2 panel + Give Up ─── */}
        <div className={styles.sideCol}>
          <div
            className={styles.timer}
            style={{ color: PlayerColors[players[1].id] }}
          >
            {formatTime(elapsed)}
          </div>
          <FigurePanel
            playerId={players[1].id}
            playerName={players[1].name}
            playerColor={PlayerColors[players[1].id]}
            figures={figures}
            isActive={currentPlayerIndex === 1 && phase === 'playing'}
            selectedInstanceId={selectedInstanceId}
            onSelectFigure={selectAvailableFigure}
          />
          {phase === 'playing' && (
            <button
              className={styles.giveUpBtn}
              style={{ color: PlayerColors[players[1].id], borderColor: PlayerColors[players[1].id] }}
              onClick={() => forfeit(players[1].id)}
            >
              Give up
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
