// ============================================================
// api/src/sync/defaultStore.ts
//
// PURPOSE
//   Singleton chooser for the Phase J sync backend
//   (IMPLEMENTATION_PLAN Step 26). Mirrors `sessions/defaultStore.ts`:
//
//     - `MOJONG_TABLES_ENDPOINT`  → AAD/managed-identity path
//     - `MOJONG_TABLES_CONN` or `AzureWebJobsStorage`
//                                  → connection-string path
//     - neither set                → in-memory (offline `func start`,
//                                    unit tests)
//
//   The decision is logged once at import time so a
//   misconfigured deployment is obvious in Function logs.
// ============================================================

import { ManagedIdentityCredential } from '@azure/identity';
import { createSyncStore, type SyncStore } from './store.js';
import { createTableSyncStore } from './tableStore.js';

function pickStore(): SyncStore {
  const endpoint = process.env.MOJONG_TABLES_ENDPOINT?.trim();
  if (endpoint) {
    console.log('[mojong] sync: using Azure Table Storage (AAD)');
    return createTableSyncStore({
      auth: {
        kind: 'aad',
        endpoint,
        credential: new ManagedIdentityCredential(),
      },
    });
  }

  const conn = (
    process.env.MOJONG_TABLES_CONN ?? process.env.AzureWebJobsStorage
  )?.trim();
  if (conn) {
    console.log('[mojong] sync: using Azure Table Storage (connection string)');
    return createTableSyncStore({
      auth: { kind: 'connectionString', connectionString: conn },
    });
  }

  console.log('[mojong] sync: using in-memory store (no storage configured)');
  return createSyncStore();
}

/**
 * Singleton shared by every sync HTTP handler. Lazily picks its
 * implementation on first import so tests and offline runs don't
 * need any storage configuration.
 */
export const defaultSyncStore: SyncStore = pickStore();
