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
import { FigureIcon } from '../figures/FigureIcon';
import styles from './Board.module.css';

// ── Props ─────────────────────────────────────────────────────

interface BoardProps {
  /** Level definition — provides boardWidth and boardHeight. */
  level: Level;
  /** All figure instances in the game (placed and unplaced). */
  figures: PlayerFigureInstance[];
  /**
   * Wall positions (Step 9). Empty when `options.walls` is false.
   * Wall cells render as a distinct, non-interactive variant and
   * are skipped by valid-move/placement highlights (the rules
   * engine already excludes them upstream — the UI just trusts it).
   */
  walls?: Position[];
  /** Maps each playerId to its CSS color string — used to color tokens by owner. */
  playerColors: Record<string, string>;
  /** Side length of each cell in pixels — computed by GameCanvas via ResizeObserver. */
  cellSize?: number;
  /** The instanceId of the currently selected figure, or null if none. */
  selectedInstanceId: string | null;
  /** Squares highlighted as valid destinations for the selected figure. */
  validMoveTargets: Position[];
  /** Called when the user clicks an empty cell (or a highlighted target). */
  onCellClick: (pos: Position) => void;
  /** Called when the user clicks a placed figure on the board. */
  onFigureClick: (instanceId: string) => void;
  /**
   * Render the board upside-down. Used by the joiner in a
   * networked game so each player sees themselves at the bottom.
   * Only the visual layout changes — `onCellClick` still reports
   * the underlying `(col, row)` so the rules engine stays oblivious.
   */
  viewFlipped?: boolean;
  /**
   * When true, P2's icons are rotated 180° on the board. This is
   * the legacy "two players sharing one screen" convention. Pass
   * `false` in network mode (the board itself is flipped instead,
   * so a per-piece rotation would un-flip them).
   */
  flipPlayer2Pieces?: boolean;
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
  walls = [],
  playerColors,
  cellSize = 64,
  selectedInstanceId,
  validMoveTargets,
  onCellClick,
  onFigureClick,
  viewFlipped = false,
  flipPlayer2Pieces = true,
}: BoardProps) {
  const { boardWidth, boardHeight } = level;

  // Convert the validMoveTargets array to a Set of "col,row" strings.
  // Set.has() is O(1) — faster than scanning an array for every cell.
  // Only include on-board positions (winning moves are handled by PlayerPanel).
  const targetSet = new Set(
    validMoveTargets
      .filter((p) => p.row >= 0 && p.row < boardHeight)
      .map((p) => `${p.col},${p.row}`),
  );

  // O(1) lookup of wall cells, same encoding as `targetSet`.
  const wallSet = new Set(walls.map((p) => `${p.col},${p.row}`));

  const cells: React.ReactNode[] = [];

  // Build cells row by row, column by column (top-left to bottom-right).
  for (let row = 0; row < boardHeight; row++) {
    for (let col = 0; col < boardWidth; col++) {
      const posKey = `${col},${row}`;
      const figure = getFigureAt(col, row, figures);
      const isHighlighted = targetSet.has(posKey);
      const isSelected = figure !== null && figure.instanceId === selectedInstanceId;
      const isWall = wallSet.has(posKey);

      // Checkerboard pattern: light when (row + col) is even.
      const isLight = (row + col) % 2 === 0;

      // When the board is flipped (network joiner), raw row 0 must
      // render at the BOTTOM of the grid. We override `gridRow`
      // per cell instead of transforming the grid container so
      // figure icons remain right-side-up automatically.
      const cellStyle: React.CSSProperties | undefined = viewFlipped
        ? { gridColumn: col + 1, gridRow: boardHeight - row }
        : undefined;

      // Wall cells render as a distinct, non-interactive variant.
      // No click handler, no figure (walls and figures can't share a
      // cell since the rules engine forbids landing on walls).
      if (isWall) {
        cells.push(
          <div
            key={posKey}
            className={[
              styles.cell,
              isLight ? styles.cellLight : styles.cellDark,
              styles.cellWall,
            ].join(' ')}
            style={cellStyle}
            role="presentation"
            aria-label="Wall"
          />,
        );
        continue;
      }

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
          style={cellStyle}
          onClick={() => {
            if (figure && !isHighlighted) {
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
              color={playerColors[figure.playerId] ?? '#888'}
              iconSize={Math.max(16, cellSize - 6)}
              flipped={flipPlayer2Pieces && figure.playerId === 'p2'}
            />
          )}
        </div>,
      );
    }
  }

  return (
    <div
      className={styles.boardOuter}
      // --cell-size is consumed by .cell in Board.module.css
      style={{ '--cell-size': `${cellSize}px` } as React.CSSProperties}
    >
      {/* Logo watermark behind the board */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/logo.png"
        alt=""
        className={styles.boardLogo}
      />

      {/* Main board grid */}
      <div
        className={styles.board}
        style={{
          gridTemplateColumns: `repeat(${boardWidth}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${boardHeight}, ${cellSize}px)`,
        }}
      >
        {cells}
      </div>
    </div>
  );
}

// ── Sub-component: FigureToken ────────────────────────────────

interface FigureTokenProps {
  instance: PlayerFigureInstance;
  isSelected: boolean;
  /** Owner's player color — stable for the lifetime of the piece. */
  color: string;
  /** SVG icon diameter in px — scales with cell size. */
  iconSize: number;
  /** When true, the icon on the figure is rendered upside-down. */
  flipped?: boolean;
}

/**
 * FigureToken renders a single piece on the board using the SVG FigureIcon.
 *
 * Inputs:  instance, isSelected, color, iconSize
 * Outputs: none (purely visual)
 * Side effects: none
 */
function FigureToken({ instance, isSelected, color, iconSize, flipped }: FigureTokenProps) {
  return (
    <FigureIcon
      figureTypeId={instance.figureTypeId}
      color={color}
      size={iconSize}
      selected={isSelected}
      flipped={flipped}
    />
  );
}
