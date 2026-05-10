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
import { useNetStore } from '../../store/netStore';
import { Board } from '../Board/Board';
import { PlayerPanel } from '../PlayerPanel/PlayerPanel';
import { ReconnectOverlay } from '../Network/ReconnectOverlay';
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

  // Step 18: connection-quality pill. We subscribe per-field so a
  // store update on, say, `peerProfile` doesn't repaint the pill.
  // Subscribed here (BEFORE the early-return below) to keep the
  // hook order stable across renders.
  const netQuality = useNetStore((s) => s.quality);
  const netLastRtt = useNetStore((s) => s.lastRttMs);
  const sendDrawOffer = useNetStore((s) => s.sendDrawOffer);
  const sendDrawResponse = useNetStore((s) => s.sendDrawResponse);
  const sendDrawCancel = useNetStore((s) => s.sendDrawCancel);
  // Step 19: reconnect overlay state.
  const connectionLost = useNetStore((s) => s.connectionLost);
  const connectionLostAt = useNetStore((s) => s.connectionLostAt);
  const claimWin = useNetStore((s) => s.claimWin);
  const resign = useNetStore((s) => s.resign);

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
  // Network joiner sees the board upside-down so they (P2) appear
  // at the bottom and their opponent at the top — same as the host's
  // perspective. Local two-player play keeps the original layout.
  const viewFlipped = isNetwork && localPlayerIndex === 1;
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

  // Which raw player index goes on top vs bottom of the layout.
  // In the non-flipped case (local play + network host): P2 on top,
  // P1 on bottom — the historical layout. When the joiner flips
  // the board: P1 (opponent) on top, P2 (self) on bottom.
  const topIndex: 0 | 1 = viewFlipped ? 0 : 1;
  const bottomIndex: 0 | 1 = viewFlipped ? 1 : 0;

  // Winning move targets: positions beyond the board that the panels absorb.
  // P0 wins by crossing raw row<0 (above the board); P1 wins by crossing
  // raw row>=h (below the board). When `viewFlipped` is true, the visual
  // top of the screen corresponds to raw row>=h instead of row<0, so we
  // swap which set of targets each panel receives.
  const topPanelWinTargets = viewFlipped
    ? validMoveTargets.filter((p) => p.row >= level.boardHeight)
    : validMoveTargets.filter((p) => p.row < 0);
  const bottomPanelWinTargets = viewFlipped
    ? validMoveTargets.filter((p) => p.row < 0)
    : validMoveTargets.filter((p) => p.row >= level.boardHeight);

  const gameOver = phase === 'finished' || phase === 'draw';

  return (
    <div
      className={styles.canvas}
      onClick={gameOver ? resetGame : undefined}
      style={gameOver ? { cursor: 'pointer' } : undefined}
    >
      {/* Winner / draw banner.
          In network mode we render "You win!" / "You lost" instead
          of the player's name. Two devices showing the same default
          profile name (e.g. both "Player 1") would otherwise leave
          the survivor unsure which side won. */}
      {phase === 'finished' && winnerId && (
        <div className={styles.winnerBanner}>
          {isNetwork && localPlayerIndex !== null
            ? winnerId === players[localPlayerIndex].id
              ? '🏆 You win!'
              : '😞 You lost'
            : `🏆 ${players.find((p) => p.id === winnerId)?.name} wins!`}
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

      {/* Step 19: reconnect overlay (network mode, mid-game only). */}
      {isNetwork && connectionLost && phase === 'playing' && connectionLostAt != null && (
        <ReconnectOverlay
          lostAt={connectionLostAt}
          onClaim={claimWin}
          onResign={resign}
        />
      )}

      {/* Step 18: connection-quality pill (network mode only). */}
      {isNetwork && netQuality && (
        <span
          aria-label={`Connection: ${netQuality}${netLastRtt != null ? `, ${netLastRtt} ms` : ''}`}
          title={netLastRtt != null ? `${netLastRtt} ms` : 'no samples yet'}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 8px',
            borderRadius: 999,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            fontSize: 11,
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background:
                netQuality === 'good'
                  ? '#3ad26b'
                  : netQuality === 'slow'
                    ? '#e6b020'
                    : '#e0494a',
              boxShadow: '0 0 4px rgba(0,0,0,0.4)',
            }}
          />
          {netLastRtt != null ? `${netLastRtt} ms` : netQuality}
        </span>
      )}

      {/* ── Main vertical stack ────────────────────────────── */}
      <div className={styles.stack}>
        {/* Top player panel — full width including timer bar areas */}
        <PlayerPanel
          playerId={players[topIndex].id}
          playerName={players[topIndex].name}
          playerColor={PlayerColors[players[topIndex].id]}
          figures={figures}
          isActive={currentPlayerIndex === topIndex && phase === 'playing' && !isOpponentTurn}
          isEnlarged={currentPlayerIndex === topIndex}
          selectedInstanceId={selectedInstanceId}
          onSelectFigure={selectAvailableFigure}
          onMenuToggle={() => setMenuOpenFor((p) => p === players[topIndex].id ? null : players[topIndex].id)}
          cellSize={cellSize}
          boardPixelWidth={hasTimer ? boardPixelWidth + timerBarW * 2 : boardPixelWidth}
          isPlaying={phase === 'playing'}
          winTargets={topPanelWinTargets}
          onWinClick={handleCellClick}
          // In network mode each player views the board with themselves
          // at the bottom — the top panel is the opponent's info and
          // must read right-side-up, so `againstView` doesn't apply.
          flipped={isNetwork ? false : againstView}
          // Network mode: only the local player may issue actions
          // (Give Up / Offer Draw). The top panel is the opponent's,
          // so its menu is hidden to avoid "offering on their behalf".
          showMenu={!isNetwork || topIndex === localPlayerIndex}
        />

        {/* Board row: timer bar | board + overlays | timer bar */}
        <div className={styles.boardRow}>
          {/* Bottom-player Timer bar — left side */}
          {hasTimer && (
            <div
              className={styles.timerBar}
              style={{ width: timerBarW, height: boardPixelHeight }}
            >
              <div
                className={styles.timerBarFill}
                style={{
                  bottom: 0,
                  height: `${bottomIndex === 0 ? p1TimerPct : p2TimerPct}%`,
                  background: PlayerColors[players[bottomIndex].id] + '80',
                }}
              />
              <span className={styles.timerText}>{formatTime(playerTimers[bottomIndex])}</span>
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
              viewFlipped={viewFlipped}
              // In network mode the entire board is flipped for the
              // joiner; per-piece P2 rotation would un-flip the icons.
              flipPlayer2Pieces={!isNetwork}
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
                    // Anchor the menu to whichever edge of the board
                    // the requesting player's panel sits on.
                    ...(menuOpenFor === players[bottomIndex].id ? { bottom: 0 } : { top: 0 }),
                  }}
                >
                  <span className={styles.menuPlayerName}>
                    {players.find((p) => p.id === menuOpenFor)?.name}
                  </span>
                  <div className={styles.menuButtons}>
                    <button
                      className={styles.menuBtn}
                      onClick={() => {
                        // Note: `forfeit` is NOT broadcast here.
                        // Instead, the netStore subscribes to the
                        // gameStore phase change and ships a `BYE`,
                        // which the opponent translates into a win
                        // for themselves via `handleRemoteAbort`.
                        // Keeping the wire-level seam in one place
                        // (netStore) avoids two sources of truth.
                        forfeit(menuOpenFor);
                        setMenuOpenFor(null);
                      }}
                    >
                      Give Up
                    </button>
                    <button
                      className={styles.menuBtn}
                      onClick={() => {
                        offerDraw(menuOpenFor);
                        if (isNetwork) sendDrawOffer(menuOpenFor);
                        setMenuOpenFor(null);
                      }}
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

            {/* Draw response panel.
                Local play: both sides share the screen — render the
                  Accept/Decline buttons opposite the offerer.
                Network play: only the RECEIVER of the offer sees the
                  buttons. The offerer just sees a "Draw offered…"
                  notice on their own side and can cancel locally. */}
            {drawOfferFrom && phase === 'playing' && !menuOpenFor && (() => {
              const offererIsLocal =
                isNetwork &&
                localPlayerIndex !== null &&
                drawOfferFrom === players[localPlayerIndex].id;
              return (
                <div
                  className={styles.drawPanel}
                  style={{
                    width: boardPixelWidth,
                    height: cellSize * 2,
                    // In network mode the panel is anchored to the
                    // RECEIVER (or to the offerer when they're the
                    // local player viewing their own "waiting" notice).
                    ...(drawOfferFrom === players[bottomIndex].id
                      ? { top: 0 }
                      : { bottom: 0 }),
                  }}
                >
                  <span className={styles.drawPanelText}>
                    {offererIsLocal ? 'Draw offered — waiting…' : 'Draw offered'}
                  </span>
                  <div className={styles.drawPanelButtons}>
                    {offererIsLocal ? (
                      // The offerer withdraws their pending offer.
                      // In network mode we also send DRAW_CANCEL so
                      // the receiver's Accept/Decline panel goes away.
                      <button
                        className={styles.menuBtn}
                        onClick={() => {
                          if (isNetwork) sendDrawCancel();
                          rejectDraw();
                        }}
                      >
                        Cancel
                      </button>
                    ) : (
                      <>
                        <button
                          className={styles.menuBtn}
                          onClick={() => {
                            // Send the response BEFORE mutating
                            // local state — accepting flips phase
                            // to 'draw', which the netStore phase
                            // listener treats as game-over and
                            // tears down the peer. If we sent the
                            // DRAW_RESPONSE after, the channel
                            // would already be closed.
                            if (isNetwork) sendDrawResponse(true);
                            acceptDraw();
                          }}
                        >
                          Accept
                        </button>
                        <button
                          className={styles.menuBtn}
                          onClick={() => {
                            if (isNetwork) sendDrawResponse(false);
                            rejectDraw();
                          }}
                        >
                          Decline
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Top-player Timer bar — right side */}
          {hasTimer && (
            <div
              className={styles.timerBar}
              style={{ width: timerBarW, height: boardPixelHeight }}
            >
              <div
                className={styles.timerBarFill}
                style={{
                  top: 0,
                  height: `${topIndex === 1 ? p2TimerPct : p1TimerPct}%`,
                  background: PlayerColors[players[topIndex].id] + '80',
                }}
              />
              <span className={styles.timerText}>{formatTime(playerTimers[topIndex])}</span>
            </div>
          )}
        </div>

        {/* Bottom player panel — full width including timer bar areas */}
        <PlayerPanel
          playerId={players[bottomIndex].id}
          playerName={players[bottomIndex].name}
          playerColor={PlayerColors[players[bottomIndex].id]}
          figures={figures}
          isActive={currentPlayerIndex === bottomIndex && phase === 'playing' && !isOpponentTurn}
          isEnlarged={currentPlayerIndex === bottomIndex}
          selectedInstanceId={selectedInstanceId}
          onSelectFigure={selectAvailableFigure}
          onMenuToggle={() => setMenuOpenFor((p) => p === players[bottomIndex].id ? null : players[bottomIndex].id)}
          cellSize={cellSize}
          boardPixelWidth={hasTimer ? boardPixelWidth + timerBarW * 2 : boardPixelWidth}
          isPlaying={phase === 'playing'}
          winTargets={bottomPanelWinTargets}
          onWinClick={handleCellClick}
          showMenu={!isNetwork || bottomIndex === localPlayerIndex}
        />
      </div>
    </div>
  );
}
