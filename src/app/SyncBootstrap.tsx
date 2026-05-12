// ============================================================
// src/app/SyncBootstrap.tsx
//
// PURPOSE
//   Mounts the cloud-sync wire-up exactly once for the whole app.
//
//   Renders nothing. It exists purely to run `installSyncListeners`
//   inside a `useEffect` so we are guaranteed to be on the client,
//   after rehydration, and after `getUserId()` can read
//   localStorage.
//
// FEATURE FLAG
//   `NEXT_PUBLIC_SYNC_BASE_URL` controls whether sync is active.
//   When undefined (the default until the backend Function ships
//   in Step 26), this component is a no-op.
// ============================================================

"use client";

import { useEffect } from "react";

import { getUserId } from "../persistence/ids";
import { createSyncClient } from "../sync/httpClient";
import { installSyncListeners } from "../sync/wire";

export function SyncBootstrap() {
  useEffect(() => {
    const baseUrl = process.env.NEXT_PUBLIC_SYNC_BASE_URL;
    if (!baseUrl) return; // feature flag off — nothing to do.
    const userId = getUserId();
    const client = createSyncClient({ baseUrl, userId });
    const dispose = installSyncListeners(client);
    return dispose;
  }, []);

  return null;
}
