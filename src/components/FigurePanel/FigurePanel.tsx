// ============================================================
// src/components/FigurePanel/FigurePanel.tsx
//
// PURPOSE: Side panel showing one player's full figure inventory.
// Located on the left (Player 1) and right (Player 2) of the board.
//
// Each figure slot has three visual states:
//   available → normal token, clickable when it's this player's turn
//   placed    → greyed out (it's on the board already)
//   taken     → greyed out with a red × (captured by the opponent)
//
// This is also a "dumb" component — no store access, all via props.
// ============================================================

'use client';

import React from 'react';
import type { PlayerFigureInstance } from '../../domain/types';
import { FIGURE_TYPE_MAP } from '../../data/figuretypes';
import { FigureIcon } from '../figures/FigureIcon';
import styles from './FigurePanel.module.css';

// ── Props ─────────────────────────────────────────────────────

interface FigurePanelProps {
  playerId: string;
  playerName: string;
  /** CSS color string for the panel border and name label. */
  playerColor: string;
  /** ALL figures in the game — panel filters by playerId internally. */
  figures: PlayerFigureInstance[];
  /** True when it is this player's turn. */
  isActive: boolean;
  selectedInstanceId: string | null;
  /** Called when the player clicks an available figure to select it. */
  onSelectFigure: (instanceId: string) => void;
}

// ── FigurePanel component ─────────────────────────────────────

/**
 * FigurePanel renders the inventory sidebar for one player.
 *
 * Inputs:  see FigurePanelProps above
 * Outputs: fires onSelectFigure when an available piece is clicked
 * Side effects: none
 */
export function FigurePanel({
  playerId,
  playerName,
  playerColor,
  figures,
  isActive,
  selectedInstanceId,
  onSelectFigure,
}: FigurePanelProps) {
  // Filter to only this player's figures — the panel only shows its own pieces.
  const myFigures = figures.filter((f) => f.playerId === playerId);

  return (
    <div
      className={styles.panel}
      style={{
        borderColor: playerColor,
        // Dim the inactive player's panel to signal whose turn it is.
        opacity: isActive ? 1 : 0.6,
      }}
    >
      {/* Player name + active indicator */}
      <div className={styles.name} style={{ color: playerColor }}>
        {playerName}
        {isActive && <span className={styles.activeBadge}> ▶</span>}
      </div>

      {/* One slot per figure instance */}
      <div className={styles.figureList}>
        {myFigures.map((instance) => (
          <FigureSlot
            key={instance.instanceId}
            instance={instance}
            isSelected={instance.instanceId === selectedInstanceId}
            isActive={isActive}
            playerColor={playerColor}
            onClick={() => {
              // Only available pieces on the active player's turn are clickable.
              if (isActive && instance.status === 'available') {
                onSelectFigure(instance.instanceId);
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Sub-component: FigureSlot ─────────────────────────────────

interface FigureSlotProps {
  instance: PlayerFigureInstance;
  isSelected: boolean;
  isActive: boolean;
  playerColor: string;
  onClick: () => void;
}

/**
 * FigureSlot renders one inventory entry.
 * Visual state is driven entirely by instance.status.
 *
 * Inputs:  instance, isSelected, isActive, onClick callback
 * Outputs: fires onClick
 * Side effects: none
 */
function FigureSlot({ instance, isSelected, isActive, playerColor, onClick }: FigureSlotProps) {
  const figureType = FIGURE_TYPE_MAP[instance.figureTypeId];

  // Pick the CSS class that matches the figure's lifecycle state.
  const statusClass =
    instance.status === 'available'
      ? styles.available
      : instance.status === 'placed'
        ? styles.placed
        : styles.taken;

  const isClickable = isActive && instance.status === 'available';

  return (
    <div
      className={[
        styles.slot,
        statusClass,
        isSelected ? styles.slotSelected : '',
        isClickable ? styles.clickable : '',
      ]
        .filter(Boolean)
        .join(' ')}
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
        size={44}
        selected={isSelected}
      />

      {/* Crossed-out overlay for captured pieces */}
      {instance.status === 'taken' && (
        <span className={styles.crossOut} aria-label="captured">
          ✕
        </span>
      )}
    </div>
  );
}
