// ============================================================
// src/components/PwaInstall/InstallHintIOS.tsx
//
// PURPOSE
//   iOS Safari has no `beforeinstallprompt` — users must add the
//   page to the Home Screen manually via the Share sheet. We show
//   a one-time modal explaining how, then never bother them again
//   (dismissal is persisted under STORAGE_KEYS.installHintDismissed).
//
//   The modal renders only when ALL of these are true:
//     - we're on iOS Safari (hook flag)
//     - the page is NOT already running standalone
//     - the user has not previously dismissed it
//
// CLIENT COMPONENT
//   Touches window/navigator via usePwaInstall and reads/writes
//   localStorage for the dismissal flag.
// ============================================================

'use client';

import React, { useEffect, useState } from 'react';

import { usePwaInstall } from '../../hooks/usePwaInstall';
import { STORAGE_KEYS } from '../../persistence/keys';
import { getItem, setItem } from '../../persistence/storage';
import styles from './PwaInstall.module.css';

/**
 * InstallHintIOS — see file header.
 *
 * Inputs:  none
 * Outputs: a modal element on first iOS-Safari visit, or `null`.
 * Side effects:
 *   - Reads `STORAGE_KEYS.installHintDismissed` once on mount.
 *   - Writes "1" to that key on dismissal so the hint never
 *     reappears on this device.
 */
export function InstallHintIOS() {
  const { isIOSSafari, isStandalone } = usePwaInstall();

  // `null` = "haven't checked storage yet" (renders nothing).
  // `true` / `false` = the resolved dismissal flag.
  //
  // We keep this distinct from the eligibility check above so SSR
  // and the first client paint never flash the modal — we only
  // decide to render after we've read localStorage.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = getItem<string>(STORAGE_KEYS.installHintDismissed);
    setDismissed(stored === '1');
  }, []);

  function handleDismiss() {
    setItem(STORAGE_KEYS.installHintDismissed, '1');
    setDismissed(true);
  }

  if (!isIOSSafari || isStandalone) return null;
  if (dismissed !== false) return null;

  return (
    <div
      className={styles.hintBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="installHintTitle"
    >
      <div className={styles.hintCard}>
        <h2 id="installHintTitle" className={styles.hintTitle}>
          Install Mojong on your Home Screen
        </h2>
        <p className={styles.hintBody}>
          Tap the <strong>Share</strong> button in Safari, then choose{' '}
          <strong>Add to Home Screen</strong>. Mojong will open in its own
          window with full-screen play.
        </p>
        <div className={styles.hintActions}>
          <button
            type="button"
            className={styles.hintDismiss}
            onClick={handleDismiss}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
