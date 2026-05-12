// ============================================================
// src/components/Settings/SyncIndicator.tsx
//
// PURPOSE
//   Renders a small status line that reads `useSyncStore` and
//   tells the user whether cloud sync is healthy.
//
//   - 'idle' + no lastSyncedAt → nothing (sync disabled or
//                                 hasn't run yet — no need to
//                                 clutter the UI).
//   - 'idle' + lastSyncedAt   → "Synced · <relative time>".
//   - 'syncing'               → "Syncing…".
//   - 'offline'               → "Offline — changes will sync later".
//   - 'error'                 → "Sync error".
//
//   Pure read-only component; no actions. Re-renders once a
//   minute via setInterval so the relative time stays fresh.
// ============================================================

'use client';

import { useEffect, useState } from 'react';

import { useSyncStore } from '../../sync/syncStore';

import styles from './Settings.module.css';

/** Human-friendly "5s ago" / "3m ago" / "just now". */
function formatRelative(ms: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function SyncIndicator() {
  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);

  // Force a re-render every 30s so the relative time advances even
  // when nothing else changes. Tiny perf cost; only one consumer.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  let text = '';
  let tone: 'ok' | 'warn' | 'err' = 'ok';
  if (status === 'syncing') {
    text = 'Syncing…';
  } else if (status === 'offline') {
    text = 'Offline — changes will sync later';
    tone = 'warn';
  } else if (status === 'error') {
    text = 'Sync error';
    tone = 'err';
  } else if (lastSyncedAt !== null) {
    text = `Synced · ${formatRelative(lastSyncedAt)}`;
  } else {
    // Sync hasn't reported anything yet — render nothing rather
    // than a misleading "Synced" or "Offline" message.
    return null;
  }

  const toneClass =
    tone === 'err'
      ? styles.syncError
      : tone === 'warn'
      ? styles.syncWarn
      : styles.syncOk;

  return (
    <div
      className={`${styles.syncIndicator} ${toneClass}`}
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
}
