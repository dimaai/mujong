// ============================================================
// src/components/PlayerPanel/PlayerPanel.tsx
//
// PURPOSE: Renders a player's info strip above or below the board.
// Has two visual modes driven by isEnlarged:
//
//   Enlarged (active player, height = 1 cellSize):
//   ┌───────────────────────────────────────────┬───┐
//   │  [fig1] [fig2] [fig3] [fig4]             │ ≡ │
//   └───────────────────────────────────────────┴───┘
//
//   Minimized (inactive player, height = cellSize / 2):
//   ┌─────────────────────────────────────────────────┐
//   │ Name  [fig1][fig2][fig3][fig4]                  │
//   └─────────────────────────────────────────────────┘
//
// Timer is now rendered as a 2px bar on the board edge (by GameCanvas).
// Action buttons live in the sandwich-menu overlay (also GameCanvas).
//
// Inputs:  player data, figures, sizing, onMenuToggle, winTargets
// Outputs: fires onSelectFigure, onMenuToggle, onWinClick
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
  playerColor: string;
  figures: PlayerFigureInstance[];
  isActive: boolean;
  isEnlarged: boolean;
  selectedInstanceId: string | null;
  onSelectFigure: (instanceId: string) => void;
  /** Opens / closes the sandwich-menu overlay (rendered by GameCanvas). */
  onMenuToggle: () => void;
  cellSize: number;
  boardPixelWidth: number;
  isPlaying: boolean;
  winTargets: Position[];
  onWinClick: (pos: Position) => void;
  flipped?: boolean;
}

// ── PlayerPanel component ─────────────────────────────────────

export function PlayerPanel({
  playerId,
  playerName,
  playerColor,
  figures,
  isActive,
  isEnlarged,
  selectedInstanceId,
  onSelectFigure,
  onMenuToggle,
  cellSize,
  boardPixelWidth,
  isPlaying,
  winTargets,
  onWinClick,
  flipped,
}: PlayerPanelProps) {
  const myFigures = figures.filter((f) => f.playerId === playerId);

  const enlargedHeight = cellSize; // exactly 1 board square
  const minimizedHeight = Math.round(cellSize / 2);

  // Figure slot adapts to full panel height in enlarged mode.
  const enlargedSlotSize = Math.min(cellSize - 8, cellSize * 0.85);
  const minimizedSlotSize = Math.max(16, minimizedHeight - 8);

  const hasWinTarget = winTargets.length > 0;

  const bgColor = hexToRgba(playerColor, 0.35);
  const bgColorWin = hexToRgba(playerColor, 0.55);

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
      {/* ── Enlarged content: figures + separator + hamburger ── */}
      <div
        className={styles.enlargedContent}
        style={{ opacity: isEnlarged ? 1 : 0, pointerEvents: isEnlarged ? 'auto' : 'none' }}
      >
        <div className={styles.figuresArea}>
          {myFigures.map((instance) => (
            <CompactFigureSlot
              key={instance.instanceId}
              instance={instance}
              isSelected={instance.instanceId === selectedInstanceId}
              isActive={isActive}
              playerColor={playerColor}
              size={enlargedSlotSize}
              flipped={false}
              onClick={() => {
                if (isActive && instance.status === 'available') {
                  onSelectFigure(instance.instanceId);
                }
              }}
            />
          ))}
        </div>

        {isPlaying && (
          <>
            <div className={styles.separator} />
            <button
              className={styles.hamburgerBtn}
              onClick={(e) => { e.stopPropagation(); onMenuToggle(); }}
              title="Menu"
            >
              <span className={styles.hamburgerLine} />
              <span className={styles.hamburgerLine} />
              <span className={styles.hamburgerLine} />
            </button>
          </>
        )}
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

        <div className={styles.figuresRow}>
          {myFigures.map((instance) => (
            <CompactFigureSlot
              key={instance.instanceId}
              instance={instance}
              isSelected={instance.instanceId === selectedInstanceId}
              isActive={isActive}
              playerColor={playerColor}
              size={minimizedSlotSize}
              flipped={false}
              onClick={() => {
                if (isActive && instance.status === 'available') {
                  onSelectFigure(instance.instanceId);
                }
              }}
            />
          ))}
        </div>
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
  /** Whether to render the figure icon upside-down. */
  flipped: boolean;
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
  flipped,
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
        flipped={flipped}
      />

      {instance.status === 'taken' && (
        <span className={styles.crossOut} aria-label="captured">
          ✕
        </span>
      )}
    </div>
  );
}
