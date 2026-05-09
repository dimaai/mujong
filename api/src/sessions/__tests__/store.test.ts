// ============================================================
// api/src/sessions/__tests__/store.test.ts
//
// Unit tests for the pure in-memory session store. Both deps are
// stubbed:
//   - `randomCode` returns from a queue → lets us script
//     collisions and exhaustion deterministically
//   - `randomToken` returns a counter → lets us assert tokens
//   - `now` returns a fixed timestamp
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  createStore,
  SessionCollisionError,
  SessionNotFoundError,
  SessionAlreadyJoinedError,
  MAX_ICE_QUEUE,
} from '../store.js';

function makeStore(opts: {
  codes: string[];
  tokens?: string[];
  now?: number;
  maxAttempts?: number;
}) {
  const codeQueue = [...opts.codes];
  let tokenCounter = 0;
  const tokenQueue = opts.tokens ? [...opts.tokens] : null;
  return createStore({
    now: () => opts.now ?? 1000,
    randomCode: () => {
      const c = codeQueue.shift();
      if (c === undefined) throw new Error('test: code queue exhausted');
      return c;
    },
    randomToken: () => {
      if (tokenQueue) {
        const t = tokenQueue.shift();
        if (t === undefined) throw new Error('test: token queue exhausted');
        return t;
      }
      tokenCounter += 1;
      return `tok-${tokenCounter}`;
    },
    maxAttempts: opts.maxAttempts,
  });
}

describe('createSession', () => {
  it('returns a code + host token and stores the session', async () => {
    const store = makeStore({ codes: ['ABC123'] });
    const { code, hostToken } = await store.createSession();
    expect(code).toBe('ABC123');
    expect(hostToken).toBe('tok-1');
    const s = await store.getSession('ABC123');
    expect(s).toBeDefined();
    expect(s!.hostToken).toBe('tok-1');
    expect(s!.joinerToken).toBeUndefined();
    expect(s!.hostIce).toEqual([]);
    expect(s!.joinerIce).toEqual([]);
    expect(s!.createdAt).toBe(1000);
  });

  it('retries on collision and uses the next code', async () => {
    const store = makeStore({ codes: ['DUPDUP', 'DUPDUP', 'FRESHX'] });
    await store.createSession();
    const { code } = await store.createSession();
    expect(code).toBe('FRESHX');
  });

  it('throws SessionCollisionError after maxAttempts', async () => {
    const store = makeStore({
      codes: ['DUP000', 'DUP000', 'DUP000', 'DUP000'],
      maxAttempts: 3,
    });
    await store.createSession();
    await expect(store.createSession()).rejects.toBeInstanceOf(
      SessionCollisionError,
    );
  });
});

describe('joinSession', () => {
  it('rejects with NotFoundError for an unknown code', async () => {
    const store = makeStore({ codes: [] });
    await expect(store.joinSession('NOPE99')).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });

  it('attaches a joinerToken on first join', async () => {
    const store = makeStore({ codes: ['ABC123'] });
    await store.createSession();
    const { joinerToken } = await store.joinSession('ABC123');
    expect(joinerToken).toBe('tok-2');
    expect((await store.getSession('ABC123'))!.joinerToken).toBe('tok-2');
  });

  it('rejects with AlreadyJoinedError on second join', async () => {
    const store = makeStore({ codes: ['ABC123'] });
    await store.createSession();
    await store.joinSession('ABC123');
    await expect(store.joinSession('ABC123')).rejects.toBeInstanceOf(
      SessionAlreadyJoinedError,
    );
  });
});

describe('setSdp / appendIce / drainIce', () => {
  it('writes and reads the host SDP slot', async () => {
    const store = makeStore({ codes: ['ABC123'] });
    await store.createSession();
    expect(await store.setSdp('ABC123', 'host', 'sdp-data')).toBe(true);
    expect((await store.getSession('ABC123'))!.hostSdp).toBe('sdp-data');
  });

  it('returns false from setSdp when the code is unknown', async () => {
    const store = makeStore({ codes: [] });
    expect(await store.setSdp('NOPE99', 'host', 'x')).toBe(false);
  });

  it('appends and drains ICE atomically', async () => {
    const store = makeStore({ codes: ['ABC123'] });
    await store.createSession();
    expect(await store.appendIce('ABC123', 'joiner', '{"a":1}')).toBe('ok');
    expect(await store.appendIce('ABC123', 'joiner', '{"a":2}')).toBe('ok');
    const drained = await store.drainIce('ABC123', 'joiner');
    expect(drained).toEqual({ found: true, candidates: [{ a: 1 }, { a: 2 }] });
    const drainedAgain = await store.drainIce('ABC123', 'joiner');
    expect(drainedAgain).toEqual({ found: true, candidates: [] });
  });

  it('reports queue_full at the configured cap', async () => {
    const store = makeStore({ codes: ['ABC123'] });
    await store.createSession();
    for (let i = 0; i < MAX_ICE_QUEUE; i++) {
      await store.appendIce('ABC123', 'host', `${i}`);
    }
    expect(await store.appendIce('ABC123', 'host', 'overflow')).toBe(
      'queue_full',
    );
  });
});

describe('deleteSession + prune', () => {
  it('removes a session and returns true; false if already gone', async () => {
    const store = makeStore({ codes: ['ABC123'] });
    await store.createSession();
    expect(await store.deleteSession('ABC123')).toBe(true);
    expect(await store.getSession('ABC123')).toBeUndefined();
    expect(await store.deleteSession('ABC123')).toBe(false);
  });

  it('prunes only sessions older than the cutoff', async () => {
    const oldClock = makeStore({ codes: ['OLDONE'], now: 100 });
    await oldClock.createSession();
    expect(await oldClock.prune(50)).toBe(0);
    expect(await oldClock.prune(200)).toBe(1);
    expect(await oldClock.getSession('OLDONE')).toBeUndefined();
  });
});
