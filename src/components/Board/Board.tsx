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

import React, { useCallback, useRef, useState } from 'react';
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

  // ── Roving-tabindex keyboard navigation (Step 34) ──────────
  // Exactly one cell carries `tabIndex=0` at any time. Arrow keys
  // move that index in logical (col, row) space — the rules engine
  // is oblivious to `viewFlipped`, and so are we. Enter/Space on a
  // focused cell calls the same handler as a mouse click.
  const [focusCol, setFocusCol] = useState(0);
  const [focusRow, setFocusRow] = useState(0);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());

  const registerCellRef = useCallback(
    (key: string) => (el: HTMLDivElement | null) => {
      if (el) cellRefs.current.set(key, el);
      else cellRefs.current.delete(key);
    },
    [],
  );

  // Arrow / Home / End navigation shared by interactive cells and
  // wall cells. Activation (Enter / Space) is handled inline at the
  // interactive-cell call site, since walls aren't activatable.
  function moveFocusByKey(e: React.KeyboardEvent, col: number, row: number): boolean {
    let nc = col;
    let nr = row;
    switch (e.key) {
      case 'ArrowLeft':  nc = Math.max(0, col - 1); break;
      case 'ArrowRight': nc = Math.min(boardWidth - 1, col + 1); break;
      case 'ArrowUp':    nr = Math.max(0, row - 1); break;
      case 'ArrowDown':  nr = Math.min(boardHeight - 1, row + 1); break;
      case 'Home':       nc = 0; break;
      case 'End':        nc = boardWidth - 1; break;
      default: return false;
    }
    e.preventDefault();
    if (nc === col && nr === row) return true;
    setFocusCol(nc);
    setFocusRow(nr);
    cellRefs.current.get(`${nc},${nr}`)?.focus();
    return true;
  }

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

      // Per-figure rotation. In flipped view (network joiner) the
      // whole board grid is rotated 180° via CSS — so every figure
      // gets a counter-rotation to stay upright. In the historical
      // local-shared-screen case the grid is NOT rotated and only
      // P2's icons are rotated to "face" P1.
      const figureFlipped = viewFlipped
        ? true
        : flipPlayer2Pieces && figure?.playerId === 'p2';

      // Wall cells render as a distinct, non-interactive variant.
      // No click handler, no figure (walls and figures can't share a
      // cell since the rules engine forbids landing on walls). They
      // still participate in roving-tabindex navigation so arrow
      // keys can traverse over them.
      if (isWall) {
        const isFocusedWall = focusCol === col && focusRow === row;
        cells.push(
          <div
            key={posKey}
            ref={registerCellRef(posKey)}
            className={[
              styles.cell,
              isLight ? styles.cellLight : styles.cellDark,
              styles.cellWall,
            ].join(' ')}
            role="gridcell"
            aria-rowindex={row + 1}
            aria-colindex={col + 1}
            aria-label={`Wall at column ${col + 1}, row ${row + 1}`}
            aria-disabled="true"
            tabIndex={isFocusedWall ? 0 : -1}
            onFocus={() => {
              if (!isFocusedWall) {
                setFocusCol(col);
                setFocusRow(row);
              }
            }}
            onKeyDown={(e) => {
              moveFocusByKey(e, col, row);
            }}
          />,
        );
        continue;
      }

      const isFocused = focusCol === col && focusRow === row;
      const ariaLabel = figure
        ? `${figure.playerId === 'p1' ? 'Player 1' : 'Player 2'} ${figure.figureTypeId} at column ${col + 1}, row ${row + 1}`
        : isHighlighted
          ? `Valid move target at column ${col + 1}, row ${row + 1}`
          : `Empty cell at column ${col + 1}, row ${row + 1}`;

      cells.push(
        <div
          key={posKey}
          ref={registerCellRef(posKey)}
          className={[
            styles.cell,
            isLight ? styles.cellLight : styles.cellDark,
            isHighlighted ? styles.cellHighlighted : '',
            isSelected ? styles.cellSelected : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="gridcell"
          aria-rowindex={row + 1}
          aria-colindex={col + 1}
          aria-label={ariaLabel}
          aria-selected={isSelected || undefined}
          tabIndex={isFocused ? 0 : -1}
          onFocus={() => {
            // Keep the roving index in sync if focus arrives from
            // outside the grid (e.g. a Tab from the surrounding UI
            // lands on whichever cell currently has tabIndex=0,
            // which is exactly what we want).
            if (!isFocused) {
              setFocusCol(col);
              setFocusRow(row);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (figure && !isHighlighted) {
                onFigureClick(figure.instanceId);
              } else {
                onCellClick({ col, row });
              }
              return;
            }
            moveFocusByKey(e, col, row);
          }}
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
              flipped={figureFlipped}
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
        role="grid"
        aria-rowcount={boardHeight}
        aria-colcount={boardWidth}
        aria-label="Game board"
        style={{
          gridTemplateColumns: `repeat(${boardWidth}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${boardHeight}, ${cellSize}px)`,
          // viewFlipped: rotate the entire grid (including children
          // and click hit-targets) 180° so raw row 0 appears at the
          // visual bottom. Each FigureIcon is counter-rotated to
          // stay upright. Click handlers still receive the cell's
          // logical (col, row) — the rules engine is oblivious.
          ...(viewFlipped ? { transform: 'rotate(180deg)' } : null),
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
