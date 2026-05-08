// ============================================================
// api/src/sessions/defaultStore.ts
//
// PURPOSE
//   Production singleton wiring of `createStore` to real-world
//   dependencies: `Date.now`, Node's crypto RNG, and the
//   ambiguity-free invitation-code alphabet specified in
//   IMPLEMENTATION_PLAN Step 13.
//
//   This is the only place in `api/` that imports `node:crypto`,
//   keeping `store.ts` host-agnostic and deterministically
//   testable.
// ============================================================

import { randomBytes } from 'node:crypto';
import { createStore, type SessionStore } from './store.js';

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

/**
 * Singleton shared by both HTTP function handlers. In a
 * managed-Functions cold start this is fresh; that's fine for
 * v1 because sessions are short-lived (see ARCHITECTURE §6).
 */
export const defaultStore: SessionStore = createStore({
  now: () => Date.now(),
  randomCode: defaultRandomCode,
  randomToken: defaultRandomToken,
});
