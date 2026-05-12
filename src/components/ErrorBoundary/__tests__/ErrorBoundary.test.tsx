// @vitest-environment jsdom
// ============================================================
// src/components/ErrorBoundary/__tests__/ErrorBoundary.test.tsx
//
// PURPOSE
//   Step 33 (Phase L-3) — verify the root error boundary:
//
//     1. When a child throws during render, the fallback panel
//        replaces the subtree.
//     2. Clicking "Try again" resets `hasError`, so a child
//        that no longer throws renders normally again.
//
// NOTE ON CONSOLE NOISE
//   React intentionally logs the caught error to `console.error`
//   in test environments. We stub `console.error` for the
//   duration of each test so the suite output stays clean while
//   still letting our own `console.error` call inside the
//   boundary be invoked (it's just captured by the same stub).
// ============================================================

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ErrorBoundary } from '../ErrorBoundary';

/**
 * Helper child that throws on its first render and then
 * succeeds. We use a module-scoped flag so the same instance
 * can recover after the boundary resets — that's exactly the
 * "transient error → Try again succeeds" shape we want to
 * exercise.
 */
function makeThrower() {
  let shouldThrow = true;
  function Thrower() {
    if (shouldThrow) {
      throw new Error('boom');
    }
    return <div data-testid="ok">all good</div>;
  }
  return {
    Thrower,
    stopThrowing: () => {
      shouldThrow = false;
    },
  };
}

describe('ErrorBoundary', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Silence React's own error logging plus our boundary's
    // `console.error`. We don't assert on the log content here.
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    cleanup();
  });

  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">hi</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('child')).toBeDefined();
  });

  it('renders the fallback when a child throws', () => {
    const { Thrower } = makeThrower();
    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/something went wrong/i)).toBeDefined();
  });

  it('recovers when "Try again" is clicked and the child no longer throws', () => {
    const { Thrower, stopThrowing } = makeThrower();
    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>,
    );

    // Fallback is up.
    const tryAgain = screen.getByRole('button', { name: /try again/i });
    expect(tryAgain).toBeDefined();

    // Fix the underlying cause, then ask the boundary to retry.
    stopThrowing();
    fireEvent.click(tryAgain);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('ok')).toBeDefined();
  });
});
