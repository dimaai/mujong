// ============================================================
// src/components/PwaUpdate/UpdateToast.tsx
//
// PURPOSE
//   Small floating toast that announces "New version available"
//   when a service worker has finished installing in the
//   background and is waiting to take over. Two actions:
//     - "Reload"  → applyUpdate() (activates the new SW + reloads)
//     - "×"       → postpone for now; the toast reappears the next
//                   time the user changes pages, so they don't get
//                   permanently stuck on the old bundle.
//
//   The toast is intentionally non-blocking: it does NOT prevent
//   gameplay, it does NOT force navigation. It just nudges.
//
// CLIENT COMPONENT
//   Uses useSwUpdate (touches navigator.serviceWorker) and
//   usePathname (Next App Router client API).
// ============================================================

'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useSwUpdate } from '../../hooks/useSwUpdate';
import styles from './UpdateToast.module.css';

/**
 * UpdateToast — see file header.
 *
 * Inputs:  none
 * Outputs: a fixed-position toast element, or `null`.
 * Side effects:
 *   - When the user clicks Reload, the underlying hook reloads
 *     the page (via `controllerchange` → `location.reload()`).
 *   - When the user dismisses, we hide the toast for the current
 *     route only; navigating elsewhere re-shows it as long as
 *     `updateReady` is still true.
 */
export function UpdateToast() {
  const { updateReady, applyUpdate } = useSwUpdate();
  const pathname = usePathname();

  // `dismissedPath` stores the pathname where the user clicked ×.
  // Comparing it against the current pathname is the simplest way
  // to implement "hide until next route change" without persisting
  // anything across reloads.
  const [dismissedPath, setDismissedPath] = useState<string | null>(null);

  // When the user navigates to a different route, forget the
  // dismissal so the toast can reappear. Without this effect,
  // navigating back to the dismissed route would silently re-show
  // the toast, which is not what we want either.
  useEffect(() => {
    if (dismissedPath !== null && pathname !== dismissedPath) {
      setDismissedPath(null);
    }
  }, [pathname, dismissedPath]);

  if (!updateReady) return null;
  if (dismissedPath === pathname) return null;

  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <span className={styles.message}>New version available</span>
      <button
        type="button"
        className={styles.reloadButton}
        onClick={applyUpdate}
      >
        Reload
      </button>
      <button
        type="button"
        className={styles.dismissButton}
        onClick={() => setDismissedPath(pathname)}
        aria-label="Dismiss update notice"
      >
        ×
      </button>
    </div>
  );
}
