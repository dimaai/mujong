// ============================================================
// src/store/__tests__/netStore.heartbeat.test.ts
//
// PURPOSE
//   Step 18 unit test for the pure `computeQuality` helper that
//   drives the connection-quality pill. The full heartbeat loop
//   lives inside the store and pokes the network at run-time, so
//   we test it indirectly via the same threshold function the
//   loop calls.
//
//   Thresholds under test (from IMPLEMENTATION_PLAN Step 18):
//     - mean RTT  < 150 ms  → 'good'
//     - mean RTT  < 400 ms  → 'slow'
//     - mean RTT >= 400 ms  → 'unstable'
//     - 15 s without inbound traffic → forced 'unstable'
//     - no samples + lastSeenAt === null → null (nothing to show)
// ============================================================

import { describe, expect, it } from 'vitest';

import { computeQuality } from '../netStore';

describe('computeQuality (Step 18)', () => {
  // Fixed "now" so the staleness check is deterministic.
  const NOW = 1_700_000_000_000;

  it('returns null when there is no traffic yet at all', () => {
    expect(computeQuality([], NOW, null)).toBeNull();
  });

  it('returns "good" when we have observed traffic but no RTTs yet', () => {
    // The very first PONG hasn't landed but messages are flowing
    // (e.g. fresh HELLO). Treat that as healthy.
    expect(computeQuality([], NOW, NOW - 1_000)).toBe('good');
  });

  it('returns "good" when mean RTT < 150 ms', () => {
    expect(computeQuality([10, 20, 30], NOW, NOW)).toBe('good');
    expect(computeQuality([149], NOW, NOW)).toBe('good');
  });

  it('returns "slow" when mean RTT is between 150 ms and 400 ms', () => {
    expect(computeQuality([200], NOW, NOW)).toBe('slow');
    expect(computeQuality([300, 350, 250], NOW, NOW)).toBe('slow');
    expect(computeQuality([399], NOW, NOW)).toBe('slow');
  });

  it('returns "unstable" when mean RTT is 400 ms or higher', () => {
    expect(computeQuality([400], NOW, NOW)).toBe('unstable');
    expect(computeQuality([800, 1200], NOW, NOW)).toBe('unstable');
  });

  it('forces "unstable" after 15 s with no inbound traffic, regardless of RTT history', () => {
    // Even with a perfect mean, staleness wins.
    const stale = NOW - 16_000;
    expect(computeQuality([10, 12, 14], NOW, stale)).toBe('unstable');
  });

  it('still reports "good" while the staleness window is open', () => {
    const recent = NOW - 14_000;
    expect(computeQuality([10, 12, 14], NOW, recent)).toBe('good');
  });
});
