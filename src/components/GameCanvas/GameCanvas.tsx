// ============================================================
// src/components/GameCanvas/GameCanvas.tsx
//
// PURPOSE: The main game layout — the only component that talks
// to the Zustand store. It reads state and dispatches actions,
// then passes everything down to Board and PlayerPanel as props.
//
// Layout (top to bottom):
//   ┌────────────────────────────┐
//   │  Player 2 panel (top)      │  ← enlarged when P2's turn
//   ├────────────────────────────┤
//   │         Board              │
//   ├────────────────────────────┤
//   │  Player 1 panel (bottom)   │  ← enlarged when P1's turn
//   └────────────────────────────┘
// ============================================================

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { Board } from '../Board/Board';
import { PlayerPanel } from '../PlayerPanel/PlayerPanel';
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
    offerDraw,
    acceptDraw,
    rejectDraw,
    tickTimer,
  } = useGameStore();

  // If no game is running, show a placeholder (GameSetup handle this case).
  if (!game) {
    return <div className={styles.empty}>No game in progress.</div>;
  }

  const { level, players, currentPlayerIndex, figures, phase, winnerId, drawOfferFrom, playerTimers } = game;
  const currentPlayer = players[currentPlayerIndex];

  // ── Responsive cell size ──────────────────────────────────
  // Vertical layout: P2 panel + board + P1 panel + banner area.
  //
  // Height budget (in cell-size units):
  //   board grid:    boardHeight
  //   enlarged panel: +1    (active player)
  //   minimized panel: +0.333 (inactive player)
  //   banner/padding: ~40px fixed
  //
  // Width budget: just the board width + small padding.
  const [cellSize, setCellSize] = useState(64);

  useEffect(() => {
    const compute = () => {
      const availH = window.innerHeight - 40;
      const availW = window.innerWidth - 32;
      // Total cell-units vertically: board + both panels (no finish zones)
      const cellUnitsH = level.boardHeight + 1 + 1 / 3;
      const fromHeight = Math.floor(availH / cellUnitsH);
      const fromWidth = Math.floor(availW / level.boardWidth);
      setCellSize(Math.max(24, Math.min(fromHeight, fromWidth)));
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [level.boardWidth, level.boardHeight]);
  // ────────────────────────────────────────────────────────────

  // ── Per-player countdown timers ─────────────────────────
  // Each player's timer counts down only when it's their turn.
  // timers are stored in the Zustand store; tickTimer() decrements.
  // Timer is paused when a draw offer is pending or timerMinutes === 0.
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasTimer = level.timerMinutes > 0;

  useEffect(() => {
    // Start ticking after the first move, only when timer is enabled.
    if (hasTimer && game.history.length > 0 && phase === 'playing' && !drawOfferFrom) {
      if (!intervalRef.current) {
        intervalRef.current = setInterval(() => {
          tickTimer();
        }, 1000);
      }
    } else {
      // Pause: game ended, draw offer pending, or no timer.
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hasTimer, game.history.length, phase, drawOfferFrom, tickTimer]);

  // When the game is over, any key press or tap anywhere returns to main menu.
  useEffect(() => {
    if (phase !== 'finished' && phase !== 'draw') return;

    const back = () => resetGame();
    window.addEventListener('keydown', back);
    return () => window.removeEventListener('keydown', back);
  }, [phase, resetGame]);
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

  // +4 accounts for the board's 2px border on each side
  const boardPixelWidth = level.boardWidth * cellSize + 4;
  const p1Timer = hasTimer ? formatTime(playerTimers[0]) : '';
  const p2Timer = hasTimer ? formatTime(playerTimers[1]) : '';

  // Player 1 (bottom, index 0) is enlarged when it's their turn.
  // Player 2 (top, index 1) is enlarged when it's their turn.
  const p1Enlarged = currentPlayerIndex === 0;
  const p2Enlarged = currentPlayerIndex === 1;

  // Winning move targets: positions beyond the board that the panels absorb.
  // Player 0 wins by crossing the top (row < 0) → P2's panel (top) is the target.
  // Player 1 wins by crossing the bottom (row >= boardHeight) → P1's panel (bottom) is the target.
  const topPanelWinTargets = validMoveTargets.filter((p) => p.row < 0);
  const bottomPanelWinTargets = validMoveTargets.filter(
    (p) => p.row >= level.boardHeight,
  );

  const gameOver = phase === 'finished' || phase === 'draw';

  return (
    <div
      className={styles.canvas}
      onClick={gameOver ? resetGame : undefined}
      style={gameOver ? { cursor: 'pointer' } : undefined}
    >
      {/* Winner / draw banner */}
      {phase === 'finished' && winnerId && (
        <div className={styles.winnerBanner}>
          🏆 {players.find((p) => p.id === winnerId)?.name} wins!
        </div>
      )}
      {phase === 'draw' && (
        <div className={styles.drawBanner}>
          {game.drawReason === 'repetition' ? '🤝 Draw — repeated moves' : "🤝 It's a Draw!"}
        </div>
      )}

      {/* ── Main vertical stack ────────────────────────────── */}
      <div className={styles.stack}>
        {/* Player 2 panel (top) */}
        <PlayerPanel
          playerId={players[1].id}
          playerName={players[1].name}
          playerColor={PlayerColors[players[1].id]}
          figures={figures}
          isActive={currentPlayerIndex === 1 && phase === 'playing'}
          isEnlarged={p2Enlarged}
          selectedInstanceId={selectedInstanceId}
          onSelectFigure={selectAvailableFigure}
          onGiveUp={() => forfeit(players[1].id)}
          onOfferDraw={() => offerDraw(players[1].id)}
          onAcceptDraw={acceptDraw}
          onRejectDraw={rejectDraw}
          drawOfferFrom={drawOfferFrom}
          onExit={resetGame}
          timer={p2Timer}
          cellSize={cellSize}
          boardPixelWidth={boardPixelWidth}
          isPlaying={phase === 'playing'}
          winTargets={topPanelWinTargets}
          onWinClick={handleCellClick}
        />

        {/* Board */}
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

        {/* Player 1 panel (bottom) */}
        <PlayerPanel
          playerId={players[0].id}
          playerName={players[0].name}
          playerColor={PlayerColors[players[0].id]}
          figures={figures}
          isActive={currentPlayerIndex === 0 && phase === 'playing'}
          isEnlarged={p1Enlarged}
          selectedInstanceId={selectedInstanceId}
          onSelectFigure={selectAvailableFigure}
          onGiveUp={() => forfeit(players[0].id)}
          onOfferDraw={() => offerDraw(players[0].id)}
          onAcceptDraw={acceptDraw}
          onRejectDraw={rejectDraw}
          drawOfferFrom={drawOfferFrom}
          winTargets={bottomPanelWinTargets}
          onWinClick={handleCellClick}
          onExit={resetGame}
          timer={p1Timer}
          cellSize={cellSize}
          boardPixelWidth={boardPixelWidth}
          isPlaying={phase === 'playing'}
        />
      </div>
    </div>
  );
}
