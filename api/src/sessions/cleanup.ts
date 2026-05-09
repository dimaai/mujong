// ============================================================
// api/src/sessions/cleanup.ts
//
// PURPOSE
//   Opportunistic TTL sweep for the in-memory session store
//   (IMPLEMENTATION_PLAN Step 14).
//
//   Every signaling HTTP handler calls `pruneExpired` at the top
//   of its body. This is intentionally cheap and stateless:
//   no timers, no background jobs, no cron. Sessions are tiny,
//   their map is small in v1, and Azure Functions instances are
//   short-lived — so iterating the map on every request is well
//   below the noise floor.
//
//   The single exported function is `pruneExpired(store, now,
//   ttlMs?)`. `ttlMs` defaults to 10 minutes per the architecture
//   doc; tests pass a smaller value to assert behaviour quickly.
// ============================================================

import type { SessionStore } from './store.js';

/** Default session lifetime. ARCHITECTURE §6: "few minutes". */
export const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * Drop sessions older than `ttlMs` ago. Returns the number
 * removed (mostly for log lines / tests).
 *
 *   Inputs : `store` — the live `SessionStore` singleton
 *            `now`   — current wall-clock in ms
 *            `ttlMs` — optional override (defaults to 10 min)
 *   Output : number of sessions pruned
 *   Side fx: deletes entries from the underlying map
 */
export async function pruneExpired(
  store: SessionStore,
  now: number,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<number> {
  return store.prune(now - ttlMs);
}
