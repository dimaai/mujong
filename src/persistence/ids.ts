// Stable identifiers for "this device" and "this user".
//
// Why we need them:
//   - `deviceId` lets future cloud sync tell which device produced a
//     write, so we can show "edited on your iPhone" or resolve
//     conflicts intelligently.
//   - `userId` is what the future backend keys data by. Until real
//     accounts exist (Phase K), there is no sign-in, so we treat the
//     device itself as the user: `userId === deviceId`. When auth
//     lands we'll do a one-shot migration from the anonymous id to
//     the authenticated one.
//
// Both ids are generated lazily on first access using the browser's
// built-in `crypto.randomUUID()` (available in all evergreen browsers
// and iOS Safari 15.4+). They're then persisted under a single key so
// every subsequent call returns the same value.
//
// SSR note: during server rendering there is no `window`, so we
// return a stable placeholder string. The first real call from the
// browser will create and persist the real id.

import { STORAGE_KEYS } from "./keys";
import { getItem, setItem } from "./storage";

type Ids = {
  deviceId: string;
  userId: string;
};

/** Returned during SSR when no real id can be created yet. */
const SSR_PLACEHOLDER = "ssr-placeholder";

/** In-memory cache so repeated calls don't hit localStorage. */
let cache: Ids | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function generateId(): string {
  // `crypto.randomUUID` is the modern, dependency-free way to make a
  // v4 UUID. Fallback shouldn't be needed in our supported browsers,
  // but we guard just in case the API is missing (e.g. very old WebView).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Minimal fallback — not cryptographically strong, but acceptable
  // for an opaque local identifier.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Read both ids from storage, creating and persisting them on first run.
 * Always returns a defined object; values are placeholders during SSR.
 */
function loadIds(): Ids {
  if (cache) return cache;

  if (!isBrowser()) {
    return { deviceId: SSR_PLACEHOLDER, userId: SSR_PLACEHOLDER };
  }

  const stored = getItem<Partial<Ids>>(STORAGE_KEYS.ids);
  if (stored && stored.deviceId && stored.userId) {
    cache = { deviceId: stored.deviceId, userId: stored.userId };
    return cache;
  }

  const deviceId = stored?.deviceId ?? generateId();
  // For v1 there are no accounts, so the user is the device.
  const userId = stored?.userId ?? deviceId;

  cache = { deviceId, userId };
  setItem<Ids>(STORAGE_KEYS.ids, cache);
  return cache;
}

/** Stable per-device id. Created on first browser call, then cached. */
export function getDeviceId(): string {
  return loadIds().deviceId;
}

/** Stable per-user id. Equals deviceId until real auth ships. */
export function getUserId(): string {
  return loadIds().userId;
}
