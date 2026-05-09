// ============================================================
// api/src/functions/exchangeIce.ts
//
// PURPOSE
//   HTTP entry point for ICE-candidate relay
//   (IMPLEMENTATION_PLAN Step 14).
//
//     POST /api/sessions/{code}/ice/{role}
//        body  : RTCIceCandidateInit | null    (null = end-of-candidates)
//        auth  : Authorization: Bearer <token-for-{role}>
//        200   : { ok: true }
//
//     GET /api/sessions/{code}/ice/{role}
//        auth  : Authorization: Bearer <any token for the session>
//        200   : { candidates: [<json>, ...] }  (drains the slot;
//                may include the literal string "null" for
//                end-of-candidates)
//        204   : nothing arrived within the long-poll timeout
//
//   The role parameter names the slot being read or written —
//   the symmetric model used by `exchangeSdp.ts`. Host writes
//   `host` candidates and reads `joiner` candidates; joiner
//   does the mirror image.
//
//   Candidates are stored as JSON strings inside the session
//   record. We never deserialize them on the server: this is a
//   dumb relay, not an ICE parser.
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

const POLL_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 100;
const MAX_QUEUE = 256; // sanity cap — real handshakes use <50

type Role = 'host' | 'joiner';

function parseRole(raw: string | undefined): Role | null {
  return raw === 'host' || raw === 'joiner' ? raw : null;
}

function bearerToken(req: HttpRequest): string | null {
  const custom = req.headers.get('x-mojong-token');
  if (custom && custom.trim()) return custom.trim();
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1]!.trim() : null;
}

function tokenMatchesRole(s: Session, role: Role, token: string): boolean {
  return role === 'host' ? s.hostToken === token : s.joinerToken === token;
}

function tokenIsForSession(s: Session, token: string): boolean {
  return s.hostToken === token || s.joinerToken === token;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export async function exchangeIceHandler(
  req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  pruneExpired(defaultStore, Date.now());

  const code = (req.params.code ?? '').toUpperCase();
  const role = parseRole(req.params.role);
  if (!role) return { status: 400, jsonBody: { error: 'bad_role' } };

  const token = bearerToken(req);
  if (!token) return { status: 401, jsonBody: { error: 'no_token' } };

  const session = defaultStore.getSession(code);
  if (!session) return { status: 404, jsonBody: { error: 'not_found' } };

  if (req.method === 'POST') {
    if (!tokenMatchesRole(session, role, token)) {
      return { status: 401, jsonBody: { error: 'bad_token' } };
    }
    // Body is either an RTCIceCandidateInit object or `null`
    // (end-of-candidates). We re-serialize so the GET side
    // returns identical JSON.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return { status: 400, jsonBody: { error: 'bad_json' } };
    }
    if (body !== null && (typeof body !== 'object' || Array.isArray(body))) {
      return { status: 400, jsonBody: { error: 'bad_candidate' } };
    }
    const queue = role === 'host' ? session.hostIce : session.joinerIce;
    if (queue.length >= MAX_QUEUE) {
      return { status: 429, jsonBody: { error: 'queue_full' } };
    }
    queue.push(JSON.stringify(body));
    ctx.log(`ice post: code=${code} role=${role} count=${queue.length}`);
    return { status: 200, jsonBody: { ok: true } };
  }

  if (req.method === 'GET') {
    if (!tokenIsForSession(session, token)) {
      return { status: 401, jsonBody: { error: 'bad_token' } };
    }
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const fresh = defaultStore.getSession(code);
      if (!fresh) return { status: 404, jsonBody: { error: 'not_found' } };
      const queue = role === 'host' ? fresh.hostIce : fresh.joinerIce;
      if (queue.length > 0) {
        // Drain atomically: splice empties the array so the next
        // poll sees only new arrivals.
        const drained = queue.splice(0, queue.length);
        const candidates = drained.map((s) => JSON.parse(s) as unknown);
        return { status: 200, jsonBody: { candidates } };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { status: 204 };
  }

  return { status: 405, jsonBody: { error: 'method_not_allowed' } };
}

app.http('exchangeIce', {
  methods: ['POST', 'GET'],
  route: 'sessions/{code}/ice/{role}',
  authLevel: 'anonymous',
  handler: exchangeIceHandler,
});
