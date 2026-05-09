// ============================================================
// api/src/sessions/defaultStore.ts
//
// PURPOSE
//   Production singleton that picks the right `SessionStore`
//   implementation at startup:
//
//     - When `AzureWebJobsStorage` (or `MOJONG_TABLES_CONN`) is
//       set, we use the Azure Table Storage-backed store from
//       `tableStore.ts`. This is what the deployed Static Web
//       App always sees: SWA managed Functions inject
//       `AzureWebJobsStorage` automatically.
//
//     - Otherwise we fall back to the in-memory `createStore`
//       so `func start` works offline (no Azurite required) and
//       the unit tests don't need any external storage.
//
//   The choice is logged once at import time so a misconfigured
//   deployment is obvious in the Function logs.
// ============================================================

import { randomBytes } from 'node:crypto';
import { createStore, type SessionStore } from './store.js';
import { createTableStore } from './tableStore.js';

/**
 * 31-char alphabet excluding visually ambiguous characters
 * (`0/O`, `1/I/L`). 31^6 ≈ 887M codes — collisions are
 * vanishingly rare even with thousands of live sessions.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

/**
 * Cryptographically random 6-char invitation code. We use
 * rejection sampling on bytes to avoid modulo bias: the largest
 * multiple of 31 not exceeding 256 is 248, so we discard byte
 * values >= 248 and re-roll.
 */
export function defaultRandomCode(): string {
  let out = '';
  while (out.length < CODE_LENGTH) {
    const buf = randomBytes(CODE_LENGTH * 2);
    for (let i = 0; i < buf.length && out.length < CODE_LENGTH; i++) {
      const b = buf[i]!;
      if (b >= 248) continue; // reject to remove modulo bias
      out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

/**
 * 48-char hex bearer token. Opaque to the client; used by
 * Step 14 to authorise SDP/ICE writes.
 */
export function defaultRandomToken(): string {
  return randomBytes(24).toString('hex');
}

function pickStore(): SessionStore {
  const conn =
    process.env.MOJONG_TABLES_CONN ?? process.env.AzureWebJobsStorage;
  if (conn && conn.trim().length > 0) {
    // Use stdout via console.log — the Functions runtime captures
    // it into Application Insights. We keep this side-effecty log
    // out of `tableStore.ts` so the implementation file stays
    // log-free and easier to test.
    console.log('[mojong] sessions: using Azure Table Storage');
    return createTableStore({
      now: () => Date.now(),
      randomCode: defaultRandomCode,
      randomToken: defaultRandomToken,
      connectionString: conn,
    });
  }
  console.log('[mojong] sessions: using in-memory store (no AzureWebJobsStorage)');
  return createStore({
    now: () => Date.now(),
    randomCode: defaultRandomCode,
    randomToken: defaultRandomToken,
  });
}

/**
 * Singleton shared by every HTTP function handler. Lazily picks
 * its implementation on first import so tests and offline runs
 * don't need any storage configuration.
 */
export const defaultStore: SessionStore = pickStore();
