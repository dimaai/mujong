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
    mode,
    localPlayerIndex,
  } = useGameStore();

  // ── All hooks MUST be declared before any conditional return ──
  // React requires hooks to be called in the same order on every
  // render. Placing them after an early return violates this rule
  // and causes leaked intervals / event listeners between games.

  const [cellSize, setCellSize] = useState(64);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Responsive cell size ──────────────────────────────────
  useEffect(() => {
    if (!game) return;
    const { level, phase } = game;
    const hasTimer = level.timerMinutes > 0;

    const compute = () => {
      const bannerReserve = phase === 'finished' || phase === 'draw' ? 56 : 0;
      const availH = window.innerHeight - bannerReserve;
      const availW = window.innerWidth - 32;
      const cellUnitsH = level.boardHeight + 1 + 0.5;
      const fromHeight = Math.floor(availH / cellUnitsH);
      const widthGapsPx = level.boardWidth - 1;
      const timerUnits = hasTimer ? 0.4 : 0;
      const widthUnits = level.boardWidth + timerUnits;
      const fromWidth = Math.floor((availW - widthGapsPx) / widthUnits);
      setCellSize(Math.max(24, Math.min(fromHeight, fromWidth)));
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [game]);
  // ────────────────────────────────────────────────────────────

  // ── Per-player countdown timers ─────────────────────────
  useEffect(() => {
    if (!game) return;
    const hasTimer = game.level.timerMinutes > 0;

    if (hasTimer && game.history.length > 0 && game.phase === 'playing' && !game.drawOfferFrom) {
      if (!intervalRef.current) {
        intervalRef.current = setInterval(() => {
          tickTimer();
        }, 1000);
      }
    } else {
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
  }, [game, tickTimer]);

  // When the game is over, any key press returns to main menu.
  useEffect(() => {
    if (!game) return;
    if (game.phase !== 'finished' && game.phase !== 'draw') return;

    const back = () => resetGame();
    window.addEventListener('keydown', back);
    return () => window.removeEventListener('keydown', back);
  }, [game, resetGame]);

  // Close the sandwich menu when the turn changes or game phase changes.
  useEffect(() => {
    setMenuOpenFor(null);
  }, [game?.currentPlayerIndex, game?.phase]);

  // ── Early return AFTER all hooks ──────────────────────────
  if (!game) {
    return <div className={styles.empty}>No game in progress.</div>;
  }

  const { level, players, currentPlayerIndex, figures, walls, phase, winnerId, drawOfferFrom, playerTimers, againstView } = game;
  const currentPlayer = players[currentPlayerIndex];
  const hasTimer = level.timerMinutes > 0;

  // Step 17: in a networked game we render BOTH players' panels but
  // only the local player may interact. Compute the gate once and
  // thread it through the click handlers + panel `isActive` props.
  const isNetwork = mode === 'network' && localPlayerIndex !== null;
  const isOpponentTurn = isNetwork && currentPlayerIndex !== localPlayerIndex;
  // ────────────────────────────────────────────────────────────

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
    if (isOpponentTurn) return;
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
    if (isOpponentTurn) return;
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

  // +gaps: 1px gap between each column = (boardWidth - 1) extra pixels
  const boardPixelWidth = level.boardWidth * cellSize + (level.boardWidth - 1);
  const boardPixelHeight = level.boardHeight * cellSize + (level.boardHeight - 1);

  // Timer bar percentages (0–100)
  const totalTimerSec = level.timerMinutes * 60;
  const p1TimerPct = totalTimerSec > 0 ? (playerTimers[0] / totalTimerSec) * 100 : 100;
  const p2TimerPct = totalTimerSec > 0 ? (playerTimers[1] / totalTimerSec) * 100 : 100;
  const timerBarW = Math.round(cellSize / 5);

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

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

      {/* Step 17: subtle hint while waiting for the remote player. */}
      {isOpponentTurn && phase === 'playing' && (
        <span
          style={{
            position: 'absolute',
            top: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '4px 10px',
            borderRadius: 12,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            fontSize: 12,
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          Opponent’s turn…
        </span>
      )}

      {/* ── Main vertical stack ────────────────────────────── */}
      <div className={styles.stack}>
        {/* Player 2 panel (top) — full width including timer bar areas */}
        <PlayerPanel
          playerId={players[1].id}
          playerName={players[1].name}
          playerColor={PlayerColors[players[1].id]}
          figures={figures}
          isActive={currentPlayerIndex === 1 && phase === 'playing' && !isOpponentTurn}
          isEnlarged={p2Enlarged}
          selectedInstanceId={selectedInstanceId}
          onSelectFigure={selectAvailableFigure}
          onMenuToggle={() => setMenuOpenFor((p) => p === players[1].id ? null : players[1].id)}
          cellSize={cellSize}
          boardPixelWidth={hasTimer ? boardPixelWidth + timerBarW * 2 : boardPixelWidth}
          isPlaying={phase === 'playing'}
          winTargets={topPanelWinTargets}
          onWinClick={handleCellClick}
          flipped={againstView}
        />

        {/* Board row: timer bar | board + overlays | timer bar */}
        <div className={styles.boardRow}>
          {/* P1 Timer bar — left side */}
          {hasTimer && (
            <div
              className={styles.timerBar}
              style={{ width: timerBarW, height: boardPixelHeight }}
            >
              <div
                className={styles.timerBarFill}
                style={{
                  bottom: 0,
                  height: `${p1TimerPct}%`,
                  background: PlayerColors[players[0].id] + '80',
                }}
              />
              <span className={styles.timerText}>{formatTime(playerTimers[0])}</span>
            </div>
          )}

          {/* Board area with overlays */}
          <div className={styles.boardWrapper} style={{ width: boardPixelWidth, height: boardPixelHeight }}>
            <Board
              level={level}
              figures={figures}
              walls={walls}
              playerColors={PlayerColors}
              cellSize={cellSize}
              selectedInstanceId={selectedInstanceId}
              validMoveTargets={validMoveTargets}
              onCellClick={handleCellClick}
              onFigureClick={handleFigureClick}
            />

            {/* Sandwich-menu overlay */}
            {menuOpenFor && phase === 'playing' && (
              <>
                <div className={styles.menuBackdrop} onClick={() => setMenuOpenFor(null)} />
                <div
                  className={styles.menuPanel}
                  style={{
                    width: boardPixelWidth,
                    height: Math.round(boardPixelHeight / 3),
                    ...(menuOpenFor === players[0].id ? { bottom: 0 } : { top: 0 }),
                  }}
                >
                  <span className={styles.menuPlayerName}>
                    {menuOpenFor === players[0].id ? players[0].name : players[1].name}
                  </span>
                  <div className={styles.menuButtons}>
                    <button
                      className={styles.menuBtn}
                      onClick={() => { forfeit(menuOpenFor); setMenuOpenFor(null); }}
                    >
                      Give Up
                    </button>
                    <button
                      className={styles.menuBtn}
                      onClick={() => { offerDraw(menuOpenFor); setMenuOpenFor(null); }}
                    >
                      Offer Draw
                    </button>
                    <button
                      className={styles.menuBtn}
                      onClick={() => { resetGame(); }}
                    >
                      Exit Game
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* Draw response panel (opponent accepts / declines) */}
            {drawOfferFrom && phase === 'playing' && !menuOpenFor && (
              <div
                className={styles.drawPanel}
                style={{
                  width: boardPixelWidth,
                  height: cellSize * 2,
                  ...(drawOfferFrom === players[0].id ? { top: 0 } : { bottom: 0 }),
                }}
              >
                <span className={styles.drawPanelText}>Draw offered</span>
                <div className={styles.drawPanelButtons}>
                  <button className={styles.menuBtn} onClick={acceptDraw}>
                    Accept
                  </button>
                  <button className={styles.menuBtn} onClick={rejectDraw}>
                    Decline
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* P2 Timer bar — right side */}
          {hasTimer && (
            <div
              className={styles.timerBar}
              style={{ width: timerBarW, height: boardPixelHeight }}
            >
              <div
                className={styles.timerBarFill}
                style={{
                  top: 0,
                  height: `${p2TimerPct}%`,
                  background: PlayerColors[players[1].id] + '80',
                }}
              />
              <span className={styles.timerText}>{formatTime(playerTimers[1])}</span>
            </div>
          )}
        </div>

        {/* Player 1 panel (bottom) — full width including timer bar areas */}
        <PlayerPanel
          playerId={players[0].id}
          playerName={players[0].name}
          playerColor={PlayerColors[players[0].id]}
          figures={figures}
          isActive={currentPlayerIndex === 0 && phase === 'playing' && !isOpponentTurn}
          isEnlarged={p1Enlarged}
          selectedInstanceId={selectedInstanceId}
          onSelectFigure={selectAvailableFigure}
          onMenuToggle={() => setMenuOpenFor((p) => p === players[0].id ? null : players[0].id)}
          cellSize={cellSize}
          boardPixelWidth={hasTimer ? boardPixelWidth + timerBarW * 2 : boardPixelWidth}
          isPlaying={phase === 'playing'}
          winTargets={bottomPanelWinTargets}
          onWinClick={handleCellClick}
        />
      </div>
    </div>
  );
}
