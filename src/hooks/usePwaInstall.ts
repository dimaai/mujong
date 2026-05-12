// ============================================================
// src/hooks/usePwaInstall.ts
//
// PURPOSE
//   Encapsulate all PWA-install detection in one place so React
//   components can render install affordances without sprinkling
//   `window` / `navigator` access across the tree.
//
//   The hook exposes four pieces of state:
//     - canInstall    true on Chromium browsers once we've captured
//                     a `beforeinstallprompt` event we can replay.
//     - promptInstall replays that captured event; resolves to the
//                     user's choice ('accepted' | 'dismissed' | null
//                     when no prompt was pending).
//     - isStandalone  true if the page is already running as an
//                     installed PWA (so we hide all install UI).
//     - isIOSSafari   true on iPad/iPhone Safari where there is no
//                     install event — the user must use Share →
//                     Add to Home Screen, and we surface a hint.
//
// BOUNDARY DISCIPLINE
//   Every `window` / `navigator` read is gated by
//   `typeof window !== 'undefined'`, so this module is safe to
//   import from a server-rendered Next.js component. All state
//   starts in its "not installable" default during SSR and updates
//   on the client after mount.
// ============================================================

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shape of the `beforeinstallprompt` event used by Chromium browsers.
 * TypeScript's lib.dom doesn't ship this yet, so we declare the
 * minimal surface we touch — nothing more.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>;
  prompt(): Promise<void>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

/**
 * Narrow extension of `Navigator` for the iOS-Safari-only
 * `standalone` boolean, which signals "running from Home Screen".
 */
interface NavigatorWithStandalone extends Navigator {
  readonly standalone?: boolean;
}

export interface UsePwaInstallResult {
  /** True when we have a deferred prompt we can replay. */
  canInstall: boolean;
  /** True when the page is already running as an installed app. */
  isStandalone: boolean;
  /** True on iOS Safari, which has no install event. */
  isIOSSafari: boolean;
  /**
   * Replay the captured install prompt. Returns the user's choice,
   * or `null` if no prompt was available (e.g. iOS, or already
   * installed). Safe to call without checking `canInstall` first —
   * the no-op return makes calling code simpler.
   */
  promptInstall: () => Promise<'accepted' | 'dismissed' | null>;
}

/**
 * Detect whether the current page is running as an installed PWA.
 * Two signals to cover both platforms:
 *   - `display-mode: standalone` media query (Chromium, modern Safari)
 *   - `navigator.standalone === true` (legacy iOS Safari)
 */
function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mqStandalone = window.matchMedia?.('(display-mode: standalone)').matches;
  const iosStandalone =
    (window.navigator as NavigatorWithStandalone).standalone === true;
  return Boolean(mqStandalone || iosStandalone);
}

/**
 * Detect iOS Safari (iPhone/iPad/iPod) where the install event
 * is not implemented. We do NOT detect Chrome-on-iOS separately
 * because all iOS browsers use the same WebKit engine and behave
 * the same way for "Add to Home Screen".
 */
function detectIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua);
}

/**
 * usePwaInstall — see file header for the full contract.
 *
 * Inputs:  none
 * Outputs: `UsePwaInstallResult`
 * Side effects:
 *   - Adds and removes `beforeinstallprompt` + `appinstalled`
 *     listeners on `window` for the lifetime of the mounted hook.
 *   - Calls `e.preventDefault()` on the captured event so the
 *     browser's default mini-infobar is suppressed in favour of
 *     our own pill.
 */
export function usePwaInstall(): UsePwaInstallResult {
  // The captured event lives in a ref because it's an imperative
  // handle (we call `.prompt()` on it); we don't want React to
  // re-render every time we stash or clear it.
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOSSafari, setIsIOSSafari] = useState(false);

  useEffect(() => {
    // Initial detection runs on the client only. We do this inside
    // the effect (not useState's initializer) so SSR output is
    // deterministic and matches the first client render.
    setIsStandalone(detectStandalone());
    setIsIOSSafari(detectIOSSafari());

    function onBeforeInstallPrompt(e: Event) {
      // Suppress the browser's default mini-infobar so we can show
      // our own pill at a time of our choosing.
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    }

    function onAppInstalled() {
      // The user accepted the prompt via any UI (ours or the
      // browser's own menu). Drop the cached event and hide the
      // pill — calling `.prompt()` twice is not allowed.
      deferredPromptRef.current = null;
      setCanInstall(false);
      setIsStandalone(true);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<
    'accepted' | 'dismissed' | null
  > => {
    const evt = deferredPromptRef.current;
    if (evt === null) return null;
    // A `beforeinstallprompt` event can only be prompted once.
    // Clear the ref before awaiting so a double-click can't double-fire.
    deferredPromptRef.current = null;
    setCanInstall(false);
    await evt.prompt();
    const choice = await evt.userChoice;
    return choice.outcome;
  }, []);

  return { canInstall, isStandalone, isIOSSafari, promptInstall };
}
