// ============================================================
// api/src/functions/syncPut.ts
//
// PURPOSE
//   HTTP entry point for `PUT /api/sync/{userId}/{kind}` — the
//   write half of Phase J cloud sync
//   (IMPLEMENTATION_PLAN Step 26).
//
//   Wire contract (mirrors `src/sync/httpClient.ts`):
//     200                              → write accepted
//     409 { current: PersistedEnvelope } → stored envelope is
//                                          newer; client should
//                                          reconcile and retry
//     400                              → malformed userId, kind,
//                                          or body envelope
//
//   Authentication is intentionally OUT OF SCOPE for v1 because
//   `userId === deviceId` until Phase K introduces real accounts.
//   TODO(K-1): wire SWA `x-ms-client-principal` here.
// ============================================================

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';

import { defaultSyncStore } from '../sync/defaultStore.js';
import type { PersistedEnvelope } from '../sync/store.js';
import { parseEnvelope, parseUserIdAndKind } from './syncShared.js';

export async function syncPutHandler(
  req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  const parsed = parseUserIdAndKind(req);
  if (!parsed.ok) {
    return { status: 400, jsonBody: { error: parsed.error } };
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { status: 400, jsonBody: { error: 'bad_json' } };
  }

  const envelopeResult = parseEnvelope(body);
  if (!envelopeResult.ok) {
    return { status: 400, jsonBody: { error: envelopeResult.error } };
  }
  const envelope: PersistedEnvelope = envelopeResult.envelope;

  try {
    const result = await defaultSyncStore.write(
      parsed.userId,
      parsed.kind,
      envelope,
    );
    if (result.ok) {
      ctx.log(
        `sync put: user=${parsed.userId} kind=${parsed.kind} ` +
          `v=${envelope.v} updatedAt=${envelope.updatedAt}`,
      );
      return { status: 200, jsonBody: { ok: true } };
    }
    // Stored envelope is authoritative. Surface it so the client
    // can fold it into its local reconciler and retry.
    return { status: 409, jsonBody: { current: result.current } };
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    ctx.error('syncPut failed', err);
    return { status: 500, jsonBody: { error: 'internal', detail: reason } };
  }
}

app.http('syncPut', {
  methods: ['PUT'],
  route: 'sync/{userid}/{kind}',
  authLevel: 'anonymous',
  handler: syncPutHandler,
});
