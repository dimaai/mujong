// Shared types for the sync layer.
//
// This module is intentionally framework-agnostic (no React, no
// Zustand, no fetch) so the reconciliation kernel can be reused by a
// future React Native client. The Persisted<T> envelope already lives
// in persistence/storage.ts — we re-export it so callers can depend on
// `@/sync` without reaching into the persistence layer.

export type { Persisted } from "../persistence/storage";

/**
 * Which slice of user state a sync call is operating on.
 * One value per Zustand store that participates in cloud sync.
 * Adding a new kind here requires a matching server endpoint and a
 * wire-up entry in `installSyncListeners` (Step 25).
 */
export type SyncKind = "profile" | "settings";
