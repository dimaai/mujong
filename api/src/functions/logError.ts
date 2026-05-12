// ============================================================
// api/src/functions/logError.ts
//
// PURPOSE
//   HTTP entry point for `POST /api/logError` — the server side
//   of the Step 33 (Phase L-3) root error boundary. The client
//   POSTs one row per render-time crash; we persist it to a
//   `mojongClientErrors` Azure Table for later diagnosis.
//
//   Wire contract (mirrors the client payload in
//   `src/components/ErrorBoundary/ErrorBoundary.tsx`):
//     200 { ok: true }                — row stored
//     202 { ok: true, persisted: false } — no Table Storage
//                                          configured; we still
//                                          accept the request so
//                                          the client never sees
//                                          a failure for logging
//     400 { error }                   — malformed body / fields
//
//   Authentication is intentionally OUT OF SCOPE. The endpoint
//   is anonymous on purpose: a client that just crashed may not
//   have a session/principal we can rely on, and the payload
//   only carries opaque ids the client already chose.
//
// SECURITY NOTES
//   - Payload sizes are clamped (8 KB total, 4 KB stack) so a
//     malicious client can't flood Table Storage with megabyte
//     blobs.
//   - We never echo the payload back, never set CORS to `*`
//     with credentials, and never log secrets.
//   - The endpoint is best-effort: any storage error becomes a
//     500 but the client treats every non-2xx as silent.
// ============================================================

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';
import {
  TableClient,
  TableServiceClient,
  RestError,
  type TableEntity,
} from '@azure/data-tables';
import { ManagedIdentityCredential } from '@azure/identity';

const TABLE_NAME = 'mojongClientErrors';

/** Hard caps so a single row can't blow up Table Storage. */
const MAX_MESSAGE = 1024;
const MAX_STACK = 4096;
const MAX_FIELD = 256;

interface ClientErrorPayload {
  message: string;
  stack: string;
  userId: string;
  deviceId: string;
  build: string;
  url: string;
}

interface ErrorRow extends TableEntity {
  partitionKey: string;
  rowKey: string;
  message: string;
  stack: string;
  userId: string;
  deviceId: string;
  build: string;
  url: string;
  receivedAt: number;
}

/**
 * Validate and normalise the request body. Returns the trimmed
 * payload or a string describing why parsing failed.
 */
function parsePayload(body: unknown): ClientErrorPayload | string {
  if (!body || typeof body !== 'object') return 'bad_body';
  const b = body as Record<string, unknown>;

  const message = typeof b.message === 'string' ? b.message : '';
  const stack = typeof b.stack === 'string' ? b.stack : '';
  const userId = typeof b.userId === 'string' ? b.userId : '';
  const deviceId = typeof b.deviceId === 'string' ? b.deviceId : '';
  const build = typeof b.build === 'string' ? b.build : '';
  const url = typeof b.url === 'string' ? b.url : '';

  if (!message) return 'missing_message';

  return {
    message: message.slice(0, MAX_MESSAGE),
    stack: stack.slice(0, MAX_STACK),
    userId: userId.slice(0, MAX_FIELD),
    deviceId: deviceId.slice(0, MAX_FIELD),
    build: build.slice(0, MAX_FIELD),
    url: url.slice(0, MAX_FIELD),
  };
}

/**
 * Resolve a `TableClient` from the same env vars the sync /
 * sessions stores use. Returns `null` when nothing is
 * configured (offline `func start`, local dev with no storage),
 * in which case the handler accepts-but-doesn't-persist.
 */
let clientP: Promise<TableClient> | null = null;
function getClient(): Promise<TableClient> | null {
  if (clientP) return clientP;

  const endpoint = process.env.MOJONG_TABLES_ENDPOINT?.trim();
  const conn = (
    process.env.MOJONG_TABLES_CONN ?? process.env.AzureWebJobsStorage
  )?.trim();

  if (!endpoint && !conn) return null;

  clientP = (async () => {
    const allowInsecure =
      !!conn && conn.includes('UseDevelopmentStorage');

    const service = endpoint
      ? new TableServiceClient(endpoint, new ManagedIdentityCredential())
      : TableServiceClient.fromConnectionString(conn as string, {
          allowInsecureConnection: allowInsecure,
        });

    try {
      await service.createTable(TABLE_NAME);
    } catch (err) {
      // 409 = "already exists", which is the steady state.
      if (!(err instanceof RestError) || err.statusCode !== 409) throw err;
    }

    return endpoint
      ? new TableClient(endpoint, TABLE_NAME, new ManagedIdentityCredential())
      : TableClient.fromConnectionString(conn as string, TABLE_NAME, {
          allowInsecureConnection: allowInsecure,
        });
  })();

  return clientP;
}

/**
 * Build a sortable, unique RowKey. Table Storage sorts strings
 * lexicographically, so we pad the reverse-timestamp with zeros
 * to keep the newest row first when scanning.
 */
function makeRowKey(now: number): string {
  const reverse = (10n ** 16n - BigInt(now)).toString().padStart(16, '0');
  const noise = Math.random().toString(36).slice(2, 8);
  return `${reverse}-${noise}`;
}

export async function logErrorHandler(
  req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { status: 400, jsonBody: { error: 'bad_json' } };
  }

  const parsed = parsePayload(body);
  if (typeof parsed === 'string') {
    return { status: 400, jsonBody: { error: parsed } };
  }

  const clientPromise = getClient();
  if (!clientPromise) {
    // No Table Storage configured — record the crash in the
    // Function log so a local `func start` session can still
    // see it, but tell the client we accepted the request.
    ctx.warn(
      `logError (no storage): build=${parsed.build} url=${parsed.url} ` +
        `user=${parsed.userId} msg=${parsed.message}`,
    );
    return { status: 202, jsonBody: { ok: true, persisted: false } };
  }

  const now = Date.now();
  // PartitionKey is the YYYY-MM-DD bucket so daily queries stay
  // single-partition and the table doesn't grow one hot key
  // forever.
  const partition = new Date(now).toISOString().slice(0, 10);

  const row: ErrorRow = {
    partitionKey: partition,
    rowKey: makeRowKey(now),
    message: parsed.message,
    stack: parsed.stack,
    userId: parsed.userId,
    deviceId: parsed.deviceId,
    build: parsed.build,
    url: parsed.url,
    receivedAt: now,
  };

  try {
    const client = await clientPromise;
    await client.createEntity(row);
    ctx.log(
      `logError stored: build=${parsed.build} user=${parsed.userId} ` +
        `msg=${parsed.message.slice(0, 80)}`,
    );
    return { status: 200, jsonBody: { ok: true } };
  } catch (err) {
    ctx.error('logError storage failure', err);
    return { status: 500, jsonBody: { error: 'internal' } };
  }
}

app.http('logError', {
  methods: ['POST'],
  route: 'logError',
  authLevel: 'anonymous',
  handler: logErrorHandler,
});
