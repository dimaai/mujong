// ============================================================
// src/components/Board/Board.tsx
//
// PURPOSE: Renders the game grid as a CSS Grid layout.
// Each cell is interactive — clicking selects a figure or applies a move.
//
// This is a "dumb" (presentational) component — it receives all data
// via props and fires events upward. It never reads from the store directly.
// This makes it easy to test in isolation and reuse with different state layers.
//
// The 'use client' directive is required because this component uses
// browser events (onClick). Without it, Next.js would try to render
// it on the server where event handlers don't exist.
// ============================================================

'use client';

import React from 'react';
import type { Position, PlayerFigureInstance, Level } from '../../domain/types';
import { getFigureAt } from '../../domain/board';
import { FIGURE_TYPE_MAP } from '../../data/figuretypes';
import styles from './Board.module.css';

// ── Props ─────────────────────────────────────────────────────

interface BoardProps {
  /** Level definition — provides boardWidth and boardHeight. */
  level: Level;
  /** All figure instances in the game (placed and unplaced). */
  figures: PlayerFigureInstance[];
  /** ID of the player whose turn it currently is. */
  currentPlayerId: string;
  /** The instanceId of the currently selected figure, or null if none. */
  selectedInstanceId: string | null;
  /** Squares highlighted as valid destinations for the selected figure. */
  validMoveTargets: Position[];
  /** Called when the user clicks an empty cell (or a highlighted target). */
  onCellClick: (pos: Position) => void;
  /** Called when the user clicks a placed figure on the board. */
  onFigureClick: (instanceId: string) => void;
}

// ── Board component ───────────────────────────────────────────

/**
 * Board renders the full game grid.
 *
 * Inputs:  see BoardProps above
 * Outputs: fires onCellClick or onFigureClick callbacks
 * Side effects: none — purely visual
 */
export function Board({
  level,
  figures,
  currentPlayerId,
  selectedInstanceId,
  validMoveTargets,
  onCellClick,
  onFigureClick,
}: BoardProps) {
  const { boardWidth, boardHeight } = level;

  // Convert the validMoveTargets array to a Set of "col,row" strings.
  // Set.has() is O(1) — faster than scanning an array for every cell.
  const targetSet = new Set(validMoveTargets.map((p) => `${p.col},${p.row}`));

  const cells: React.ReactNode[] = [];

  // Build cells row by row, column by column (top-left to bottom-right).
  for (let row = 0; row < boardHeight; row++) {
    for (let col = 0; col < boardWidth; col++) {
      const posKey = `${col},${row}`;
      const figure = getFigureAt(col, row, figures);
      const isHighlighted = targetSet.has(posKey);
      const isSelected = figure !== null && figure.instanceId === selectedInstanceId;

      // Checkerboard pattern: light when (row + col) is even.
      const isLight = (row + col) % 2 === 0;

      cells.push(
        <div
          key={posKey}
          className={[
            styles.cell,
            isLight ? styles.cellLight : styles.cellDark,
            isHighlighted ? styles.cellHighlighted : '',
            isSelected ? styles.cellSelected : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => {
            if (figure) {
              // Clicked a piece — delegate to parent for selection logic.
              onFigureClick(figure.instanceId);
            } else {
              // Clicked an empty square — may be a move/place target.
              onCellClick({ col, row });
            }
          }}
        >
          {figure && (
            <FigureToken
              instance={figure}
              isSelected={isSelected}
              isCurrentPlayerOwned={figure.playerId === currentPlayerId}
            />
          )}
        </div>,
      );
    }
  }

  return (
    <div
      className={styles.board}
      style={{
        // CSS custom properties drive the grid size dynamically.
        // gridTemplateColumns: "repeat(6, 1fr)" creates 6 equal columns.
        gridTemplateColumns: `repeat(${boardWidth}, 1fr)`,
        gridTemplateRows: `repeat(${boardHeight}, 1fr)`,
      }}
    >
      {cells}
    </div>
  );
}

// ── Sub-component: FigureToken ────────────────────────────────

interface FigureTokenProps {
  instance: PlayerFigureInstance;
  isSelected: boolean;
  /** True when this piece belongs to whoever's turn it is. */
  isCurrentPlayerOwned: boolean;
}

/**
 * FigureToken renders a single piece on the board.
 * Shows the first letter of the figure type as a placeholder
 * until real SVG/PNG skins are added to /public/skins/.
 *
 * Inputs:  instance, isSelected, isCurrentPlayerOwned
 * Outputs: none (purely visual)
 * Side effects: none
 */
function FigureToken({ instance, isSelected, isCurrentPlayerOwned }: FigureTokenProps) {
  const figureType = FIGURE_TYPE_MAP[instance.figureTypeId];

  return (
    <div
      className={[
        styles.token,
        isCurrentPlayerOwned ? styles.tokenOwned : styles.tokenOpponent,
        isSelected ? styles.tokenSelected : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={figureType?.name ?? instance.figureTypeId}
    >
      {/* First letter of the type name — "W" for Walker, "R" for Runner, etc. */}
      {figureType?.name?.charAt(0) ?? '?'}
    </div>
  );
}
