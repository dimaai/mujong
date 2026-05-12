// ============================================================
// api/src/sync/tableStore.ts
//
// PURPOSE
//   Azure Table Storage-backed `SyncStore` for the deployed
//   Static Web App (IMPLEMENTATION_PLAN Step 26). Same shape as
//   `sessions/tableStore.ts` — only this file imports
//   `@azure/data-tables` so the pure store and the unit tests
//   stay free of that dependency.
//
//   Schema:
//     - One Azure Table named `mojongSync`.
//     - PartitionKey  = `userId`  (v1: equals `deviceId`)
//     - RowKey        = `kind`    (`'profile'` | `'settings'`)
//     - `v`           number   — payload schema version
//     - `updatedAt`   number   — epoch ms of the write
//     - `deviceId`    string   — writer's stable device id
//     - `dataJson`    string   — payload, JSON-serialised so
//                                Table Storage's flat-property
//                                model is happy with arbitrary
//                                nested shapes.
//
//   Concurrency:
//     Writes loop on `412 Precondition Failed` using ETag
//     optimistic concurrency, re-applying the same `incomingWins`
//     decision used by the in-memory store. This means a `PUT`
//     against the live deployment converges to the same envelope
//     a single-threaded run would have produced, even if two
//     devices PUT at the same time.
// ============================================================

import {
  TableClient,
  TableServiceClient,
  RestError,
  type TableEntity,
  type TableEntityResult,
} from '@azure/data-tables';
import { type TokenCredential } from '@azure/core-auth';

import {
  incomingWins,
  type PersistedEnvelope,
  type SyncKind,
  type SyncStore,
  type WriteResult,
} from './store.js';

const TABLE_NAME = 'mojongSync';

/** Maximum ETag retries on a contended `write`. */
const ETAG_RETRIES = 5;

/** Row shape stored in the `mojongSync` table. */
interface SyncEntity extends TableEntity {
  partitionKey: string;
  rowKey: string;
  v: number;
  updatedAt: number;
  deviceId: string;
  /** `data` JSON-serialised so nested objects survive Table Storage. */
  dataJson: string;
}

function rowToEnvelope(row: TableEntityResult<SyncEntity>): PersistedEnvelope {
  let data: unknown;
  try {
    data = JSON.parse(row.dataJson);
  } catch {
    data = null;
  }
  return {
    v: row.v,
    data,
    updatedAt: row.updatedAt,
    deviceId: row.deviceId,
  };
}

function envelopeToRow(
  userId: string,
  kind: SyncKind,
  env: PersistedEnvelope,
): SyncEntity {
  return {
    partitionKey: userId,
    rowKey: kind,
    v: env.v,
    updatedAt: env.updatedAt,
    deviceId: env.deviceId,
    dataJson: JSON.stringify(env.data ?? null),
  };
}

function isStatus(err: unknown, status: number): boolean {
  return err instanceof RestError && err.statusCode === status;
}

/**
 * Authentication options — identical to the sessions store so a
 * deployment configured for one is automatically configured for
 * the other.
 */
export type TableAuth =
  | { kind: 'connectionString'; connectionString: string }
  | { kind: 'aad'; endpoint: string; credential: TokenCredential };

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
    if (!isStatus(err, 409)) throw err;
  }

  return auth.kind === 'connectionString'
    ? TableClient.fromConnectionString(auth.connectionString, TABLE_NAME, {
        allowInsecureConnection: allowInsecure,
      })
    : new TableClient(auth.endpoint, TABLE_NAME, auth.credential);
}

export interface TableSyncStoreDeps {
  auth: TableAuth;
}

/**
 * Create a `SyncStore` backed by Azure Table Storage. Lazily
 * provisions the table on first use; the create call is a single
 * idempotent PUT and we swallow the 409 ("already exists").
 */
export function createTableSyncStore(deps: TableSyncStoreDeps): SyncStore {
  let clientP: Promise<TableClient> | null = null;
  const client = (): Promise<TableClient> => {
    if (!clientP) clientP = ensureTable(deps.auth);
    return clientP;
  };

  async function fetchEntity(
    userId: string,
    kind: SyncKind,
  ): Promise<TableEntityResult<SyncEntity> | undefined> {
    try {
      const c = await client();
      return await c.getEntity<SyncEntity>(userId, kind);
    } catch (err) {
      if (isStatus(err, 404)) return undefined;
      throw err;
    }
  }

  async function read(
    userId: string,
    kind: SyncKind,
  ): Promise<PersistedEnvelope | null> {
    const row = await fetchEntity(userId, kind);
    return row ? rowToEnvelope(row) : null;
  }

  async function write(
    userId: string,
    kind: SyncKind,
    incoming: PersistedEnvelope,
  ): Promise<WriteResult> {
    const c = await client();

    for (let attempt = 0; attempt < ETAG_RETRIES; attempt++) {
      const existing = await fetchEntity(userId, kind);
      const current = existing ? rowToEnvelope(existing) : null;

      if (!incomingWins(current, incoming)) {
        // Stored envelope is authoritative — surface 409.
        return { ok: false, current: current as PersistedEnvelope };
      }

      const row = envelopeToRow(userId, kind, incoming);

      try {
        if (!existing) {
          await c.createEntity(row);
        } else {
          // Replace with ETag concurrency so a parallel writer
          // that landed between our fetch and update is detected.
          await c.updateEntity(row, 'Replace', { etag: existing.etag });
        }
        return { ok: true, stored: { ...incoming } };
      } catch (err) {
        // 409 on create: another writer raced us and inserted
        // first → re-evaluate against their value.
        if (!existing && isStatus(err, 409)) continue;
        // 412 on update: ETag mismatch → re-read and retry.
        if (isStatus(err, 412)) continue;
        // 404 on update: row deleted between read and write → retry as create.
        if (isStatus(err, 404)) continue;
        throw err;
      }
    }

    // Extremely contended path — return the latest current we can
    // see so the client gets a 409 rather than a 500 and can fold
    // the result into its own reconciler.
    const final = await read(userId, kind);
    if (final !== null && !incomingWins(final, incoming)) {
      return { ok: false, current: final };
    }
    // We couldn't land the write but our envelope still appears
    // to be authoritative. Surface the latest snapshot so the
    // client can re-try; treat as 409 against `final` (or against
    // a synthesised null-current).
    return {
      ok: false,
      current: final ?? incoming,
    };
  }

  return { read, write };
}
