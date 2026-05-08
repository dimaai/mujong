// ============================================================
// api/src/functions/joinSession.ts
//
// PURPOSE
//   HTTP entry point for `POST /api/sessions/{code}/join`.
//   Adapter only — error→status mapping lives here so the pure
//   store stays free of HTTP concepts.
//
//   Inputs   : `{code}` route param (case-insensitive on the
//              wire; we uppercase before lookup so a joiner who
//              types in lowercase still matches)
//   Outputs  : 200 { joinerToken }            success
//              400 { error: 'bad_code' }      malformed code
//              404 { error: 'not_found' }     unknown code
//              409 { error: 'already_joined' }
//   Side fx  : sets `joinerToken` on the matched session
// ============================================================

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { defaultStore } from '../sessions/defaultStore.js';
import {
  SessionAlreadyJoinedError,
  SessionNotFoundError,
} from '../sessions/store.js';

const CODE_RE = /^[2-9A-HJ-KMNP-Z]{6}$/; // 31-char alphabet, length 6

export async function joinSessionHandler(
  req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  const raw = req.params.code ?? '';
  const code = raw.toUpperCase();
  if (!CODE_RE.test(code)) {
    return { status: 400, jsonBody: { error: 'bad_code' } };
  }
  try {
    const { joinerToken } = defaultStore.joinSession(code);
    ctx.log(`session joined: ${code}`);
    return { status: 200, jsonBody: { joinerToken } };
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return { status: 404, jsonBody: { error: 'not_found' } };
    }
    if (err instanceof SessionAlreadyJoinedError) {
      return { status: 409, jsonBody: { error: 'already_joined' } };
    }
    ctx.error('joinSession failed', err);
    return { status: 500, jsonBody: { error: 'internal' } };
  }
}

app.http('joinSession', {
  methods: ['POST'],
  route: 'sessions/{code}/join',
  authLevel: 'anonymous',
  handler: joinSessionHandler,
});
