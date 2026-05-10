// ============================================================
// api/src/functions/reattachSession.ts
//
// PURPOSE
//   HTTP entry point for `POST /api/sessions/{code}/reattach`
//   (IMPLEMENTATION_PLAN Step 19.5).
//
//   A peer that briefly lost its DataChannel calls this with
//   the bearer token it was issued at create/join time. The
//   server validates the token, clears the SDP slots and ICE
//   queues for a fresh handshake, and returns the caller's
//   role plus the updated renegotiation counter.
//
//     200 { role: 'host' | 'joiner', renegotiationCount }
//     400 { error: 'bad_code' }
//     401 { error: 'no_token' | 'bad_token' }
//     404 { error: 'not_found' }     unknown / expired code
//     429 { error: 'reneg_limit' }   too many reattach attempts
//
//   This endpoint is the ONLY way a client gets a second SDP
//   exchange under the same code. The existing PUT/GET on
//   `/sdp/{role}` then keep working unchanged because the
//   slots have been cleared.
// ============================================================

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';

import { defaultStore } from '../sessions/defaultStore.js';
import { pruneExpired } from '../sessions/cleanup.js';
import {
  SessionAuthError,
  SessionNotFoundError,
  SessionRenegotiationLimitError,
} from '../sessions/store.js';

const CODE_RE = /^[2-9A-HJ-KMNP-Z]{6}$/;

function bearerToken(req: HttpRequest): string | null {
  const custom = req.headers.get('x-mojong-token');
  if (custom && custom.trim()) return custom.trim();
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

export async function reattachSessionHandler(
  req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  await pruneExpired(defaultStore, Date.now());

  const code = (req.params.code ?? '').toUpperCase();
  if (!CODE_RE.test(code)) {
    return { status: 400, jsonBody: { error: 'bad_code' } };
  }

  const token = bearerToken(req);
  if (!token) return { status: 401, jsonBody: { error: 'no_token' } };

  try {
    const { role, renegotiationCount } = await defaultStore.reattach(code, token);
    ctx.log(`session reattach: code=${code} role=${role} count=${renegotiationCount}`);
    return { status: 200, jsonBody: { role, renegotiationCount } };
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return { status: 404, jsonBody: { error: 'not_found' } };
    }
    if (err instanceof SessionAuthError) {
      return { status: 401, jsonBody: { error: 'bad_token' } };
    }
    if (err instanceof SessionRenegotiationLimitError) {
      return { status: 429, jsonBody: { error: 'reneg_limit' } };
    }
    ctx.error('reattachSession failed', err);
    return { status: 500, jsonBody: { error: 'internal' } };
  }
}

app.http('reattachSession', {
  methods: ['POST'],
  route: 'sessions/{code}/reattach',
  authLevel: 'anonymous',
  handler: reattachSessionHandler,
});
