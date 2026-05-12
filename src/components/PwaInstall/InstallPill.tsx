// ============================================================
// src/components/PwaInstall/InstallPill.tsx
//
// PURPOSE
//   Tiny "Install Mojong" button that surfaces the browser's
//   native PWA install prompt. Renders nothing unless we have
//   a captured `beforeinstallprompt` event to replay — that way
//   non-Chromium browsers and already-installed instances get
//   zero visual chrome.
//
// CLIENT COMPONENT
//   Uses the usePwaInstall hook which touches window/navigator.
// ============================================================

'use client';

import React from 'react';

import { usePwaInstall } from '../../hooks/usePwaInstall';
import styles from './PwaInstall.module.css';

/**
 * InstallPill — see file header.
 *
 * Inputs:  none
 * Outputs: a button when installable, or `null` otherwise.
 * Side effects: invokes the native install prompt on click via
 *               the hook; the hook itself manages event listeners.
 */
export function InstallPill() {
  const { canInstall, isStandalone, promptInstall } = usePwaInstall();

  // Hide entirely when there's nothing to offer. We intentionally
  // do not render a disabled state — an empty space is friendlier
  // than a greyed-out button the user can't reason about.
  if (isStandalone || !canInstall) return null;

  return (
    <button
      type="button"
      className={styles.pill}
      onClick={() => {
        // Fire-and-forget: the hook resolves to the user's choice,
        // but we don't need to react to it here — `appinstalled`
        // (handled inside the hook) clears `canInstall` for us.
        void promptInstall();
      }}
      aria-label="Install Mojong as an app"
    >
      <span aria-hidden="true" className={styles.pillIcon}>
        ⬇
      </span>
      Install Mojong
    </button>
  );
}
