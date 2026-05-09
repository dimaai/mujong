// ============================================================
// api/src/sessions/tableStore.ts
//
// PURPOSE
//   Azure Table Storage-backed implementation of `SessionStore`,
//   used in the deployed Static Web App so that signaling
//   sessions survive across Function worker instances and cold
//   starts (IMPLEMENTATION_PLAN Step 15.5).
//
//   The same `SessionStore` interface is implemented by the
//   in-memory `createStore` factory in `store.ts`. Handlers
//   never know which one they're talking to — the singleton in
//   `defaultStore.ts` chooses based on whether the
//   `AzureWebJobsStorage` connection string is present.
//
//   Schema:
//     - One Azure Table named `mojongSessions`.
//     - PartitionKey is a single shard, `'s'`. We have only one
//       Function host and very low write volume; a single
//       partition keeps batching trivial and avoids cross-
//       partition queries on the prune path.
//     - RowKey is the 6-character invitation code (uppercase).
//     - All writes use ETag concurrency. SDP/ICE updates loop
//       up to a few times on `412 Precondition Failed` so
//       simultaneous host+joiner traffic doesn't lose updates.
//
//   This file is the only one in `api/` that imports
//   `@azure/data-tables`, keeping that dependency away from the
//   pure store and the unit tests.
// ============================================================

import {
  TableClient,
  TableServiceClient,
  RestError,
  odata,
  type TableEntity,
  type TableEntityResult,
} from '@azure/data-tables';
import { type TokenCredential } from '@azure/identity';

import {
  MAX_ICE_QUEUE,
  SessionAlreadyJoinedError,
  SessionCollisionError,
  SessionNotFoundError,
  type AppendIceResult,
  type DrainIceResult,
  type Session,
  type SessionRole,
  type SessionStore,
  type StoreDeps,
} from './store.js';

const TABLE_NAME = 'mojongSessions';
const PARTITION = 's';

/**
 * Maximum optimistic-concurrency retries for SDP/ICE writes. In
 * practice the host and joiner barely contend, so 1–2 retries is
 * plenty; we cap at 5 just so a stuck client can't loop forever.
 */
const ETAG_RETRIES = 5;

/**
 * Shape of one row in the `mojongSessions` table. We flatten the
 * `Session` interface: the two ICE arrays are JSON-serialised so
 * Table Storage's flat-property model is happy.
 */
interface SessionEntity extends TableEntity {
  partitionKey: string;
  rowKey: string;
  createdAt: number;
  hostToken: string;
  joinerToken?: string;
  hostSdp?: string;
  joinerSdp?: string;
  /** JSON-serialised `string[]`. Empty array stored as `'[]'`. */
  hostIceJson: string;
  /** JSON-serialised `string[]`. */
  joinerIceJson: string;
}

/** Translate a fetched row back into the domain `Session` shape. */
function rowToSession(row: TableEntityResult<SessionEntity>): Session {
  return {
    code: row.rowKey,
    createdAt: row.createdAt,
    hostToken: row.hostToken,
    joinerToken: row.joinerToken,
    hostSdp: row.hostSdp,
    joinerSdp: row.joinerSdp,
    hostIce: parseIce(row.hostIceJson),
    joinerIce: parseIce(row.joinerIceJson),
  };
}

function parseIce(json: string | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * `true` when an Azure SDK error is the 404 / 409 / 412 we care
 * about. Anything else propagates as a real failure.
 */
function isStatus(err: unknown, status: number): boolean {
  return err instanceof RestError && err.statusCode === status;
}

/**
 * Two ways to authenticate against the Table service:
 *   - `connectionString`: shared-key path. Used by Azurite locally
 *     and by deployments where the storage account allows key
 *     access.
 *   - `endpoint` + `credential`: AAD path (e.g. SWA Functions'
 *     system-assigned managed identity with the
 *     "Storage Table Data Contributor" role). Required when the
 *     storage account has "Allow storage account key access"
 *     disabled by org policy.
 */
export type TableAuth =
  | { kind: 'connectionString'; connectionString: string }
  | { kind: 'aad'; endpoint: string; credential: TokenCredential };

/**
 * Lazily ensure the Table exists. Called once on the first
 * operation per process; cached afterwards. Cheap when the table
 * is already there — the create is a single PUT and Azure
 * returns 409 for an existing table, which we ignore.
 */
async function ensureTable(auth: TableAuth): Promise<TableClient> {
  const allowInsecure =
    auth.kind === 'connectionString' &&
    auth.connectionString.includes('UseDevelopmentStorage');

  const service =
    auth.kind === 'connectionString'
      ? TableServiceClient.fromConnectionString(auth.connectionString, {
          allowInsecureConnection: allowInsecure,
        })
      : new TableServiceClient(auth.endpoint, auth.credential);

  try {
    await service.createTable(TABLE_NAME);
  } catch (err) {
    // 409 = "TableAlreadyExists" — fine.
    if (!isStatus(err, 409)) throw err;
  }

  return auth.kind === 'connectionString'
    ? TableClient.fromConnectionString(auth.connectionString, TABLE_NAME, {
        allowInsecureConnection: allowInsecure,
      })
    : new TableClient(auth.endpoint, TABLE_NAME, auth.credential);
}

/**
 * Create a `SessionStore` backed by Azure Table Storage. The
 * `deps` are the same RNG / clock injections the in-memory store
 * uses, so production and tests share the same wiring shape.
 */
export function createTableStore(
  deps: StoreDeps & { auth: TableAuth },
): SessionStore {
  const maxAttempts = deps.maxAttempts ?? 8;
  let clientP: Promise<TableClient> | null = null;
  const client = (): Promise<TableClient> => {
    if (!clientP) clientP = ensureTable(deps.auth);
    return clientP;
  };

  // ── Helpers ─────────────────────────────────────────────

  /** Read one row by code. Returns `undefined` on 404. */
  async function fetchEntity(
    code: string,
  ): Promise<TableEntityResult<SessionEntity> | undefined> {
    try {
      const c = await client();
      return await c.getEntity<SessionEntity>(PARTITION, code);
    } catch (err) {
      if (isStatus(err, 404)) return undefined;
      throw err;
    }
  }

  /**
   * Read → mutate → updateEntity(Replace) with ETag, retrying on
   * `412 Precondition Failed`. Returns whatever `mutate` returns
   * on success, or `undefined` if the row is not found.
   */
  async function updateWithEtag<R>(
    code: string,
    mutate: (row: SessionEntity) => R,
  ): Promise<{ ok: true; result: R } | { ok: false; reason: 'not_found' }> {
    const c = await client();
    for (let attempt = 0; attempt < ETAG_RETRIES; attempt++) {
      const row = await fetchEntity(code);
      if (!row) return { ok: false, reason: 'not_found' };
      const etag = row.etag;
      const result = mutate(row);
      try {
        await c.updateEntity(row, 'Replace', { etag });
        return { ok: true, result };
      } catch (err) {
        // 412 = ETag mismatch; reread and retry.
        if (isStatus(err, 412)) continue;
        // 404 = row deleted between read and write.
        if (isStatus(err, 404)) return { ok: false, reason: 'not_found' };
        throw err;
      }
    }
    // Exhausted retries — extremely unlikely. Surface as not_found
    // so the caller backs off cleanly rather than 500s.
    return { ok: false, reason: 'not_found' };
  }

  // ── Public API ──────────────────────────────────────────

  async function createSession(): Promise<{ code: string; hostToken: string }> {
    const c = await client();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const code = deps.randomCode();
      const hostToken = deps.randomToken();
      const entity: SessionEntity = {
        partitionKey: PARTITION,
        rowKey: code,
        createdAt: deps.now(),
        hostToken,
        hostIceJson: '[]',
        joinerIceJson: '[]',
      };
      try {
        await c.createEntity(entity);
        return { code, hostToken };
      } catch (err) {
        // 409 = "EntityAlreadyExists" → collision; pick a new code.
        if (isStatus(err, 409)) continue;
        throw err;
      }
    }
    throw new SessionCollisionError(maxAttempts);
  }

  async function joinSession(code: string): Promise<{ joinerToken: string }> {
    const newToken = deps.randomToken();
    let alreadyJoined = false;
    const result = await updateWithEtag(code, (row) => {
      if (row.joinerToken) {
        alreadyJoined = true;
        return null;
      }
      row.joinerToken = newToken;
      return null;
    });
    if (!result.ok) throw new SessionNotFoundError(code);
    if (alreadyJoined) throw new SessionAlreadyJoinedError(code);
    return { joinerToken: newToken };
  }

  async function getSession(code: string): Promise<Session | undefined> {
    const row = await fetchEntity(code);
    return row ? rowToSession(row) : undefined;
  }

  async function setSdp(
    code: string,
    role: SessionRole,
    sdp: string,
  ): Promise<boolean> {
    const result = await updateWithEtag(code, (row) => {
      if (role === 'host') row.hostSdp = sdp;
      else row.joinerSdp = sdp;
    });
    return result.ok;
  }

  async function appendIce(
    code: string,
    role: SessionRole,
    candidateJson: string,
  ): Promise<AppendIceResult> {
    let outcome: AppendIceResult = 'ok';
    const result = await updateWithEtag(code, (row) => {
      const queue = parseIce(role === 'host' ? row.hostIceJson : row.joinerIceJson);
      if (queue.length >= MAX_ICE_QUEUE) {
        outcome = 'queue_full';
        return;
      }
      queue.push(candidateJson);
      const json = JSON.stringify(queue);
      if (role === 'host') row.hostIceJson = json;
      else row.joinerIceJson = json;
    });
    if (!result.ok) return 'not_found';
    return outcome;
  }

  async function drainIce(
    code: string,
    role: SessionRole,
  ): Promise<DrainIceResult> {
    let drained: string[] = [];
    const result = await updateWithEtag(code, (row) => {
      drained = parseIce(role === 'host' ? row.hostIceJson : row.joinerIceJson);
      if (drained.length === 0) return;
      if (role === 'host') row.hostIceJson = '[]';
      else row.joinerIceJson = '[]';
    });
    if (!result.ok) return { found: false };
    const candidates = drained.map((j) => JSON.parse(j) as unknown);
    return { found: true, candidates };
  }

  async function deleteSession(code: string): Promise<boolean> {
    const c = await client();
    try {
      await c.deleteEntity(PARTITION, code);
      return true;
    } catch (err) {
      if (isStatus(err, 404)) return false;
      throw err;
    }
  }

  async function prune(beforeMs: number): Promise<number> {
    const c = await client();
    const filter = odata`PartitionKey eq ${PARTITION} and createdAt lt ${beforeMs}`;
    let removed = 0;
    // queryEntities is async-iterable; we cap the per-call work
    // because this runs on every request. A single page (default
    // ~1000 rows) is far more than v1 will ever hold live.
    const iter = c.listEntities<SessionEntity>({ queryOptions: { filter } });
    for await (const row of iter) {
      try {
        await c.deleteEntity(row.partitionKey ?? PARTITION, row.rowKey ?? '');
        removed += 1;
      } catch (err) {
        // Tolerate a row vanishing under us (someone else pruned it).
        if (!isStatus(err, 404)) throw err;
      }
    }
    return removed;
  }

  return {
    createSession,
    joinSession,
    getSession,
    setSdp,
    appendIce,
    drainIce,
    deleteSession,
    prune,
  };
}
