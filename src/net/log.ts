// ============================================================
// src/net/log.ts
//
// PURPOSE
//   Tiny in-memory ring-buffer logger for the net layer
//   (IMPLEMENTATION_PLAN Step 11).
//
//   Why not `console`?
//     - we want a bounded buffer the dev overlay can render
//     - we don't want net diagnostics to spam the user's console
//     - we want to capture & ship logs to a future debug panel
//       without coupling to the DOM today
//
//   This module is framework-agnostic: no React, no globals, no
//   side effects on import. Each call to `createNetLogger()`
//   returns an isolated logger instance the caller owns.
// ============================================================

/** Severity tag attached to every entry. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * One captured log line.
 *   ts    — wall-clock at log time (ms since epoch); set via the
 *           injected clock so tests can be deterministic.
 *   level — see `LogLevel`.
 *   tag   — short namespace, e.g. 'peer', 'signaling', 'protocol'.
 *   data  — optional structured payload; kept as `unknown` so the
 *           logger doesn't accidentally serialize secrets.
 */
export interface LogEntry {
  ts: number;
  level: LogLevel;
  tag: string;
  data?: unknown;
}

export interface NetLoggerOptions {
  /** Max entries kept; oldest are dropped when full. Default 200. */
  capacity?: number;
  /** Injectable clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface NetLogger {
  /** Append a log line. Never throws; never blocks on I/O. */
  log(level: LogLevel, tag: string, data?: unknown): void;
  /**
   * Returns a snapshot copy in chronological order (oldest first).
   * Mutating the returned array does not affect the logger.
   */
  snapshot(): LogEntry[];
  /** Drop all entries. */
  clear(): void;
  /** Current entry count, mainly for tests/diagnostics. */
  size(): number;
}

/**
 * Create an isolated ring-buffer logger.
 *
 * Implementation notes (kept simple on purpose):
 *   - Single backing array; we overwrite the oldest slot when
 *     `capacity` is reached. This is O(1) per write and avoids
 *     `Array.shift` (which is O(n)).
 *   - `snapshot` walks the buffer in insertion order and returns
 *     a fresh array, so callers can freely mutate / serialize it.
 */
export function createNetLogger(options: NetLoggerOptions = {}): NetLogger {
  const capacity = Math.max(1, Math.floor(options.capacity ?? 200));
  const now = options.now ?? Date.now;

  const buf: (LogEntry | undefined)[] = new Array(capacity);
  let writeIdx = 0; // next slot to write
  let count = 0; // number of valid entries (≤ capacity)

  return {
    log(level, tag, data) {
      buf[writeIdx] = { ts: now(), level, tag, ...(data !== undefined ? { data } : {}) };
      writeIdx = (writeIdx + 1) % capacity;
      if (count < capacity) count += 1;
    },
    snapshot() {
      const out: LogEntry[] = [];
      // Oldest entry is at writeIdx when full, else at index 0.
      const start = count < capacity ? 0 : writeIdx;
      for (let i = 0; i < count; i += 1) {
        const entry = buf[(start + i) % capacity];
        if (entry) out.push({ ...entry });
      }
      return out;
    },
    clear() {
      buf.fill(undefined);
      writeIdx = 0;
      count = 0;
    },
    size() {
      return count;
    },
  };
}
