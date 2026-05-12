// Tests for the wire.ts orchestrator. Uses fake bindings + a fake
// `SyncClient` so we never hit the network or real Zustand stores.
//
// What we verify:
//   - On install, `pull(kind)` is called for every kind.
//   - When the remote envelope is newer, the binding's
//     `applyEnvelope` is invoked with the remote.
//   - Local changes get pushed after the 1 s debounce, not before.
//   - Subsequent writes inside the debounce window collapse into one push.
//   - A 409 push response is reconciled: if remote wins, applyEnvelope
//     runs and no further push is made.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SyncStaleError, type SyncClient } from "../httpClient";
import type { Persisted, SyncKind } from "../types";
import { installSyncListeners, type KindBinding, type SyncBindings } from "../wire";

type Payload = { name: string };

function env(
  data: Payload,
  updatedAt: number,
  deviceId = "dev-A",
  v = 1,
): Persisted<unknown> {
  return { v, data, updatedAt, deviceId } as Persisted<unknown>;
}

/** Build a controllable binding for one kind. */
function makeBinding(initial: Persisted<unknown> | null = null) {
  let current = initial;
  const subs: Array<() => void> = [];
  const applyEnvelope = vi.fn((envIn: Persisted<unknown>) => {
    current = envIn;
  });
  const binding: KindBinding = {
    readEnvelope: () => current,
    applyEnvelope,
    subscribe: (cb) => {
      subs.push(cb);
      return () => {
        const i = subs.indexOf(cb);
        if (i >= 0) subs.splice(i, 1);
      };
    },
  };
  return {
    binding,
    applyEnvelope,
    setLocal(envIn: Persisted<unknown>) {
      current = envIn;
      for (const cb of subs) cb();
    },
    get current() {
      return current;
    },
  };
}

/** Fake client whose pull/push behaviour the test controls. */
function makeClient(): {
  client: SyncClient;
  pull: ReturnType<typeof vi.fn>;
  push: ReturnType<typeof vi.fn>;
} {
  const pull = vi.fn<(kind: SyncKind) => Promise<Persisted<unknown> | null>>();
  const push = vi.fn<(kind: SyncKind, e: Persisted<unknown>) => Promise<void>>();
  return { client: { pull, push }, pull, push };
}

function bindings(
  profile: KindBinding,
  settings: KindBinding,
): SyncBindings {
  return { profile, settings };
}

// Stub window listeners so wire.ts can register them in Node.
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis as typeof globalThis;
  (globalThis as { addEventListener?: unknown }).addEventListener = vi.fn();
  (globalThis as { removeEventListener?: unknown }).removeEventListener = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
});

describe("installSyncListeners", () => {
  it("pulls every kind on install", async () => {
    const p = makeBinding();
    const s = makeBinding();
    const { client, pull } = makeClient();
    pull.mockResolvedValue(null);

    const dispose = installSyncListeners(client, bindings(p.binding, s.binding));
    await vi.runAllTimersAsync();

    expect(pull).toHaveBeenCalledTimes(2);
    expect(pull.mock.calls.map((c) => c[0]).sort()).toEqual(["profile", "settings"]);
    dispose();
  });

  it("applies remote when remote is newer (and does not echo a push)", async () => {
    const local = env({ name: "L" }, 100);
    const remote = env({ name: "R" }, 200);
    const p = makeBinding(local);
    const s = makeBinding();
    const { client, pull, push } = makeClient();
    pull.mockImplementation(async (k) => (k === "profile" ? remote : null));
    push.mockResolvedValue(undefined);

    const dispose = installSyncListeners(client, bindings(p.binding, s.binding));
    await vi.runAllTimersAsync();

    expect(p.applyEnvelope).toHaveBeenCalledWith(remote);
    // No push for profile — server is already authoritative.
    const profilePushes = push.mock.calls.filter((c) => c[0] === "profile");
    expect(profilePushes.length).toBe(0);
    dispose();
  });

  it("pushes local when local is newer than server (null)", async () => {
    const local = env({ name: "L" }, 100);
    const p = makeBinding(local);
    const s = makeBinding();
    const { client, pull, push } = makeClient();
    pull.mockResolvedValue(null);
    push.mockResolvedValue(undefined);

    const dispose = installSyncListeners(client, bindings(p.binding, s.binding));
    await vi.runAllTimersAsync();

    expect(push).toHaveBeenCalledWith("profile", local);
    dispose();
  });

  it("debounces store changes: one push after 1s, not before", async () => {
    const p = makeBinding(env({ name: "L0" }, 1));
    const s = makeBinding();
    const { client, pull, push } = makeClient();
    pull.mockResolvedValue(null);
    push.mockResolvedValue(undefined);

    const dispose = installSyncListeners(client, bindings(p.binding, s.binding));
    await vi.runAllTimersAsync();
    push.mockClear();

    // Three quick local edits — should collapse into one push.
    p.setLocal(env({ name: "L1" }, 10));
    await vi.advanceTimersByTimeAsync(400);
    p.setLocal(env({ name: "L2" }, 20));
    await vi.advanceTimersByTimeAsync(400);
    p.setLocal(env({ name: "L3" }, 30));
    expect(push).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][1]).toEqual(env({ name: "L3" }, 30));
    dispose();
  });

  it("on 409 with newer server.current, applies remote and stops", async () => {
    const local = env({ name: "L" }, 50);
    const newer = env({ name: "R" }, 999);
    const p = makeBinding(local);
    const s = makeBinding();
    const { client, pull, push } = makeClient();
    pull.mockResolvedValue(null);
    // First push fails with 409; should NOT be retried because remote wins.
    push.mockRejectedValueOnce(new SyncStaleError(newer));

    const dispose = installSyncListeners(client, bindings(p.binding, s.binding));
    await vi.runAllTimersAsync();

    expect(push).toHaveBeenCalledTimes(1);
    expect(p.applyEnvelope).toHaveBeenCalledWith(newer);
    dispose();
  });

  it("on 409 with older server.current, retries push of local", async () => {
    const local = env({ name: "L" }, 999);
    const older = env({ name: "R" }, 50);
    const p = makeBinding(local);
    const s = makeBinding();
    const { client, pull, push } = makeClient();
    pull.mockResolvedValue(null);
    // First push 409 with older current; second push accepted.
    push
      .mockRejectedValueOnce(new SyncStaleError(older))
      .mockResolvedValueOnce(undefined);

    const dispose = installSyncListeners(client, bindings(p.binding, s.binding));
    await vi.runAllTimersAsync();

    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1][1]).toEqual(local);
    expect(p.applyEnvelope).not.toHaveBeenCalled();
    dispose();
  });
});
