// ============================================================
// src/components/Tutorial/Tutorial.tsx
//
// PURPOSE
//   Static explainer for new players. Server-rendered: no
//   interactivity beyond the back-link, so we avoid 'use client'
//   and the tree ships zero JS hydration cost.
//
//   Content is keyed off `FIGURE_TYPES` from
//   src/data/figuretypes.ts so editing a piece's movement
//   automatically updates the tutorial — no duplicated copy.
//
// SCOPE NOTE (Step 22)
//   v1 is text + figure icons only. A future step can add an
//   interactive mini-board; intentionally out of scope here to
//   keep the diff small and the page hydration-free.
// ============================================================

import React from 'react';
import Link from 'next/link';

import { FIGURE_TYPES } from '../../data/figuretypes';
import type { MovementRules } from '../../domain/types';
import { FigureIcon } from '../figures/FigureIcon';

import styles from './Tutorial.module.css';

// Neutral preview color — the tutorial isn't tied to a player's
// chosen accent, so we pick something that reads well against the
// dark glass card.
const PREVIEW_COLOR = '#7c3aed';

/**
 * describeMovement
 *
 * Purpose: turn a MovementRules record into a short human
 *          sentence used in the piece list.
 * Inputs:  the figure's `movement` object.
 * Outputs: a string like "Up to 2 squares vertically or horizontally."
 *          Returns "Does not move." if every axis is 0 (defensive —
 *          no current piece has that shape).
 * Side effects: none.
 */
function describeMovement(m: MovementRules): string {
  const parts: string[] = [];
  if (m.vertical > 0 && m.horizontal > 0 && m.vertical === m.horizontal) {
    parts.push(`up to ${m.vertical} squares vertically or horizontally`);
  } else {
    if (m.vertical > 0) parts.push(`up to ${m.vertical} squares vertically`);
    if (m.horizontal > 0) parts.push(`up to ${m.horizontal} squares horizontally`);
  }
  if (m.diagonal > 0) parts.push(`up to ${m.diagonal} squares diagonally`);

  if (parts.length === 0) return 'Does not move.';
  // Capitalise the first letter; the rest is already lowercase.
  const sentence = parts.join(', ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}

/**
 * Tutorial — read-only explainer page.
 *
 * Inputs:  none
 * Outputs: rendered tutorial card + back navigation
 * Side effects: none
 */
export function Tutorial() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.scrollArea}>
        <div className={styles.card}>
          <h1 className={styles.title}>How to play</h1>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Goal</h2>
            <p className={styles.sectionBody}>
              Be the first to step one of your pieces off the
              opponent&apos;s edge of the board. Player 1 (bottom) wins
              by walking a piece off the top edge; Player 2 (top) wins
              by walking one off the bottom.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Setup</h2>
            <p className={styles.sectionBody}>
              Each player starts with a roster of pieces determined by
              the chosen <strong>difficulty</strong>. The
              {' '}<strong>board size</strong> is set in Settings.
              Pieces are not on the board at the start — you place them
              during your turn.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Turn structure</h2>
            <p className={styles.sectionBody}>
              On your turn you may either <strong>place</strong> one of
              your remaining off-board pieces onto an empty square on
              your half of the board, or <strong>move</strong> a piece
              already on the board. After acting, the turn passes to
              your opponent.
            </p>
            <p className={styles.sectionBody}>
              Moving onto a square occupied by an enemy piece
              <strong> captures</strong> it. Most pieces are blocked by
              other pieces in their path; jumpers can leap over them.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Pieces</h2>
            <div className={styles.pieceList}>
              {FIGURE_TYPES.map((ft) => (
                <div key={ft.id} className={styles.pieceRow}>
                  <div className={styles.pieceIcon}>
                    <FigureIcon
                      figureTypeId={ft.id}
                      color={PREVIEW_COLOR}
                      size={48}
                    />
                  </div>
                  <div className={styles.pieceText}>
                    <div className={styles.pieceName}>{ft.name}</div>
                    <div className={styles.pieceMovement}>
                      {describeMovement(ft.movement)}
                    </div>
                    {ft.canJump && (
                      <div className={styles.pieceJump}>
                        Can jump over other pieces.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Walls</h2>
            <p className={styles.sectionBody}>
              When the <strong>Walls</strong> option is enabled in
              Settings, two impassable wall squares are placed
              symmetrically on the middle row. No piece can move onto
              or place onto a wall; jumpers may leap over them.
            </p>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Timer</h2>
            <p className={styles.sectionBody}>
              If a <strong>timer</strong> is set in Settings, each
              player gets that many minutes total on their clock. Your
              clock only ticks during your own turn. Running out of
              time loses the game.
            </p>
          </section>
        </div>
      </div>

      <div className={styles.buttonRow}>
        <Link href="/" className={styles.backButton}>
          ← Back to menu
        </Link>
      </div>
    </div>
  );
}
