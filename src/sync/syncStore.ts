// ============================================================
// src/sync/syncStore.ts
//
// PURPOSE
//   Tiny, non-persisted Zustand store that surfaces the current
//   cloud-sync state to UI. The Settings screen (Step 25) reads
//   this to render a "Synced · 5s ago" / "Offline" indicator.
//
//   Intentionally NOT persisted: status is a runtime concern.
//   Each app load re-derives it from the first `pull`.
// ============================================================

import { create } from "zustand";

/** Coarse-grained sync status surfaced to UI. */
export type SyncStatus = "idle" | "syncing" | "error" | "offline";

export interface SyncStoreState {
  status: SyncStatus;
  /** Epoch ms of the last successful sync (pull or push), or null. */
  lastSyncedAt: number | null;

  setStatus: (status: SyncStatus) => void;
  /** Mark a sync as successful right now and flip status to `idle`. */
  markSynced: () => void;
  /** Reset to defaults — used in tests. */
  reset: () => void;
}

const DEFAULTS: Pick<SyncStoreState, "status" | "lastSyncedAt"> = {
  status: "idle",
  lastSyncedAt: null,
};

export const useSyncStore = create<SyncStoreState>((set) => ({
  ...DEFAULTS,
  setStatus: (status) => set({ status }),
  markSynced: () => set({ status: "idle", lastSyncedAt: Date.now() }),
  reset: () => set({ ...DEFAULTS }),
}));
