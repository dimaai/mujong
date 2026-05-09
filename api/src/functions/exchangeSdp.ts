// ============================================================
// api/src/functions/exchangeSdp.ts
//
// PURPOSE
//   HTTP entry point for SDP relay (IMPLEMENTATION_PLAN Step 14).
//
//     PUT /api/sessions/{code}/sdp/{role}
//        body  : { "sdp": "<sdp string>" }
//        auth  : Authorization: Bearer <token-for-{role}>
//        200   : { ok: true }
//        401   : token missing or doesn't match {role}'s token
//        404   : unknown / expired code
//
//     GET /api/sessions/{code}/sdp/{role}
//        auth  : Authorization: Bearer <any token for the session>
//        200   : { sdp: "<sdp>" }   (long-polls up to 5 s)
//        204   : nothing posted within the timeout
//        401/404 as above
//
//   `{role}` names the slot being read or written, NOT the
//   caller's role. Host PUTs `host`, then GETs `joiner`; joiner
//   GETs `host`, then PUTs `joiner`. This mirrors the symmetry
//   in `signaling.ts` so both handlers have the same shape.
// ============================================================

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';

import { defaultStore } from '../sessions/defaultStore.js';
import { pruneExpired } from '../sessions/cleanup.js';
import type { Session } from '../sessions/store.js';

/** Long-poll budget. Kept short so a Function instance frees up quickly. */
const POLL_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;

type Role = 'host' | 'joiner';

function parseRole(raw: string | undefined): Role | null {
  return raw === 'host' || raw === 'joiner' ? raw : null;
}

function bearerToken(req: HttpRequest): string | null {
  // Primary header: a custom one, because Azure Static Web Apps
  // reserves `Authorization` for its own managed-auth layer.
  const custom = req.headers.get('x-mojong-token');
  if (custom && custom.trim()) return custom.trim();
  // Backwards-compat: also accept `Authorization: Bearer <t>` for
  // local `func start` development and for any older client builds.
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

/** True if `token` is the bearer token for `role` on this session. */
function tokenMatchesRole(s: Session, role: Role, token: string): boolean {
  return role === 'host' ? s.hostToken === token : s.joinerToken === token;
}

/** True if `token` belongs to either side of this session. */
function tokenIsForSession(s: Session, token: string): boolean {
  return s.hostToken === token || s.joinerToken === token;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export async function exchangeSdpHandler(
  req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  await pruneExpired(defaultStore, Date.now());

  const code = (req.params.code ?? '').toUpperCase();
  const role = parseRole(req.params.role);
  if (!role) return { status: 400, jsonBody: { error: 'bad_role' } };

  const token = bearerToken(req);
  if (!token) return { status: 401, jsonBody: { error: 'no_token' } };

  const session = await defaultStore.getSession(code);
  if (!session) return { status: 404, jsonBody: { error: 'not_found' } };

  if (req.method === 'PUT') {
    if (!tokenMatchesRole(session, role, token)) {
      return { status: 401, jsonBody: { error: 'bad_token' } };
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { error: 'bad_json' } };
    }
    const sdp = (body as { sdp?: unknown } | null)?.sdp;
    if (typeof sdp !== 'string' || sdp.length === 0) {
      return { status: 400, jsonBody: { error: 'bad_sdp' } };
    }
    const ok = await defaultStore.setSdp(code, role, sdp);
    if (!ok) return { status: 404, jsonBody: { error: 'not_found' } };
    ctx.log(`sdp put: code=${code} role=${role} bytes=${sdp.length}`);
    return { status: 200, jsonBody: { ok: true } };
  }

  if (req.method === 'GET') {
    if (!tokenIsForSession(session, token)) {
      return { status: 401, jsonBody: { error: 'bad_token' } };
    }
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // Re-read each iteration in case another call wrote into
      // the slot. Also re-check existence so an opportunistic
      // prune that fired during the wait surfaces as 404.
      const fresh = await defaultStore.getSession(code);
      if (!fresh) return { status: 404, jsonBody: { error: 'not_found' } };
      const slot = role === 'host' ? fresh.hostSdp : fresh.joinerSdp;
      if (slot) return { status: 200, jsonBody: { sdp: slot } };
      await sleep(POLL_INTERVAL_MS);
    }
    return { status: 204 };
  }

  return { status: 405, jsonBody: { error: 'method_not_allowed' } };
}

app.http('exchangeSdp', {
  methods: ['PUT', 'GET'],
  route: 'sessions/{code}/sdp/{role}',
  authLevel: 'anonymous',
  handler: exchangeSdpHandler,
});
