// @vitest-environment jsdom
// ============================================================
// src/components/MainMenu/__tests__/MainMenu.resume.test.tsx
//
// PURPOSE
//   Step 29 (Phase D-2) — verify the MainMenu "Resume game"
//   banner reacts correctly to the on-disk snapshot envelope:
//
//     1. No envelope → no banner rendered.
//     2. Resumable envelope → banner shows the right turn
//        number; clicking "Resume" navigates to /play and
//        leaves the envelope intact (so the /play route's
//        rehydration in Step 28 can take over).
//     3. Resumable envelope → clicking "Discard" wipes the
//        envelope and the banner disappears immediately.
//
// SCOPE NOTE
//   We exercise only the banner behaviour. The store-side
//   snapshot helpers themselves are covered by
//   gameStore.snapshot.test.ts. Here we treat
//   `getResumableSnapshotMeta` and `clearSnapshot` as black
//   boxes and assert on the rendered DOM.
//
// TEST ENVIRONMENT
//   Vitest's per-file directive at the top of this file pins
//   the test environment to jsdom (the repo default is Node).
//   Next.js `useRouter` is mocked to a spy push so we can
//   assert navigation without standing up Next's router.
// ============================================================

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';

import { MainMenu } from '../MainMenu';
import { STORAGE_KEYS } from '../../../persistence/keys';
import { setEnvelope, getItem } from '../../../persistence/storage';
import { useGameStore } from '../../../store/gameStore';
import type { GameState } from '../../../domain/types';

// ── Mocks ─────────────────────────────────────────────────────

// `useRouter` is mocked so we can assert navigation without
// pulling in the Next app router. The same `push` spy is
// returned across renders so individual tests can reset it.
const pushSpy = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushSpy,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────

/**
 * Seed a "playing"-phase envelope at `STORAGE_KEYS.gameSnapshot`.
 *
 * Inputs:  turnNumber — the number the banner should display.
 * Outputs: none
 * Side fx: writes one localStorage entry.
 *
 * `getResumableSnapshotMeta` only inspects `phase` and
 * `turnNumber`, so a partial payload cast to `GameState` is
 * enough — we don't need to construct a full game state here.
 */
function seedResumableSnapshot(turnNumber: number): void {
  setEnvelope(STORAGE_KEYS.gameSnapshot, {
    phase: 'playing',
    turnNumber,
  } as unknown as GameState);
}

// ── Lifecycle ─────────────────────────────────────────────────

beforeEach(() => {
  // Reset everything between tests: spy call list, DOM, and
  // localStorage. Without the storage wipe a stale envelope
  // from the previous test could leak into the next render.
  pushSpy.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

// ── Tests ─────────────────────────────────────────────────────

describe('MainMenu resume banner (Step 29)', () => {
  it('does not render the banner when no snapshot exists', async () => {
    await act(async () => {
      render(<MainMenu />);
    });

    // Banner text would read "Resume game · turn N". A plain
    // queryByText with a regex is enough here because no other
    // element on the menu uses that phrasing.
    expect(screen.queryByText(/Resume game/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Resume$/ })).toBeNull();
  });

  it('renders the banner with the correct turn number for a resumable snapshot', async () => {
    seedResumableSnapshot(7);

    await act(async () => {
      render(<MainMenu />);
    });

    // Effect-driven state: `setResumeMeta(...)` runs in the
    // mount effect. `act` above flushes it before we assert.
    expect(screen.getByText(/Resume game · turn 7/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Resume$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Discard$/ })).toBeTruthy();
  });

  it('navigates to /play and keeps the snapshot when "Resume" is clicked', async () => {
    seedResumableSnapshot(3);

    await act(async () => {
      render(<MainMenu />);
    });

    const resumeBtn = screen.getByRole('button', { name: /^Resume$/ });
    await act(async () => {
      fireEvent.click(resumeBtn);
    });

    // Navigation fired exactly once with the expected route.
    expect(pushSpy).toHaveBeenCalledWith('/play');

    // Envelope is still on disk — the /play page is responsible
    // for hydrating from it, not the MainMenu.
    expect(getItem(STORAGE_KEYS.gameSnapshot)).not.toBeNull();
  });

  it('clears the snapshot and removes the banner when "Discard" is clicked', async () => {
    seedResumableSnapshot(2);

    await act(async () => {
      render(<MainMenu />);
    });

    expect(screen.getByText(/Resume game · turn 2/i)).toBeTruthy();

    const discardBtn = screen.getByRole('button', { name: /^Discard$/ });
    await act(async () => {
      fireEvent.click(discardBtn);
    });

    // Store-level effect: snapshot envelope is gone.
    expect(getItem(STORAGE_KEYS.gameSnapshot)).toBeNull();

    // UI effect: banner unmounted.
    expect(screen.queryByText(/Resume game/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Resume$/ })).toBeNull();

    // Sanity: clicking Discard should NOT have navigated.
    expect(pushSpy).not.toHaveBeenCalledWith('/play');

    // Touch the store so the unused import isn't flagged by
    // type-check; we don't actually need state changes here.
    void useGameStore.getState();
  });
});
