// Typed, SSR-safe wrapper around window.localStorage.
//
// Two layers:
//   1. Raw helpers: getItem / setItem / removeItem
//        - JSON-encode automatically
//        - Return null (or no-op) when running on the server, where
//          `window` does not exist. Next.js renders components on the
//          server first, so any storage call made during render MUST
//          tolerate that environment.
//   2. Envelope helpers: getEnvelope / setEnvelope
//        - Wrap the payload in a `Persisted<T>` record that records
//          when it was last written and which device wrote it.
//        - This makes future cloud sync (Phase J) a drop-in: the
//          server can resolve conflicts via last-write-wins on
//          `updatedAt`, and we can tell "this device" from "another
//          device" via `deviceId`.
//
// Nothing in this file is React- or Zustand-specific on purpose, so it
// can be reused by stores, tests, or future native clients.

import { getDeviceId } from "./ids";

/** Schema version for the envelope itself (not the payload). */
const ENVELOPE_VERSION = 1;

/**
 * Wrapper stored in localStorage around every persisted value.
 *  - `v`         schema version of the envelope
 *  - `data`      the actual payload of type T
 *  - `updatedAt` epoch ms of the last write — used for LWW sync later
 *  - `deviceId`  which device produced this write
 */
export type Persisted<T> = {
  v: number;
  data: T;
  updatedAt: number;
  deviceId: string;
};

/** True when we're in a browser; false during SSR / build. */
function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

/**
 * Read a JSON value from localStorage.
 * Returns `null` if missing, on SSR, or if the stored string is corrupt.
 */
export function getItem<T>(key: string): T | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt JSON — treat as missing rather than crashing the app.
    return null;
  }
}

/**
 * Write a JSON value to localStorage. No-op during SSR.
 * Swallows quota errors so the UI never crashes because storage is full.
 */
export function setItem<T>(key: string, value: T): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled (private mode on some browsers).
    // We intentionally do not surface this to the user yet.
  }
}

/** Delete a key. No-op during SSR. */
export function removeItem(key: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

/**
 * Read a `Persisted<T>` envelope.
 * Returns `null` when nothing is stored or when the stored blob is not
 * a valid envelope (e.g. left over from an earlier raw-write version).
 */
export function getEnvelope<T>(key: string): Persisted<T> | null {
  const raw = getItem<Persisted<T>>(key);
  if (raw === null) return null;
  if (typeof raw !== "object" || typeof raw.updatedAt !== "number" || !("data" in raw)) {
    return null;
  }
  return raw;
}

/**
 * Write a payload, stamping it with `updatedAt = now` and the current
 * `deviceId`. Returns the envelope that was written, which is useful
 * for tests and for the future sync client.
 */
export function setEnvelope<T>(key: string, data: T): Persisted<T> {
  const envelope: Persisted<T> = {
    v: ENVELOPE_VERSION,
    data,
    updatedAt: Date.now(),
    deviceId: getDeviceId(),
  };
  setItem(key, envelope);
  return envelope;
}

// ── Zustand `persist` middleware adapter ──────────────────────
//
// Zustand's `persist` middleware expects a storage object shaped like
// `PersistStorage<T>`:
//   - getItem(name)    → { state, version } | null
//   - setItem(name, v) → void
//   - removeItem(name) → void
//
// We adapt our envelope helpers to that shape so every persisted store
// automatically gets `updatedAt` + `deviceId` stamped on disk, while
// Zustand still sees the plain `{ state, version }` it expects.
//
// We type this loosely (`unknown` payloads) because each store will
// supply its own concrete shape via `persist<MyState>`.

/** Shape Zustand's persist middleware reads/writes. */
export type ZustandStorageValue<T> = {
  state: T;
  version?: number;
};

/** Minimal subset of Zustand's `PersistStorage<T>` we implement. */
export type ZustandPersistStorage<T> = {
  getItem(name: string): ZustandStorageValue<T> | null;
  setItem(name: string, value: ZustandStorageValue<T>): void;
  removeItem(name: string): void;
};

/**
 * Build a storage adapter for `zustand/middleware`'s `persist`.
 *
 * Behaviour:
 *   - On read, unwraps the envelope and hands Zustand `{ state, version }`
 *     where `version` comes from the envelope's schema version `v`.
 *   - On write, re-wraps the state in a fresh envelope so `updatedAt`
 *     and `deviceId` are refreshed every time.
 *
 * Generic `T` is the *state* type the store persists (after `partialize`).
 */
export function createEnvelopeStorage<T>(): ZustandPersistStorage<T> {
  return {
    getItem(name) {
      const env = getEnvelope<T>(name);
      if (env === null) return null;
      return { state: env.data, version: env.v };
    },
    setItem(name, value) {
      // Zustand passes `{ state, version }`; we only persist the state
      // portion inside the envelope. The envelope has its own `v`.
      setEnvelope<T>(name, value.state);
    },
    removeItem(name) {
      removeItem(name);
    },
  };
}
