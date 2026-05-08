// ============================================================
// src/net/__tests__/protocol.test.ts
//
// PURPOSE
//   Step 11 unit tests for the wire protocol.
//   Two slices:
//     1. Round-trip encode → decode for every verb (HELLO,
//        ACTION, PING, PONG, BYE, RESYNC_REQ, RESYNC_RES).
//     2. Malformed-input rejection: bad JSON, missing envelope
//        fields, wrong version, unknown verb, bad payload shapes.
//
//   Pure-domain tests — no React, no DOM. Run under `vitest`.
// ============================================================

import { describe, expect, it } from 'vitest';

import {
  PROTOCOL_VERSION,
  NetProtocolError,
  decode,
  encode,
  initialSeqState,
  nextSeq,
  type NetMessage,
} from '../protocol';

// ── Fixtures ──────────────────────────────────────────────────

const baseEnvelope = {
  v: PROTOCOL_VERSION,
  gameId: 'g1',
  senderId: 'peer-A',
  seq: 0,
  t: 1_700_000_000_000,
};

const samples: Record<string, NetMessage> = {
  HELLO: {
    ...baseEnvelope,
    type: 'HELLO',
    profile: { name: 'Ada', color: '#3366ff' },
  },
  ACTION_PLACE: {
    ...baseEnvelope,
    seq: 1,
    type: 'ACTION',
    turnNumber: 3,
    action: { type: 'PLACE', instanceId: 'fi_1', position: { col: 2, row: 4 } },
  },
  ACTION_MOVE: {
    ...baseEnvelope,
    seq: 2,
    type: 'ACTION',
    turnNumber: 4,
    action: {
      type: 'MOVE',
      instanceId: 'fi_2',
      from: { col: 0, row: 0 },
      to: { col: 1, row: 0 },
    },
  },
  PING: { ...baseEnvelope, seq: 3, type: 'PING' },
  PONG: { ...baseEnvelope, seq: 4, type: 'PONG', replyTo: 3 },
  BYE: { ...baseEnvelope, seq: 5, type: 'BYE', reason: 'forfeit' },
  RESYNC_REQ: { ...baseEnvelope, seq: 6, type: 'RESYNC_REQ', fromSeq: 2 },
  RESYNC_RES: {
    ...baseEnvelope,
    seq: 7,
    type: 'RESYNC_RES',
    fromSeq: 2,
    actions: [
      { type: 'PLACE', instanceId: 'fi_1', position: { col: 2, row: 4 } },
      {
        type: 'MOVE',
        instanceId: 'fi_2',
        from: { col: 0, row: 0 },
        to: { col: 1, row: 0 },
      },
    ],
  },
};

// ── 1. Round-trip ─────────────────────────────────────────────

describe('protocol: encode/decode round-trip', () => {
  for (const [name, msg] of Object.entries(samples)) {
    it(`round-trips ${name}`, () => {
      expect(decode(encode(msg))).toEqual(msg);
    });
  }
});

// ── 2. Malformed input ────────────────────────────────────────

describe('protocol: malformed input rejection', () => {
  const cases: Array<{ name: string; raw: string }> = [
    { name: 'invalid JSON', raw: '{not json' },
    { name: 'non-object root', raw: '"hello"' },
    { name: 'wrong version', raw: JSON.stringify({ ...samples.HELLO, v: 999 }) },
    {
      name: 'missing gameId',
      raw: JSON.stringify({ ...samples.HELLO, gameId: '' }),
    },
    {
      name: 'negative seq',
      raw: JSON.stringify({ ...samples.HELLO, seq: -1 }),
    },
    {
      name: 'non-integer seq',
      raw: JSON.stringify({ ...samples.HELLO, seq: 1.5 }),
    },
    { name: 'unknown type', raw: JSON.stringify({ ...baseEnvelope, type: 'WAT' }) },
    {
      name: 'HELLO without profile',
      raw: JSON.stringify({ ...baseEnvelope, type: 'HELLO' }),
    },
    {
      name: 'ACTION with bad action.type',
      raw: JSON.stringify({
        ...baseEnvelope,
        type: 'ACTION',
        turnNumber: 1,
        action: { type: 'TELEPORT', instanceId: 'x', position: { col: 0, row: 0 } },
      }),
    },
    {
      name: 'BYE with unknown reason',
      raw: JSON.stringify({ ...baseEnvelope, type: 'BYE', reason: 'bored' }),
    },
    {
      name: 'PONG missing replyTo',
      raw: JSON.stringify({ ...baseEnvelope, type: 'PONG' }),
    },
    {
      name: 'RESYNC_RES with non-array actions',
      raw: JSON.stringify({
        ...baseEnvelope,
        type: 'RESYNC_RES',
        fromSeq: 0,
        actions: 'nope',
      }),
    },
  ];

  for (const c of cases) {
    it(`rejects: ${c.name}`, () => {
      expect(() => decode(c.raw)).toThrow(NetProtocolError);
    });
  }
});

// ── 3. nextSeq ────────────────────────────────────────────────

describe('protocol: nextSeq', () => {
  it('starts at 0 and increments monotonically without mutating input', () => {
    const s0 = initialSeqState();
    const r1 = nextSeq(s0);
    const r2 = nextSeq(r1.state);
    const r3 = nextSeq(r2.state);

    expect(r1.seq).toBe(0);
    expect(r2.seq).toBe(1);
    expect(r3.seq).toBe(2);
    expect(s0.lastSeq).toBe(-1); // input untouched
  });
});
