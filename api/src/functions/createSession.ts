// ============================================================
// api/src/functions/createSession.ts
//
// PURPOSE
//   HTTP entry point for `POST /api/sessions`. Thin adapter:
//   delegates everything that isn't HTTP-specific to the pure
//   `defaultStore`.
//
//   Inputs   : (none — body is ignored in Step 13)
//   Outputs  : 201 { code, hostToken }   on success
//              500 { error: 'internal' } on collision exhaustion
//   Side fx  : adds one entry to the in-process session map
// ============================================================

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { defaultStore } from '../sessions/defaultStore.js';
import { SessionCollisionError } from '../sessions/store.js';

export async function createSessionHandler(
  _req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const { code, hostToken } = await defaultStore.createSession();
    ctx.log(`session created: ${code}`);
    return {
      status: 201,
      jsonBody: { code, hostToken },
    };
  } catch (err) {
    if (err instanceof SessionCollisionError) {
      ctx.error(err.message);
      return { status: 500, jsonBody: { error: 'collision' } };
    }
    // Surface a short reason string so a misconfigured deploy
    // (bad table connection string, missing permissions, etc.) is
    // visible to the client without leaking stack traces.
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    ctx.error('createSession failed', err);
    return { status: 500, jsonBody: { error: 'internal', detail: reason } };
  }
}

app.http('createSession', {
  methods: ['POST'],
  route: 'sessions',
  authLevel: 'anonymous',
  handler: createSessionHandler,
});
