// @vitest-environment jsdom
// ============================================================
// src/components/Board/__tests__/Board.a11y.test.tsx
//
// PURPOSE
//   Step 34 (Phase L-4) — verify the Board's keyboard /
//   screen-reader semantics:
//
//     1. The grid container exposes role="grid" with the right
//        rowcount / colcount.
//     2. Each interactive cell exposes role="gridcell" plus
//        aria-rowindex / aria-colindex.
//     3. Initially the (0,0) cell is the only one with
//        tabIndex=0 — roving-tabindex pattern.
//     4. Arrow keys move the focused cell within bounds and
//        update the tabIndex=0 holder.
//     5. Pressing Enter on a focused empty cell fires
//        `onCellClick` with the cell's logical (col,row).
//
// SCOPE NOTE
//   We render the Board with a minimal fake Level — no rules
//   engine, no figures. That keeps the test laser-focused on
//   a11y / focus behaviour and avoids coupling to gameplay.
// ============================================================

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { Board } from '../Board';
import type { Level } from '../../../domain/types';

// 4×3 board, no figures, no allowed pieces — Board only reads
// boardWidth/boardHeight off this object for cell layout.
const TEST_LEVEL: Level = {
  levelId: 'test',
  levelNumber: 1,
  levelName: 'Test',
  boardWidth: 4,
  boardHeight: 3,
  allowedFigures: [],
  player1Color: '#3b82f6',
  player2Color: '#ef4444',
  timerMinutes: 0,
};

const PLAYER_COLORS = { p1: '#3b82f6', p2: '#ef4444' };

function renderBoard(overrides: Partial<React.ComponentProps<typeof Board>> = {}) {
  const onCellClick = vi.fn();
  const onFigureClick = vi.fn();
  const utils = render(
    <Board
      level={TEST_LEVEL}
      figures={[]}
      playerColors={PLAYER_COLORS}
      selectedInstanceId={null}
      validMoveTargets={[]}
      onCellClick={onCellClick}
      onFigureClick={onFigureClick}
      {...overrides}
    />,
  );
  return { ...utils, onCellClick, onFigureClick };
}

afterEach(() => {
  cleanup();
});

describe('Board a11y (Step 34)', () => {
  it('exposes role="grid" with rowcount and colcount matching the level', () => {
    const { container } = renderBoard();
    const grid = container.querySelector('[role="grid"]');
    expect(grid).not.toBeNull();
    expect(grid!.getAttribute('aria-rowcount')).toBe('3');
    expect(grid!.getAttribute('aria-colcount')).toBe('4');
  });

  it('renders one gridcell per board square with 1-based row/col indices', () => {
    const { container } = renderBoard();
    const cells = container.querySelectorAll('[role="gridcell"]');
    expect(cells.length).toBe(12); // 4 × 3
    // Spot-check the first and last cells' aria indices.
    const first = cells[0];
    expect(first.getAttribute('aria-colindex')).toBe('1');
    expect(first.getAttribute('aria-rowindex')).toBe('1');
    const last = cells[cells.length - 1];
    expect(last.getAttribute('aria-colindex')).toBe('4');
    expect(last.getAttribute('aria-rowindex')).toBe('3');
  });

  it('puts the roving tabindex on (0,0) by default', () => {
    const { container } = renderBoard();
    const focusable = container.querySelectorAll('[role="gridcell"][tabindex="0"]');
    expect(focusable.length).toBe(1);
    const cell = focusable[0]!;
    expect(cell.getAttribute('aria-colindex')).toBe('1');
    expect(cell.getAttribute('aria-rowindex')).toBe('1');
  });

  it('ArrowRight moves the roving tabindex one column to the right', () => {
    const { container } = renderBoard();
    const start = container.querySelector(
      '[role="gridcell"][tabindex="0"]',
    ) as HTMLElement;
    start.focus();
    fireEvent.keyDown(start, { key: 'ArrowRight' });

    const focusable = container.querySelectorAll('[role="gridcell"][tabindex="0"]');
    expect(focusable.length).toBe(1);
    const next = focusable[0]!;
    expect(next.getAttribute('aria-colindex')).toBe('2');
    expect(next.getAttribute('aria-rowindex')).toBe('1');
  });

  it('ArrowDown moves to the next row; ArrowUp restores the previous row', () => {
    const { container } = renderBoard();
    const start = container.querySelector(
      '[role="gridcell"][tabindex="0"]',
    ) as HTMLElement;
    start.focus();
    fireEvent.keyDown(start, { key: 'ArrowDown' });
    let focused = container.querySelector(
      '[role="gridcell"][tabindex="0"]',
    ) as HTMLElement;
    expect(focused.getAttribute('aria-rowindex')).toBe('2');

    fireEvent.keyDown(focused, { key: 'ArrowUp' });
    focused = container.querySelector('[role="gridcell"][tabindex="0"]') as HTMLElement;
    expect(focused.getAttribute('aria-rowindex')).toBe('1');
  });

  it('arrow keys do not move past the grid edge', () => {
    const { container } = renderBoard();
    const start = container.querySelector(
      '[role="gridcell"][tabindex="0"]',
    ) as HTMLElement;
    start.focus();
    // (0,0) — moving up or left should stay put.
    fireEvent.keyDown(start, { key: 'ArrowUp' });
    fireEvent.keyDown(start, { key: 'ArrowLeft' });
    const still = container.querySelector(
      '[role="gridcell"][tabindex="0"]',
    ) as HTMLElement;
    expect(still.getAttribute('aria-colindex')).toBe('1');
    expect(still.getAttribute('aria-rowindex')).toBe('1');
  });

  it('Enter on an empty cell fires onCellClick with the logical (col,row)', () => {
    const { container, onCellClick } = renderBoard();
    const start = container.querySelector(
      '[role="gridcell"][tabindex="0"]',
    ) as HTMLElement;
    start.focus();
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    const focused = container.querySelector(
      '[role="gridcell"][tabindex="0"]',
    ) as HTMLElement;
    fireEvent.keyDown(focused, { key: 'Enter' });
    expect(onCellClick).toHaveBeenCalledWith({ col: 1, row: 0 });
  });

  it('Space activates the focused cell the same as Enter', () => {
    const { container, onCellClick } = renderBoard();
    const start = container.querySelector(
      '[role="gridcell"][tabindex="0"]',
    ) as HTMLElement;
    start.focus();
    fireEvent.keyDown(start, { key: ' ' });
    expect(onCellClick).toHaveBeenCalledWith({ col: 0, row: 0 });
  });
});
