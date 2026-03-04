// ============================================================
// src/components/GameSetup/GameSetup.tsx
//
// PURPOSE: The entry screen shown before a game starts.
// Lets players enter their names and pick a level.
// Once "Start Game" is clicked, it calls startGame() on the store
// and switches to GameCanvas.
//
// This is a client component because it manages local form state
// with useState and reads/writes the Zustand store.
// ============================================================

'use client';

import React, { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { GameCanvas } from '../GameCanvas/GameCanvas';
import { LEVELS } from '../../data/levels';
import type { Player } from '../../domain/types';
import styles from './GameSetup.module.css';

/**
 * GameSetup acts as a router:
 *   - No active game → show the setup form
 *   - Active game    → show GameCanvas
 *
 * Inputs:  none
 * Outputs: rendered setup form or game canvas
 * Side effects: calls startGame / resetGame on the Zustand store
 */
export function GameSetup() {
  // Read game state and actions from the Zustand store.
  // `game` being null means no session is running yet.
  const { game, startGame, resetGame } = useGameStore();

  // Local form state — only lives while the setup form is visible.
  // useState(initialValue) returns [currentValue, setterFunction].
  const [selectedLevelId, setSelectedLevelId] = useState(LEVELS[0].levelId);
  const [p1Name, setP1Name] = useState('Player 1');
  const [p2Name, setP2Name] = useState('Player 2');
  const [timerMinutes, setTimerMinutes] = useState(5);
  const [p1Color, setP1Color] = useState(LEVELS[0].player1Color);
  const [p2Color, setP2Color] = useState(LEVELS[0].player2Color);
  const [againstView, setAgainstView] = useState(false);

  // When the user picks a different level, update the default colors.
  function handleLevelChange(levelId: string) {
    setSelectedLevelId(levelId);
    const lvl = LEVELS.find((l) => l.levelId === levelId);
    if (lvl) {
      setP1Color(lvl.player1Color);
      setP2Color(lvl.player2Color);
    }
  }

  /**
   * handleStart reads the form values, builds Player objects,
   * and calls startGame() which initialises the Zustand game state.
   */
  function handleStart() {
    const level = LEVELS.find((l) => l.levelId === selectedLevelId);
    if (!level) return;

    // Override level defaults with the user's selections.
    const customLevel = {
      ...level,
      timerMinutes,
      player1Color: p1Color,
      player2Color: p2Color,
    };

    // Player objects match the Player interface in domain/types.ts.
    const p1: Player = { id: 'p1', name: p1Name.trim() || 'Player 1', rating: 1000 };
    const p2: Player = { id: 'p2', name: p2Name.trim() || 'Player 2', rating: 1000 };

    startGame(customLevel, p1, p2, againstView);
  }

  // If a game is already running, render the full game view.
  // The "New Game" and "Give Up" buttons live inside GameCanvas now.
  if (game) {
    return <GameCanvas />;
  }

  // Otherwise render the setup form with the game title.
  return (
    <div className={styles.setupWrapper}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/logo.png" alt="Mojong" className={styles.logo} />
    <div className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="levelSelect">Level</label>
        {/* Controlled input: value is always driven by React state */}
        <select
          id="levelSelect"
          value={selectedLevelId}
          onChange={(e) => handleLevelChange(e.target.value)}
        >
          {LEVELS.map((l) => (
            <option key={l.levelId} value={l.levelId}>
              {l.levelNumber}. {l.levelName} ({l.boardWidth}×{l.boardHeight})
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="p1Name">Player 1 name (bottom)</label>
        <div className={styles.nameRow}>
          <input
            id="p1Name"
            type="text"
            value={p1Name}
            onChange={(e) => setP1Name(e.target.value)}
            maxLength={25}
          />
          <input
            id="p1Color"
            type="color"
            value={p1Color}
            onChange={(e) => setP1Color(e.target.value)}
            className={styles.colorTile}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="p2Name">Player 2 name (top)</label>
        <div className={styles.nameRow}>
          <input
            id="p2Name"
            type="text"
            value={p2Name}
            onChange={(e) => setP2Name(e.target.value)}
            maxLength={25}
          />
          <input
            id="p2Color"
            type="color"
            value={p2Color}
            onChange={(e) => setP2Color(e.target.value)}
            className={styles.colorTile}
          />
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="timerSelect">Timer per player</label>
        <select
          id="timerSelect"
          value={timerMinutes}
          onChange={(e) => setTimerMinutes(Number(e.target.value))}
        >
          <option value={0}>No timer</option>
          <option value={1}>1 min</option>
          <option value={2}>2 min</option>
          <option value={3}>3 min</option>
          <option value={5}>5 min</option>
          <option value={10}>10 min</option>
        </select>
      </div>

      <div className={styles.toggleField}>
        <label htmlFor="againstView" className={styles.toggleLabel}>
          <input
            id="againstView"
            type="checkbox"
            checked={againstView}
            onChange={(e) => setAgainstView(e.target.checked)}
            className={styles.toggleCheckbox}
          />
          <span className={styles.toggleSwitch} />
          Against view
        </label>
        <span className={styles.toggleHint}>
          Flips top panel for face-to-face play
        </span>
      </div>

      <button className={styles.startButton} onClick={handleStart}>
        Start Game
      </button>
    </div>
    </div>
  );
}
