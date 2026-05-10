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
  /** When false, the hamburger menu button is hidden. Used in
   *  network mode to prevent the local user from issuing actions
   *  on the opponent's behalf. Defaults to true. */
  showMenu?: boolean;
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
  showMenu = true,
}: PlayerPanelProps) {
  const myFigures = figures.filter((f) => f.playerId === playerId);

  // Group instances by figureTypeId so each unique type renders as a single
  // slot with a "× N" count badge instead of N separate slots. This keeps the
  // panel narrow on small board sizes (e.g. 6×7) and lets the user see at a
  // glance how many of each type are still available to pick.
  const groups = groupByType(myFigures);

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
          {groups.map((group) => (
            <TypeSlot
              key={group.figureTypeId}
              group={group}
              isSelected={
                selectedInstanceId !== null &&
                group.availableInstances.some((i) => i.instanceId === selectedInstanceId)
              }
              isActive={isActive}
              playerColor={playerColor}
              size={enlargedSlotSize}
              flipped={false}
              onClick={() => {
                const next = group.availableInstances[0];
                if (isActive && next) {
                  onSelectFigure(next.instanceId);
                }
              }}
            />
          ))}
        </div>

        {isPlaying && showMenu && (
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
          {groups.map((group) => (
            <TypeSlot
              key={group.figureTypeId}
              group={group}
              isSelected={
                selectedInstanceId !== null &&
                group.availableInstances.some((i) => i.instanceId === selectedInstanceId)
              }
              isActive={isActive}
              playerColor={playerColor}
              size={minimizedSlotSize}
              flipped={false}
              onClick={() => {
                const next = group.availableInstances[0];
                if (isActive && next) {
                  onSelectFigure(next.instanceId);
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

/**
 * Like `hexToRgba` but multiplies each channel by `darken` (0..1, where 1
 * keeps the original color and lower values move toward black). Used for the
 * count badge so it visually echoes the player's timer-bar color but reads as
 * a slightly darker shade.
 */
function hexDarkerRgba(hex: string, darken: number, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
  const dr = Math.max(0, Math.min(255, Math.round(r * darken)));
  const dg = Math.max(0, Math.min(255, Math.round(g * darken)));
  const db = Math.max(0, Math.min(255, Math.round(b * darken)));
  return `rgba(${dr}, ${dg}, ${db}, ${alpha})`;
}

// ── Sub-component: TypeSlot ───────────────────────────────────

/**
 * One slot per unique figure type, showing the icon plus an "× N" count
 * badge of how many of that type are still available to pick. When N reaches
 * zero the slot is dimmed and non-interactive — it stays visible so the
 * player can still see what types they had at the start of the game.
 *
 * Inputs:  the type-group, visual state flags, size, click callback
 * Outputs: fires onClick when the slot is clickable (N > 0 and active turn)
 * Side effects: none
 */
interface TypeSlotProps {
  group: TypeGroup;
  isSelected: boolean;
  isActive: boolean;
  playerColor: string;
  /** Slot diameter in pixels. */
  size: number;
  /** Whether to render the figure icon upside-down. */
  flipped: boolean;
  onClick: () => void;
}

function TypeSlot({
  group,
  isSelected,
  isActive,
  playerColor,
  size,
  flipped,
  onClick,
}: TypeSlotProps) {
  const figureType = FIGURE_TYPE_MAP[group.figureTypeId];
  const remaining = group.availableInstances.length;
  const exhausted = remaining === 0;
  const isClickable = isActive && !exhausted;

  return (
    <div
      className={[
        styles.slot,
        exhausted ? styles.exhausted : '',
        isSelected ? styles.slotSelected : '',
        isClickable ? styles.clickable : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ width: size, height: size }}
      onClick={() => {
        if (isClickable) onClick();
      }}
      title={
        figureType
          ? `${figureType.name} (${remaining} left) — V:${figureType.movement.vertical} H:${figureType.movement.horizontal} D:${figureType.movement.diagonal}`
          : group.figureTypeId
      }
    >
      <FigureIcon
        figureTypeId={group.figureTypeId}
        color={playerColor}
        size={Math.max(12, size - 4)}
        flipped={flipped}
      />

      <span
        className={styles.countBadge}
        style={{
          // Scale badge text with slot size so it stays legible on small boards.
          fontSize: Math.max(9, Math.round(size * 0.28)),
          // Match the player's timer-bar tone (~50% alpha) but slightly darker
          // so the white "×N" text stays legible on light colors.
          backgroundColor: hexDarkerRgba(playerColor, 0.7, 0.5),
        }}
        aria-label={`${remaining} remaining`}
      >
        ×{remaining}
      </span>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * One row in the panel — collapses N instances of the same `figureTypeId` into
 * a single visual slot. `availableInstances` holds the still-pickable ones in
 * their original order so the first one can be selected on click.
 */
interface TypeGroup {
  figureTypeId: string;
  total: number;
  availableInstances: PlayerFigureInstance[];
}

function groupByType(instances: PlayerFigureInstance[]): TypeGroup[] {
  const order: string[] = [];
  const map = new Map<string, TypeGroup>();
  for (const inst of instances) {
    let g = map.get(inst.figureTypeId);
    if (!g) {
      g = { figureTypeId: inst.figureTypeId, total: 0, availableInstances: [] };
      map.set(inst.figureTypeId, g);
      order.push(inst.figureTypeId);
    }
    g.total += 1;
    if (inst.status === 'available') g.availableInstances.push(inst);
  }
  return order.map((id) => map.get(id)!);
}
