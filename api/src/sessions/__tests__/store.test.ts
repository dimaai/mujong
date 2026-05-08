// ============================================================
// api/src/sessions/__tests__/store.test.ts
//
// Unit tests for the pure session store. Both deps are stubbed:
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
  it('returns a code + host token and stores the session', () => {
    const store = makeStore({ codes: ['ABC123'] });
    const { code, hostToken } = store.createSession();
    expect(code).toBe('ABC123');
    expect(hostToken).toBe('tok-1');
    const s = store.getSession('ABC123');
    expect(s).toBeDefined();
    expect(s!.hostToken).toBe('tok-1');
    expect(s!.joinerToken).toBeUndefined();
    expect(s!.hostIce).toEqual([]);
    expect(s!.joinerIce).toEqual([]);
    expect(s!.createdAt).toBe(1000);
    expect(store.size()).toBe(1);
  });

  it('retries on collision and uses the next code', () => {
    const store = makeStore({ codes: ['DUPDUP', 'DUPDUP', 'FRESHX'] });
    // Pre-seed by creating a session for DUPDUP first
    store.createSession(); // claims DUPDUP, consumes 1 code
    // Next createSession sees DUPDUP again (collision), then FRESHX (free)
    const { code } = store.createSession();
    expect(code).toBe('FRESHX');
    expect(store.size()).toBe(2);
  });

  it('throws SessionCollisionError after maxAttempts', () => {
    const store = makeStore({
      codes: ['DUP000', 'DUP000', 'DUP000', 'DUP000'],
      maxAttempts: 3,
    });
    store.createSession(); // takes DUP000
    expect(() => store.createSession()).toThrow(SessionCollisionError);
  });
});

describe('joinSession', () => {
  it('returns 404 (NotFoundError) for an unknown code', () => {
    const store = makeStore({ codes: [] });
    expect(() => store.joinSession('NOPE99')).toThrow(SessionNotFoundError);
  });

  it('attaches a joinerToken on first join', () => {
    const store = makeStore({ codes: ['ABC123'] });
    store.createSession();
    const { joinerToken } = store.joinSession('ABC123');
    expect(joinerToken).toBe('tok-2');
    expect(store.getSession('ABC123')!.joinerToken).toBe('tok-2');
  });

  it('returns 409 (AlreadyJoinedError) on second join', () => {
    const store = makeStore({ codes: ['ABC123'] });
    store.createSession();
    store.joinSession('ABC123');
    expect(() => store.joinSession('ABC123')).toThrow(SessionAlreadyJoinedError);
  });
});

describe('deleteSession', () => {
  it('removes a session and returns true; false if already gone', () => {
    const store = makeStore({ codes: ['ABC123'] });
    store.createSession();
    expect(store.deleteSession('ABC123')).toBe(true);
    expect(store.getSession('ABC123')).toBeUndefined();
    expect(store.deleteSession('ABC123')).toBe(false);
    expect(store.size()).toBe(0);
  });
});
