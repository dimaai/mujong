// ============================================================
// api/src/functions/syncGet.ts
//
// PURPOSE
//   HTTP entry point for `GET /api/sync/{userId}/{kind}` — the
//   server side of Phase J cloud sync
//   (IMPLEMENTATION_PLAN Step 26).
//
//   Wire contract (mirrors `src/sync/httpClient.ts`):
//     200 { v, data, updatedAt, deviceId }  → stored envelope
//     404                                    → nothing stored yet
//     400                                    → malformed userId / kind
//
//   Authentication is intentionally OUT OF SCOPE for v1 because
//   `userId === deviceId` until Phase K introduces real accounts.
//   We trust the path segment; once auth lands the handler will
//   instead derive `userId` from the validated identity token.
//   TODO(K-1): wire SWA `x-ms-client-principal` here.
// ============================================================

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';

import { defaultSyncStore } from '../sync/defaultStore.js';
import { parseUserIdAndKind } from './syncShared.js';

export async function syncGetHandler(
  req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  const parsed = parseUserIdAndKind(req);
  if (!parsed.ok) {
    return { status: 400, jsonBody: { error: parsed.error } };
  }

  try {
    const envelope = await defaultSyncStore.read(parsed.userId, parsed.kind);
    if (envelope === null) {
      return { status: 404, jsonBody: { error: 'not_found' } };
    }
    return { status: 200, jsonBody: envelope };
  } catch (err) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    ctx.error('syncGet failed', err);
    return { status: 500, jsonBody: { error: 'internal', detail: reason } };
  }
}

app.http('syncGet', {
  methods: ['GET'],
  route: 'sync/{userId}/{kind}',
  authLevel: 'anonymous',
  handler: syncGetHandler,
});
