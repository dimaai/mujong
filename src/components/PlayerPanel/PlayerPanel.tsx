// ============================================================
// src/components/PlayerPanel/PlayerPanel.tsx
//
// PURPOSE: Renders a player's info strip above or below the board.
// Has two visual modes driven by isEnlarged:
//
//   Enlarged (active player, height = 1 cellSize):
//   ┌─────────────────────────────────────────────────┐
//   │ Name     [Give up][Draw][Exit]           Timer  │
//   │            [fig1] [fig2] [fig3] [fig4]          │
//   └─────────────────────────────────────────────────┘
//
//   Minimized (inactive player, height = cellSize / 3):
//   ┌─────────────────────────────────────────────────┐
//   │ Name  [fig1][fig2][fig3][fig4]                  │
//   └─────────────────────────────────────────────────┘
//
// When the opponent has a winning move, the minimized panel is
// highlighted as a clickable "winning area" (pulsing gold overlay).
//
// Styling: no border — uses a half-transparent player-color background.
// Touches the board with no gap.
//
// Inputs:  player data, figures, sizing, callbacks, winTargets
// Outputs: fires onSelectFigure, onGiveUp, onOfferDraw, onExit, onWinClick
// Side effects: none — purely presentational
// ============================================================

'use client';

import React from 'react';
import type { PlayerFigureInstance, Position } from '../../domain/types';
import { FIGURE_TYPE_MAP } from '../../data/figuretypes';
import { FigureIcon } from '../figures/FigureIcon';
import styles from './PlayerPanel.module.css';

// ── Props ─────────────────────────────────────────────────────

interface PlayerPanelProps {
  playerId: string;
  playerName: string;
  /** CSS color used for the translucent background, name label, and timer. */
  playerColor: string;
  /** CSS color of the opponent player — used for draw-offer button backgrounds. */
  opponentColor: string;
  /** ALL figures in the game — panel filters by playerId internally. */
  figures: PlayerFigureInstance[];
  /** True when it is this player's turn. */
  isActive: boolean;
  /** True → enlarged (height = cellSize). False → minimized (height = cellSize/3). */
  isEnlarged: boolean;
  selectedInstanceId: string | null;
  onSelectFigure: (instanceId: string) => void;
  onGiveUp: () => void;
  onOfferDraw: () => void;
  /** Called by the opponent panel to accept the pending draw offer. */
  onAcceptDraw: () => void;
  /** Called by the opponent panel to reject the pending draw offer. */
  onRejectDraw: () => void;
  /** The playerId of whoever offered a draw, or null. */
  drawOfferFrom: string | null;
  onExit: () => void;
  /** Formatted "MM:SS" timer string. Empty string when timer is disabled. */
  timer: string;
  /** Pixel size of one board cell — drives all panel sizing. */
  cellSize: number;
  /** Board width in pixels (boardWidth × cellSize). */
  boardPixelWidth: number;
  /** Whether the game is still in the playing phase. */
  isPlaying: boolean;
  /** Winning-move positions that land on this panel (row < 0 or row >= boardHeight). */
  winTargets: Position[];
  /** Called when the user clicks this panel as a winning-move target. */
  onWinClick: (pos: Position) => void;
  /** When true, the entire panel is rendered upside-down for face-to-face play. */
  flipped?: boolean;
}

// ── PlayerPanel component ─────────────────────────────────────

export function PlayerPanel({
  playerId,
  playerName,
  playerColor,
  opponentColor,
  figures,
  isActive,
  isEnlarged,
  selectedInstanceId,
  onSelectFigure,
  onGiveUp,
  onOfferDraw,
  onAcceptDraw,
  onRejectDraw,
  drawOfferFrom,
  onExit,
  timer,
  cellSize,
  boardPixelWidth,
  isPlaying,
  winTargets,
  onWinClick,
  flipped,
}: PlayerPanelProps) {
  const myFigures = figures.filter((f) => f.playerId === playerId);

  const enlargedHeight = Math.round(cellSize * 1.5);
  const minimizedHeight = Math.round(cellSize / 2);
  const infoRowHeight = minimizedHeight; // top row = 1/2 cellSize
  const figuresAreaHeight = enlargedHeight - infoRowHeight; // bottom area = 2/3 cellSize

  // Figure slot size adapts to the available vertical space.
  const enlargedSlotSize = Math.min(figuresAreaHeight - 4, cellSize * 0.55);
  const minimizedSlotSize = Math.max(16, minimizedHeight - 8);

  const hasWinTarget = winTargets.length > 0;

  // The opponent offered a draw → this player's panel shows Accept/Reject.
  const opponentOfferedDraw = drawOfferFrom !== null && drawOfferFrom !== playerId;

  // Translucent background from the player's color.
  const bgColor = hexToRgba(playerColor, 0.35);
  const bgColorWin = hexToRgba(playerColor, 0.55);

  // Button gradient: vertical, player-color, fully opaque.
  const btnStyle: React.CSSProperties = {
    background: `linear-gradient(to bottom, ${playerColor}, ${hexToRgba(playerColor, 0.7)})`,
    borderColor: playerColor,
    color: '#fff',
  };

  const opponentBg = hexToRgba(opponentColor, 0.35);

  const currentHeight = isEnlarged ? enlargedHeight : minimizedHeight;
  const currentBg = hasWinTarget && !isEnlarged ? bgColorWin : bgColor;

  return (
    <div
      className={[
        styles.panelWrapper,
        hasWinTarget && !isEnlarged ? styles.winTarget : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        width: boardPixelWidth,
        height: currentHeight,
        backgroundColor: currentBg,
        cursor: hasWinTarget && !isEnlarged ? 'pointer' : 'default',
        transform: flipped ? 'rotate(180deg)' : undefined,
      }}
      onClick={() => {
        if (hasWinTarget && !isEnlarged) {
          onWinClick(winTargets[0]);
        }
      }}
    >
      {/* ── Enlarged content ────────────────────────────── */}
      <div
        className={styles.enlargedContent}
        style={{ opacity: isEnlarged ? 1 : 0, pointerEvents: isEnlarged ? 'auto' : 'none' }}
      >
        {/* Top info row: name, action buttons, timer */}
        <div className={styles.infoRow} style={{ height: infoRowHeight }}>
          <span
            className={styles.playerName}
            style={{ color: playerColor, maxWidth: boardPixelWidth / 2 }}
          >
            {playerName}
          </span>

          {isPlaying && (
            <div className={styles.buttons}>
              <button className={styles.actionBtn} style={btnStyle} onClick={onGiveUp} title="Give up">
                ⚑
              </button>
              <button className={styles.actionBtn} style={btnStyle} onClick={onOfferDraw} title="Offer draw">
                ½
              </button>
              <button className={styles.actionBtn} style={btnStyle} onClick={onExit} title="Exit">
                ←
              </button>
            </div>
          )}

          {!isPlaying && (
            <div className={styles.buttons}>
              <button className={styles.actionBtn} style={btnStyle} onClick={onExit} title="Exit game">
                ←
              </button>
            </div>
          )}

          <span className={styles.timer} style={{ color: playerColor }}>
            {timer}
          </span>
        </div>

        {/* Figures area — horizontally centered */}
        <div className={styles.figuresArea} style={{ height: figuresAreaHeight }}>
          {myFigures.map((instance) => (
            <CompactFigureSlot
              key={instance.instanceId}
              instance={instance}
              isSelected={instance.instanceId === selectedInstanceId}
              isActive={isActive}
              playerColor={playerColor}
              size={enlargedSlotSize}
              onClick={() => {
                if (isActive && instance.status === 'available') {
                  onSelectFigure(instance.instanceId);
                }
              }}
            />
          ))}
        </div>
      </div>

      {/* ── Minimized content ───────────────────────────── */}
      <div
        className={styles.minimizedContent}
        style={{ opacity: isEnlarged ? 0 : 1, pointerEvents: isEnlarged ? 'none' : 'auto' }}
      >
        <span
          className={styles.playerNameMin}
          style={{ color: playerColor, maxWidth: boardPixelWidth / 3 }}
        >
          {playerName}
        </span>

        {opponentOfferedDraw && isPlaying && (
          <div className={styles.drawOfferButtons}>
            <button
              className={styles.drawAcceptBtn}
              style={{ background: opponentBg }}
              onClick={(e) => { e.stopPropagation(); onAcceptDraw(); }}
            >
              Accept draw
            </button>
            <button
              className={styles.drawRejectBtn}
              style={{ background: opponentBg }}
              onClick={(e) => { e.stopPropagation(); onRejectDraw(); }}
            >
              Reject
            </button>
          </div>
        )}

        {!opponentOfferedDraw && (
          <div className={styles.figuresRow}>
            {myFigures.map((instance) => (
              <CompactFigureSlot
                key={instance.instanceId}
                instance={instance}
                isSelected={instance.instanceId === selectedInstanceId}
                isActive={isActive}
                playerColor={playerColor}
                size={minimizedSlotSize}
                onClick={() => {
                  if (isActive && instance.status === 'available') {
                    onSelectFigure(instance.instanceId);
                  }
                }}
              />
            ))}
          </div>
        )}

        {timer && (
          <span className={styles.timerMin} style={{ color: playerColor }}>
            {timer}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Utility: hex color → rgba string ──────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  // Handle shorthand like #abc → #aabbcc
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex; // fallback
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── Sub-component: CompactFigureSlot ──────────────────────────

interface CompactFigureSlotProps {
  instance: PlayerFigureInstance;
  isSelected: boolean;
  isActive: boolean;
  playerColor: string;
  /** Slot diameter in pixels. */
  size: number;
  onClick: () => void;
}

/**
 * Renders a single figure token within the player panel.
 *
 * Inputs:  instance data, visual state flags, size, click callback
 * Outputs: fires onClick when the slot is clickable
 * Side effects: none
 */
function CompactFigureSlot({
  instance,
  isSelected,
  isActive,
  playerColor,
  size,
  onClick,
}: CompactFigureSlotProps) {
  const isClickable = isActive && instance.status === 'available';
  const figureType = FIGURE_TYPE_MAP[instance.figureTypeId];

  return (
    <div
      className={[
        styles.slot,
        instance.status === 'placed' ? styles.placed : '',
        instance.status === 'taken' ? styles.taken : '',
        isSelected ? styles.slotSelected : '',
        isClickable ? styles.clickable : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width: size, height: size }}
      onClick={onClick}
      title={
        figureType
          ? `${figureType.name} — V:${figureType.movement.vertical} H:${figureType.movement.horizontal} D:${figureType.movement.diagonal}`
          : instance.figureTypeId
      }
    >
      <FigureIcon
        figureTypeId={instance.figureTypeId}
        color={playerColor}
        size={Math.max(12, size - 4)}
        flipped={instance.playerId === 'p2'}
      />

      {instance.status === 'taken' && (
        <span className={styles.crossOut} aria-label="captured">
          ✕
        </span>
      )}
    </div>
  );
}
