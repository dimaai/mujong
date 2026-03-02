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

import React from 'react';
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
  } = useGameStore();

  // If no game is running, show a placeholder (GameSetup handles this case).
  if (!game) {
    return <div className={styles.empty}>No game in progress.</div>;
  }

  const { level, players, currentPlayerIndex, figures, phase, winnerId } = game;
  const currentPlayer = players[currentPlayerIndex];

  /**
   * handleCellClick is called when the user clicks an empty (or highlighted) cell.
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
      {/* ── Middle row: panels + board ───────────────────────── */}
      <div className={styles.middle}>
        {/* Left panel: Player 1's figures */}
        <FigurePanel
          playerId={players[0].id}
          playerName={players[0].name}
          playerColor={PlayerColors[players[0].id]}
          figures={figures}
          isActive={currentPlayerIndex === 0 && phase === 'playing'}
          selectedInstanceId={selectedInstanceId}
          onSelectFigure={selectAvailableFigure}
        />

        {/* Center: board + optional winner banner */}
        <div className={styles.boardWrapper}>
          {phase === 'finished' && winnerId && (
            <div className={styles.winnerBanner}>
              🏆 {players.find((p) => p.id === winnerId)?.name} wins!
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
            selectedInstanceId={selectedInstanceId}
            validMoveTargets={validMoveTargets}
            onCellClick={handleCellClick}
            onFigureClick={handleFigureClick}
          />
        </div>

        {/* Right panel: Player 2's figures */}
        <FigurePanel
          playerId={players[1].id}
          playerName={players[1].name}
          playerColor={level.player2Color}
          figures={figures}
          isActive={currentPlayerIndex === 1 && phase === 'playing'}
          selectedInstanceId={selectedInstanceId}
          onSelectFigure={selectAvailableFigure}
        />
      </div>

    </div>
  );
}
