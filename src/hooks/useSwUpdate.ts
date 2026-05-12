// ============================================================
// src/hooks/useSwUpdate.ts
//
// PURPOSE
//   React hook that surfaces "a new version is waiting" state from
//   the service worker, plus an imperative `applyUpdate()` to
//   activate the waiting worker and reload onto the new bundle.
//
//   Contract:
//     - updateReady    true once a service worker is in the
//                      `waiting` state for the current registration.
//     - applyUpdate()  posts `{ type: 'SKIP_WAITING' }` to that
//                      waiting worker, then reloads the page when
//                      the new worker takes control of the page
//                      (the `controllerchange` event).
//
// WHY THIS DESIGN
//   Workbox can be configured to either auto-activate new SWs
//   (`skipWaiting: true`) or hold them in the `waiting` state until
//   the page tells them to take over (`skipWaiting: false`). Auto-
//   activation is unsafe for an in-progress game: chunks the page
//   has already loaded may disappear from the new SW's precache,
//   leading to "ChunkLoadError" mid-turn. Holding the SW until the
//   user opts in is the standard fix — this hook is the page side
//   of that handshake.
//
// SSR / BOUNDARY DISCIPLINE
//   All `navigator.serviceWorker` access is gated by `typeof
//   window !== 'undefined'` and `'serviceWorker' in navigator`.
//   On SSR or unsupported browsers (e.g. Firefox private mode),
//   the hook simply reports `{ updateReady: false }` forever.
// ============================================================

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseSwUpdateResult {
  /** True once a waiting service worker is detected. */
  updateReady: boolean;
  /**
   * Activate the waiting worker and reload the page. Safe to call
   * when nothing is waiting — it just no-ops.
   */
  applyUpdate: () => void;
}

/**
 * useSwUpdate — see file header for the full contract.
 *
 * Inputs:  none
 * Outputs: `UseSwUpdateResult`
 * Side effects:
 *   - Subscribes to the active SW registration's `updatefound`
 *     event and to each new SW's `statechange` event.
 *   - Subscribes to `navigator.serviceWorker.controllerchange`
 *     once, so we can reload the page exactly when the new SW
 *     takes control. We guard the reload with a ref so React's
 *     StrictMode double-mount in dev can't trigger two reloads.
 */
export function useSwUpdate(): UseSwUpdateResult {
  const [updateReady, setUpdateReady] = useState(false);

  // Hold the active ServiceWorkerRegistration so applyUpdate() can
  // post to its `.waiting` worker. Using a ref keeps applyUpdate()
  // a stable callback that doesn't depend on render-time state.
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // Set to true by applyUpdate() so the `controllerchange` handler
  // knows the reload is user-initiated (vs. an external SW update,
  // which we don't want to reload through).
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    let cancelled = false;

    // Mark the page as "should reload on controllerchange" — but
    // only once, even if multiple SWs replace each other while the
    // tab is open.
    function onControllerChange() {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    }
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange,
    );

    /**
     * Wire up listeners for one specific registration. We may call
     * this multiple times if the registration object changes, but
     * in practice next-pwa returns the same instance.
     */
    function attach(reg: ServiceWorkerRegistration) {
      registrationRef.current = reg;

      // Case 1: a SW is ALREADY waiting (e.g. user opened the tab
      // after a deploy, before any updatefound could fire).
      if (reg.waiting && navigator.serviceWorker.controller) {
        setUpdateReady(true);
      }

      // Case 2: a new SW becomes available WHILE this tab is open.
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (
            installing.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            // `controller` is null on the very first SW install for
            // this origin — we only want the "update" toast when a
            // SW was already controlling the page, otherwise the
            // first visit would prompt the user to "update" to the
            // version they just loaded.
            setUpdateReady(true);
          }
        });
      });
    }

    navigator.serviceWorker.ready
      .then((reg) => {
        if (cancelled) return;
        attach(reg);
      })
      .catch(() => {
        // No SW registered (likely dev mode where next-pwa is
        // disabled). Stay in the default "no update" state.
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange,
      );
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const reg = registrationRef.current;
    if (!reg || !reg.waiting) return;
    // Asking the waiting SW to skip waiting causes it to activate.
    // Activation fires `controllerchange` on this page, which
    // triggers the reload in our listener above.
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  }, []);

  return { updateReady, applyUpdate };
}
