// ============================================================
// src/net/protocol.ts
//
// PURPOSE
//   Pure wire-format module for the v1 online-multiplayer
//   protocol (ARCHITECTURE §6.3 + IMPLEMENTATION_PLAN Step 11).
//
//   This file is intentionally framework-agnostic:
//     - no React, no Zustand, no DOM, no fetch, no WebRTC
//     - safe to import from a future React-Native build verbatim
//
//   What it owns:
//     1. The discriminated-union `NetMessage` covering every v1
//        verb that flows over the DataChannel.
//     2. A `nextSeq` helper for monotonically increasing per-game
//        sequence numbers (state passed in, returned out — pure).
//     3. `encode` / `decode` JSON wrappers that throw
//        `NetProtocolError` on malformed input. Validation lives
//        here because the wire is a boundary (copilot rule:
//        "validate inputs at boundaries").
// ============================================================

import type {
  Profile,
  TurnAction,
  Position,
  GameOptions,
  Difficulty,
} from '../domain/types';

const DIFFICULTIES: readonly Difficulty[] = ['beginner', 'normal', 'advanced'];

// ── Versioning ────────────────────────────────────────────────

/**
 * Current wire-protocol version. Bump only when a breaking change
 * is made to any message shape. Receivers reject any message whose
 * `v` does not match.
 */
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

// ── Shared envelope ───────────────────────────────────────────

/**
 * Fields every message carries, regardless of `type`.
 *   v        — protocol version, always `PROTOCOL_VERSION`
 *   gameId   — opaque session id, the same on both peers
 *   senderId — stable peer id (the sender's `deviceId`)
 *   seq      — monotonically increasing per (gameId, senderId)
 *   t        — sender wall-clock at send time, ms since epoch
 *              (informational; clocks are not assumed in sync)
 */
export interface NetEnvelope {
  v: ProtocolVersion;
  gameId: string;
  senderId: string;
  seq: number;
  t: number;
}

// ── Reasons for BYE ───────────────────────────────────────────

/**
 * Why a peer is closing the connection. Receivers MAY surface
 * this to the user (`'protocol'` is a bug, `'forfeit'` ends the
 * game, etc.).
 *
 * Single source of truth: the runtime tuple `BYE_REASONS` is the
 * canonical list, and `ByeReason` is derived from it via
 * `(typeof BYE_REASONS)[number]`. Adding a reason in one place
 * automatically updates the other — no risk of drift.
 */
const BYE_REASONS = ['normal', 'forfeit', 'timeout', 'protocol'] as const;
export type ByeReason = (typeof BYE_REASONS)[number];

// ── Discriminated union ───────────────────────────────────────

/**
 * Every message that may travel over the DataChannel in v1.
 * Add new verbs here AND update `decode` + the test table.
 */
export type NetMessage =
  | (NetEnvelope & { type: 'HELLO'; profile: Profile })
  | (NetEnvelope & {
      type: 'START';
      options: GameOptions;
      profiles: [Profile, Profile];
      hostPlayerIndex: 0 | 1;
      /**
       * Optional shared seed so any future RNG (e.g. randomised
       * wall layouts) produces identical results on both peers.
       * In v1 the only consumer is `gameStore.startGame`, which
       * uses it to make `gameId` deterministic across both sides.
       */
      seed?: string;
    })
  | (NetEnvelope & {
      type: 'ACTION';
      action: TurnAction;
      turnNumber: number;
    })
  | (NetEnvelope & { type: 'PING' })
  | (NetEnvelope & { type: 'PONG'; replyTo: number })
  | (NetEnvelope & { type: 'BYE'; reason: ByeReason })
  | (NetEnvelope & { type: 'RESYNC_REQ'; fromSeq: number })
  | (NetEnvelope & {
      type: 'RESYNC_RES';
      fromSeq: number;
      actions: TurnAction[];
    })
  // Draw negotiation. Not part of the action log because the rules
  // engine doesn't model "draw offered" as a turn — it lives on
  // `GameState.drawOfferFrom`. We mirror that field across peers
  // via these two verbs.
  //   DRAW_OFFER    — sender wants a draw. Receiver shows Accept/Decline.
  //   DRAW_RESPONSE — receiver's answer. `accepted: true` ends the
  //                   game as a draw on both sides; `false` just
  //                   clears the offer.
  | (NetEnvelope & { type: 'DRAW_OFFER'; offererId: string })
  | (NetEnvelope & { type: 'DRAW_RESPONSE'; accepted: boolean });

export type NetMessageType = NetMessage['type'];

// ── Sequence numbers ──────────────────────────────────────────

/**
 * Per-(gameId, senderId) sequence-number cursor. Held by the
 * caller so this module stays stateless.
 */
export interface SeqState {
  /** Last seq successfully emitted; -1 means "none yet". */
  lastSeq: number;
}

export const initialSeqState = (): SeqState => ({ lastSeq: -1 });

/**
 * Pure: returns the next `seq` plus the new cursor. Caller stores
 * `state` and uses `seq` when building an outgoing envelope.
 *
 *   const { state: s2, seq } = nextSeq(s1);
 */
export function nextSeq(state: SeqState): { state: SeqState; seq: number } {
  const seq = state.lastSeq + 1;
  return { state: { lastSeq: seq }, seq };
}

// ── Errors ────────────────────────────────────────────────────

/**
 * Thrown by `decode` when input is not a well-formed `NetMessage`.
 * Callers should treat this as a protocol violation per
 * ARCHITECTURE §6.4 (disconnect with `BYE { reason: 'protocol' }`).
 */
export class NetProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetProtocolError';
  }
}

// ── Encode ────────────────────────────────────────────────────

/**
 * JSON-encodes a message. Trivial wrapper; exists so all wire I/O
 * goes through one spot we can later swap for a binary format.
 */
export function encode(msg: NetMessage): string {
  return JSON.stringify(msg);
}

// ── Decode + validation ───────────────────────────────────────

/**
 * Parses and validates a raw wire string into a `NetMessage`.
 * Throws `NetProtocolError` on any deviation from the schema.
 *
 * Validation is deliberately strict but shallow: we check the
 * envelope, the discriminator, and the per-type required fields'
 * shapes. We do NOT re-validate gameplay (e.g. that a `Position`
 * is on the board) — that is the rules engine's job downstream.
 */
export function decode(raw: string): NetMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new NetProtocolError(
      `invalid JSON: ${(err as Error).message}`,
    );
  }
  if (!isObject(parsed)) {
    throw new NetProtocolError('message must be an object');
  }
  validateEnvelope(parsed);
  const type = (parsed as { type: unknown }).type;
  if (typeof type !== 'string') {
    throw new NetProtocolError('missing or non-string `type`');
  }
  // Each branch validates the per-type fields; once those checks
  // pass we trust the shape and cast via `unknown` (TS's strict
  // overlap rule needs the explicit two-step cast).
  const ok = (m: Record<string, unknown>): NetMessage => m as unknown as NetMessage;
  switch (type) {
    case 'HELLO':
      validateProfile((parsed as { profile: unknown }).profile);
      return ok(parsed);
    case 'START':
      validateStart(parsed);
      return ok(parsed);
    case 'ACTION':
      validateTurnAction((parsed as { action: unknown }).action);
      requireNumber(parsed, 'turnNumber');
      return ok(parsed);
    case 'PING':
      return ok(parsed);
    case 'PONG':
      requireNumber(parsed, 'replyTo');
      return ok(parsed);
    case 'BYE': {
      const reason = (parsed as { reason: unknown }).reason;
      if (typeof reason !== 'string' || !BYE_REASONS.includes(reason as ByeReason)) {
        throw new NetProtocolError(`BYE.reason invalid: ${String(reason)}`);
      }
      return ok(parsed);
    }
    case 'RESYNC_REQ':
      requireNumber(parsed, 'fromSeq');
      return ok(parsed);
    case 'RESYNC_RES': {
      requireNumber(parsed, 'fromSeq');
      const actions = (parsed as { actions: unknown }).actions;
      if (!Array.isArray(actions)) {
        throw new NetProtocolError('RESYNC_RES.actions must be an array');
      }
      actions.forEach(validateTurnAction);
      return ok(parsed);
    }
    case 'DRAW_OFFER':
      requireString(parsed, 'offererId');
      return ok(parsed);
    case 'DRAW_RESPONSE': {
      const accepted = (parsed as { accepted: unknown }).accepted;
      if (typeof accepted !== 'boolean') {
        throw new NetProtocolError('DRAW_RESPONSE.accepted must be boolean');
      }
      return ok(parsed);
    }
    default:
      throw new NetProtocolError(`unknown message type: ${type}`);
  }
}

// ── Internal validators ───────────────────────────────────────

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function requireNumber(obj: unknown, key: string): void {
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new NetProtocolError(`field \`${key}\` must be a finite number`);
  }
}

function requireString(obj: unknown, key: string): void {
  const v = (obj as Record<string, unknown>)[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new NetProtocolError(`field \`${key}\` must be a non-empty string`);
  }
}

function validateEnvelope(obj: Record<string, unknown>): void {
  if (obj.v !== PROTOCOL_VERSION) {
    throw new NetProtocolError(
      `unsupported protocol version: ${String(obj.v)} (expected ${PROTOCOL_VERSION})`,
    );
  }
  requireString(obj, 'gameId');
  requireString(obj, 'senderId');
  requireNumber(obj, 'seq');
  requireNumber(obj, 't');
  if ((obj.seq as number) < 0 || !Number.isInteger(obj.seq)) {
    throw new NetProtocolError('`seq` must be a non-negative integer');
  }
}

function validateProfile(p: unknown): void {
  if (!isObject(p)) {
    throw new NetProtocolError('HELLO.profile must be an object');
  }
  requireString(p, 'name');
  requireString(p, 'color');
}

function validateGameOptions(o: unknown): void {
  if (!isObject(o)) {
    throw new NetProtocolError('START.options must be an object');
  }
  const diff = (o as { difficulty: unknown }).difficulty;
  if (typeof diff !== 'string' || !DIFFICULTIES.includes(diff as Difficulty)) {
    throw new NetProtocolError(`START.options.difficulty invalid: ${String(diff)}`);
  }
  requireString(o, 'boardSizeId');
  requireNumber(o, 'timerMinutes');
  if (typeof (o as { againstView: unknown }).againstView !== 'boolean') {
    throw new NetProtocolError('START.options.againstView must be boolean');
  }
  if (typeof (o as { walls: unknown }).walls !== 'boolean') {
    throw new NetProtocolError('START.options.walls must be boolean');
  }
}

function validateStart(obj: unknown): void {
  const m = obj as Record<string, unknown>;
  validateGameOptions(m.options);
  const profiles = m.profiles;
  if (!Array.isArray(profiles) || profiles.length !== 2) {
    throw new NetProtocolError('START.profiles must be a tuple of two profiles');
  }
  profiles.forEach(validateProfile);
  const idx = m.hostPlayerIndex;
  if (idx !== 0 && idx !== 1) {
    throw new NetProtocolError('START.hostPlayerIndex must be 0 or 1');
  }
  if (m.seed !== undefined && (typeof m.seed !== 'string' || m.seed.length === 0)) {
    throw new NetProtocolError('START.seed, when present, must be a non-empty string');
  }
}

function validatePosition(p: unknown): void {
  if (!isObject(p)) {
    throw new NetProtocolError('position must be an object');
  }
  const pos = p as Record<string, unknown>;
  if (typeof pos.col !== 'number' || !Number.isInteger(pos.col)) {
    throw new NetProtocolError('position.col must be an integer');
  }
  if (typeof pos.row !== 'number' || !Number.isInteger(pos.row)) {
    throw new NetProtocolError('position.row must be an integer');
  }
}

function validateTurnAction(a: unknown): void {
  if (!isObject(a)) {
    throw new NetProtocolError('action must be an object');
  }
  const act = a as Record<string, unknown> & { type?: unknown };
  requireString(act, 'instanceId');
  switch (act.type) {
    case 'PLACE':
      validatePosition((act as { position: unknown }).position);
      return;
    case 'MOVE':
      validatePosition((act as { from: unknown }).from);
      validatePosition((act as { to: unknown }).to);
      return;
    default:
      throw new NetProtocolError(
        `action.type must be 'PLACE' or 'MOVE', got ${String(act.type)}`,
      );
  }
}

// Re-export domain types referenced in NetMessage so consumers can
// import everything from `src/net/protocol` without crossing layers.
export type { Profile, TurnAction, Position, GameOptions };
