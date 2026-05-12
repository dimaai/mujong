// ============================================================
// src/components/ErrorBoundary/ErrorBoundary.tsx
//
// PURPOSE
//   Root React error boundary (IMPLEMENTATION_PLAN Step 33,
//   Phase L-3). When any descendant component throws during
//   render / lifecycle, this boundary catches it, swaps the
//   subtree for a friendly fallback panel, and (optionally)
//   POSTs a diagnostic payload to a logging endpoint.
//
//   What this boundary does NOT catch — by React's contract:
//     - Errors thrown in event handlers.
//     - Errors thrown inside async callbacks (setTimeout, fetch
//       continuations, etc.) that escape React's render cycle.
//     - Server-side rendering errors. The boundary is a client
//       component; SSR errors are surfaced by Next.js.
//
//   We deliberately do NOT install a global `window.onerror`
//   hook here to keep this step's scope tight. Async errors
//   stay the responsibility of their own handlers.
//
// FALLBACK UI
//   Matches the rest of the app's glassy aesthetic. The
//   technical error message is intentionally NOT shown to the
//   user — we log it instead. The "Try again" button resets
//   `hasError` so the subtree re-renders; if the underlying
//   cause persists, the boundary catches it again.
//
// OPT-IN LOGGING
//   When `NEXT_PUBLIC_ERROR_LOG_URL` is set at build time, the
//   boundary fires a single `fetch` POST per crash with:
//     { message, stack, userId, deviceId, build, url }
//   Failures to log are swallowed so a logging outage never
//   blocks the UI. Without the env var the boundary works the
//   same — it just doesn't phone home.
// ============================================================

'use client';

import React from 'react';

import { getDeviceId, getUserId } from '../../persistence/ids';
import styles from './ErrorBoundary.module.css';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Payload shape posted to `NEXT_PUBLIC_ERROR_LOG_URL`. Kept in
 * sync with `api/src/functions/logError.ts` on the backend side.
 */
interface ErrorLogPayload {
  message: string;
  stack: string;
  userId: string;
  deviceId: string;
  build: string;
  url: string;
}

const LOG_URL = process.env.NEXT_PUBLIC_ERROR_LOG_URL ?? '';
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

/**
 * ErrorBoundary — see file header for the full contract.
 *
 * Class component because React's error-boundary API is only
 * available via `static getDerivedStateFromError` /
 * `componentDidCatch` (no hook equivalent exists).
 *
 * Inputs:  `children` — the subtree to guard.
 * Outputs: either `children`, or the fallback panel on error.
 * Side effects:
 *   - On error: fire-and-forget POST to the log endpoint (only
 *     when `NEXT_PUBLIC_ERROR_LOG_URL` is configured).
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    // React calls this with the thrown error during the render
    // phase. Returning new state swaps the subtree for the
    // fallback before any DOM commit happens.
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // `componentDidCatch` runs in the commit phase, after the
    // fallback is on screen. Safe place for side effects.
    if (typeof console !== 'undefined') {
      console.error('[mojong] caught render error:', error, info);
    }

    if (!LOG_URL || typeof window === 'undefined') return;

    const payload: ErrorLogPayload = {
      message: error.message,
      stack: error.stack ?? '',
      userId: getUserId(),
      deviceId: getDeviceId(),
      build: BUILD_ID,
      url: window.location.href,
    };

    // Fire-and-forget. We never want a logging failure to
    // surface to the user, so the catch is intentionally empty.
    void fetch(LOG_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      // `keepalive` lets the request finish even if the user
      // navigates / closes the tab right after the crash.
      keepalive: true,
    }).catch(() => {
      /* swallow — logging is best-effort */
    });
  }

  private handleReset = (): void => {
    // Clearing the flag re-mounts `children`. If the underlying
    // bug is deterministic the boundary will fire again, which
    // is the correct behaviour — better than a permanent crash
    // page with no escape.
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className={styles.wrapper} role="alert">
        <div className={styles.panel}>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.body}>
            Mojong ran into an unexpected error. You can try again,
            or reload the page if the problem persists.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={this.handleReset}
            >
              Try again
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                if (typeof window !== 'undefined') window.location.reload();
              }}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
