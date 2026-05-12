// ============================================================
// api/src/sync/__tests__/store.test.ts
//
// Unit tests for the pure in-memory `SyncStore`. The Azure
// Table-backed variant is not exercised here (it's tested in
// production via Azurite-driven integration runs, just like
// `sessions/tableStore.ts`); both share the `incomingWins`
// decision so the LWW matrix below is the real contract surface.
// ============================================================

import { describe, expect, it } from 'vitest';

import {
  createSyncStore,
  incomingWins,
  type PersistedEnvelope,
} from '../store.js';

function env(
  partial: Partial<PersistedEnvelope> & { updatedAt: number },
): PersistedEnvelope {
  return {
    v: 1,
    data: { hello: 'world' },
    deviceId: 'dev-A',
    ...partial,
  };
}

describe('SyncStore.read', () => {
  it('returns null when nothing has been written', async () => {
    const store = createSyncStore();
    expect(await store.read('user-1', 'profile')).toBeNull();
  });

  it('round-trips a written envelope', async () => {
    const store = createSyncStore();
    const written = env({ updatedAt: 100 });
    await store.write('user-1', 'profile', written);
    const read = await store.read('user-1', 'profile');
    expect(read).toEqual(written);
  });

  it('isolates per (userId, kind) tuple', async () => {
    const store = createSyncStore();
    await store.write('user-1', 'profile', env({ updatedAt: 1, data: 'P1' }));
    await store.write('user-1', 'settings', env({ updatedAt: 2, data: 'S1' }));
    await store.write('user-2', 'profile', env({ updatedAt: 3, data: 'P2' }));
    expect((await store.read('user-1', 'profile'))?.data).toBe('P1');
    expect((await store.read('user-1', 'settings'))?.data).toBe('S1');
    expect((await store.read('user-2', 'profile'))?.data).toBe('P2');
    expect(await store.read('user-2', 'settings')).toBeNull();
  });
});

describe('SyncStore.write — LWW matrix', () => {
  it('accepts the first write (no current envelope)', async () => {
    const store = createSyncStore();
    const e = env({ updatedAt: 10 });
    const result = await store.write('u', 'profile', e);
    expect(result.ok).toBe(true);
    expect(await store.read('u', 'profile')).toEqual(e);
  });

  it('accepts strictly newer updatedAt', async () => {
    const store = createSyncStore();
    await store.write('u', 'profile', env({ updatedAt: 10 }));
    const newer = env({ updatedAt: 20, data: 'new' });
    const result = await store.write('u', 'profile', newer);
    expect(result.ok).toBe(true);
    expect((await store.read('u', 'profile'))?.data).toBe('new');
  });

  it('rejects strictly older updatedAt with 409-shaped result', async () => {
    const store = createSyncStore();
    const current = env({ updatedAt: 20, data: 'keep' });
    await store.write('u', 'profile', current);
    const older = env({ updatedAt: 10, data: 'drop' });
    const result = await store.write('u', 'profile', older);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.current).toEqual(current);
    }
    expect((await store.read('u', 'profile'))?.data).toBe('keep');
  });

  it('breaks updatedAt ties by lexicographically smaller deviceId', async () => {
    const store = createSyncStore();
    // Seed with deviceId 'dev-B' …
    await store.write(
      'u',
      'profile',
      env({ updatedAt: 50, deviceId: 'dev-B', data: 'B' }),
    );
    // … then write with the smaller deviceId 'dev-A' at the same ms.
    // Smaller wins.
    const result = await store.write(
      'u',
      'profile',
      env({ updatedAt: 50, deviceId: 'dev-A', data: 'A' }),
    );
    expect(result.ok).toBe(true);
    expect((await store.read('u', 'profile'))?.data).toBe('A');

    // Reverse direction: writing the larger deviceId now must lose.
    const losing = await store.write(
      'u',
      'profile',
      env({ updatedAt: 50, deviceId: 'dev-B', data: 'B-again' }),
    );
    expect(losing.ok).toBe(false);
    expect((await store.read('u', 'profile'))?.data).toBe('A');
  });

  it('treats identical envelopes as already-stored (no-op, 409)', async () => {
    const store = createSyncStore();
    const e = env({ updatedAt: 50, deviceId: 'dev-A', data: 'same' });
    await store.write('u', 'profile', e);
    const dup = await store.write('u', 'profile', { ...e });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.current).toEqual(e);
  });

  it('higher schema-version wins regardless of updatedAt', async () => {
    const store = createSyncStore();
    // Stored has older v but NEWER updatedAt.
    await store.write(
      'u',
      'profile',
      env({ v: 1, updatedAt: 1000, data: 'old-schema-but-newer' }),
    );
    // Incoming bumps schema version: should win even though older ms.
    const result = await store.write(
      'u',
      'profile',
      env({ v: 2, updatedAt: 100, data: 'new-schema' }),
    );
    expect(result.ok).toBe(true);
    expect(await store.read('u', 'profile')).toMatchObject({
      v: 2,
      data: 'new-schema',
    });
  });

  it('lower schema-version loses even when updatedAt is newer', async () => {
    const store = createSyncStore();
    await store.write('u', 'profile', env({ v: 2, updatedAt: 100 }));
    const downgrade = env({ v: 1, updatedAt: 9999, data: 'downgrade' });
    const result = await store.write('u', 'profile', downgrade);
    expect(result.ok).toBe(false);
    expect((await store.read('u', 'profile'))?.v).toBe(2);
  });

  it('returns a defensive copy so external mutation does not leak in', async () => {
    const store = createSyncStore();
    const e = env({ updatedAt: 10, data: { count: 1 } });
    await store.write('u', 'profile', e);
    // Mutate the caller's reference.
    (e.data as { count: number }).count = 999;
    const read = await store.read('u', 'profile');
    expect((read?.data as { count: number }).count).toBe(1);
  });
});

describe('incomingWins (decision rule)', () => {
  it('null current always loses', () => {
    expect(incomingWins(null, env({ updatedAt: 0 }))).toBe(true);
  });

  it('matches the SyncStore matrix on representative cases', () => {
    const older = env({ updatedAt: 10 });
    const newer = env({ updatedAt: 20 });
    expect(incomingWins(older, newer)).toBe(true);
    expect(incomingWins(newer, older)).toBe(false);

    const a = env({ updatedAt: 5, deviceId: 'A' });
    const b = env({ updatedAt: 5, deviceId: 'B' });
    expect(incomingWins(b, a)).toBe(true); // 'A' < 'B'
    expect(incomingWins(a, b)).toBe(false);

    const v1 = env({ v: 1, updatedAt: 9999 });
    const v2 = env({ v: 2, updatedAt: 1 });
    expect(incomingWins(v1, v2)).toBe(true);
    expect(incomingWins(v2, v1)).toBe(false);
  });
});
