// ============================================================
// src/components/Settings/Settings.tsx
//
// PURPOSE
//   The "/settings" screen — a real form that edits every field on
//   `GameOptions` and persists via `useSettingsStore` (Step 3 store).
//
//   Save / Cancel semantics (per IMPLEMENTATION_PLAN Step 6):
//     - On mount we snapshot `useSettingsStore.getState().options`
//       into local component state and edit that copy.
//     - "Save"   → calls `save(form)` then navigates back to "/".
//     - "Cancel" → navigates back to "/" without writing anything.
//     This means the live store is untouched until the user
//     explicitly commits.
//
// SCOPE NOTE (Step 6)
//   No gameplay wiring yet — Start Game still uses the hard-coded
//   Level from Step 5. This step only proves the store round-trips
//   through a real UI. Step 7 wires Start Game to read from here.
//
// CLIENT COMPONENT
//   Marked 'use client' because it uses useState (controlled inputs),
//   useRouter (Next navigation), and a Zustand store.
// ============================================================

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import { useSettingsStore } from '../../store/settingsStore';
import { BOARD_SIZES } from '../../data/boardSizes';
import type { Difficulty, GameOptions } from '../../domain/types';

import styles from './Settings.module.css';

// Difficulty choices, kept here (not in domain/types) because this
// is purely a UI-presentation concern: the order and the labels
// shown to the user. The underlying union lives in `Difficulty`.
const DIFFICULTY_OPTIONS: Array<{ value: Difficulty; label: string }> = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'normal',   label: 'Normal'   },
  { value: 'advanced', label: 'Advanced' },
];

/**
 * Settings — the /settings screen.
 *
 * Inputs:  none
 * Outputs: rendered settings form
 * Side effects:
 *   - on Save: writes the edited GameOptions to useSettingsStore
 *     (which persists to localStorage via the envelope adapter)
 *   - navigates back to "/" on Save or Cancel
 */
export function Settings() {
  const router = useRouter();
  const save = useSettingsStore((s) => s.save);

  // Snapshot the persisted options once, on mount, so Cancel can
  // truly discard edits. We deliberately do NOT subscribe to
  // `options` here — re-renders from another tab writing the same
  // store would clobber the user's in-progress edits otherwise.
  const [form, setForm] = useState<GameOptions>(
    () => useSettingsStore.getState().options,
  );

  /**
   * patch
   *
   * Purpose:      merge a partial update into local form state.
   * Inputs:       Partial<GameOptions>
   * Outputs:      none
   * Side effects: setState only — does NOT touch the store.
   */
  function patch(p: Partial<GameOptions>) {
    setForm((prev) => ({ ...prev, ...p }));
  }

  /**
   * handleSave
   *
   * Purpose:      commit the edited form to the persisted store and
   *               navigate home.
   * Inputs:       none (reads `form` closure)
   * Outputs:      none
   * Side effects: writes to localStorage via useSettingsStore.save()
   *               and calls router.push('/').
   */
  function handleSave() {
    save(form);
    router.push('/');
  }

  /**
   * handleCancel
   *
   * Purpose:      navigate home without persisting any edits.
   * Inputs:       none
   * Outputs:      none
   * Side effects: router.push('/') only.
   */
  function handleCancel() {
    router.push('/');
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.form}>
        <h1 className={styles.title}>Settings</h1>

        {/* Difficulty — segmented control */}
        <div className={styles.field}>
          <label className={styles.label}>Difficulty</label>
          <div className={styles.segmented} role="radiogroup" aria-label="Difficulty">
            {DIFFICULTY_OPTIONS.map((opt) => {
              const selected = form.difficulty === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`${styles.segment} ${selected ? styles.segmentActive : ''}`}
                  onClick={() => patch({ difficulty: opt.value })}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Board size — segmented control fed by BOARD_SIZES */}
        <div className={styles.field}>
          <label className={styles.label}>Board size</label>
          <div className={styles.segmented} role="radiogroup" aria-label="Board size">
            {BOARD_SIZES.map((preset) => {
              const selected = form.boardSizeId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`${styles.segment} ${selected ? styles.segmentActive : ''}`}
                  onClick={() => patch({ boardSizeId: preset.id })}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Timer minutes — range slider 0..5. Pulling to 0 turns the
            timer off and visually greys the control; moving back above
            0 restores normal styling. The control itself stays usable
            in either state so the user can always drag it back. */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="timerMinutes">
            Timer ({form.timerMinutes === 0
              ? 'off'
              : `${form.timerMinutes} min per player`})
          </label>
          <input
            id="timerMinutes"
            type="range"
            min={0}
            max={5}
            step={1}
            value={form.timerMinutes}
            onChange={(e) => {
              // Range inputs always emit a clean number string in
              // [min, max], so a plain Number() is safe here.
              patch({ timerMinutes: Number(e.target.value) });
            }}
            className={`${styles.slider2} ${
              form.timerMinutes === 0 ? styles.slider2Off : ''
            }`}
            aria-valuetext={
              form.timerMinutes === 0 ? 'off' : `${form.timerMinutes} minutes`
            }
          />
          <div className={styles.sliderTicks} aria-hidden>
            <span>Off</span>
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
          </div>
        </div>

        {/* Against view — toggle */}
        <div className={styles.toggleRow}>
          <div>
            <div className={styles.toggleLabel}>Against view</div>
            <div className={styles.toggleHint}>
              Flip the top player&apos;s panel for face-to-face play.
            </div>
          </div>
          <label className={styles.switch}>
            <input
              type="checkbox"
              checked={form.againstView}
              onChange={(e) => patch({ againstView: e.target.checked })}
            />
            <span className={styles.slider} aria-hidden />
          </label>
        </div>

        {/* Walls — toggle */}
        <div className={styles.toggleRow}>
          <div>
            <div className={styles.toggleLabel}>Walls</div>
            <div className={styles.toggleHint}>
              Place two blocking walls on the middle row.
            </div>
          </div>
          <label className={styles.switch}>
            <input
              type="checkbox"
              checked={form.walls}
              onChange={(e) => patch({ walls: e.target.checked })}
            />
            <span className={styles.slider} aria-hidden />
          </label>
        </div>

        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={handleSave}
          >
            Save
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={handleCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
