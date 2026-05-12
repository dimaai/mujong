// ============================================================
// api/src/functions/syncShared.ts
//
// PURPOSE
//   Boundary-validation helpers shared by `syncGet` and `syncPut`.
//   Per the copilot rules: untrusted input is validated exactly
//   once, at the HTTP edge. Everything inside `api/src/sync/*`
//   trusts that this filter has run.
// ============================================================

import type { HttpRequest } from '@azure/functions';

import {
  SYNC_KINDS,
  type PersistedEnvelope,
  type SyncKind,
} from '../sync/store.js';

/** Path-segment shape for `userId`. Generous enough for UUIDs / nanoids. */
const USER_ID_RE = /^[\w-]{1,64}$/;

const SYNC_KIND_SET: ReadonlySet<string> = new Set<string>(SYNC_KINDS);

export type ParseRouteResult =
  | { ok: true; userId: string; kind: SyncKind }
  | { ok: false; error: 'bad_user_id' | 'bad_kind' };

/** Validate and narrow the `{userid}/{kind}` route segments. */
export function parseUserIdAndKind(req: HttpRequest): ParseRouteResult {
  // Azure Functions normalises route-template parameter names to
  // lowercase, so the source-of-truth lookup is `userid`, not `userId`.
  const userId = (req.params.userid ?? '').trim();
  if (!USER_ID_RE.test(userId)) {
    return { ok: false, error: 'bad_user_id' };
  }
  const kindRaw = (req.params.kind ?? '').trim();
  if (!SYNC_KIND_SET.has(kindRaw)) {
    return { ok: false, error: 'bad_kind' };
  }
  return { ok: true, userId, kind: kindRaw as SyncKind };
}

export type ParseEnvelopeResult =
  | { ok: true; envelope: PersistedEnvelope }
  | { ok: false; error: 'bad_envelope' };

/**
 * Validate that an arbitrary JSON body is a `PersistedEnvelope`.
 * We accept any `data` value (including `null`) because the
 * server is intentionally agnostic about the payload shape — the
 * client owns that schema and bumps `v` when it changes.
 */
export function parseEnvelope(body: unknown): ParseEnvelopeResult {
  if (body === null || typeof body !== 'object') {
    return { ok: false, error: 'bad_envelope' };
  }
  const e = body as Record<string, unknown>;
  if (typeof e.v !== 'number' || !Number.isFinite(e.v)) {
    return { ok: false, error: 'bad_envelope' };
  }
  if (typeof e.updatedAt !== 'number' || !Number.isFinite(e.updatedAt)) {
    return { ok: false, error: 'bad_envelope' };
  }
  if (typeof e.deviceId !== 'string' || e.deviceId.length === 0) {
    return { ok: false, error: 'bad_envelope' };
  }
  if (!('data' in e)) {
    return { ok: false, error: 'bad_envelope' };
  }
  return {
    ok: true,
    envelope: {
      v: e.v,
      data: e.data,
      updatedAt: e.updatedAt,
      deviceId: e.deviceId,
    },
  };
}
