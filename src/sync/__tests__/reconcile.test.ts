// Table-driven tests for the pure reconciliation kernel.
// Covers every branch from `reconcile.ts`: null handling, schema-version
// guard, updatedAt comparison, deviceId tie-break, and full equality.

import { describe, expect, it } from "vitest";

import type { Persisted } from "../../persistence/storage";
import { reconcile } from "../reconcile";

type Payload = { name: string };

function env(
  data: Payload,
  updatedAt: number,
  deviceId: string,
  v: number = 1,
): Persisted<Payload> {
  return { v, data, updatedAt, deviceId };
}

describe("reconcile", () => {
  it("returns tie + null when both sides are null", () => {
    const result = reconcile<Payload>(null, null);
    expect(result).toEqual({ winner: "tie", merged: null });
  });

  it("picks remote when local is null", () => {
    const remote = env({ name: "r" }, 10, "B");
    const result = reconcile(null, remote);
    expect(result.winner).toBe("remote");
    expect(result.merged).toBe(remote);
  });

  it("picks local when remote is null", () => {
    const local = env({ name: "l" }, 10, "A");
    const result = reconcile(local, null);
    expect(result.winner).toBe("local");
    expect(result.merged).toBe(local);
  });

  it("picks local when local.updatedAt is newer", () => {
    const local = env({ name: "l" }, 20, "A");
    const remote = env({ name: "r" }, 10, "B");
    const result = reconcile(local, remote);
    expect(result.winner).toBe("local");
    expect(result.merged).toBe(local);
  });

  it("picks remote when remote.updatedAt is newer", () => {
    const local = env({ name: "l" }, 10, "A");
    const remote = env({ name: "r" }, 20, "B");
    const result = reconcile(local, remote);
    expect(result.winner).toBe("remote");
    expect(result.merged).toBe(remote);
  });

  it("breaks updatedAt ties by lexicographically smaller deviceId (local wins)", () => {
    const local = env({ name: "l" }, 10, "A");
    const remote = env({ name: "r" }, 10, "B");
    const result = reconcile(local, remote);
    expect(result.winner).toBe("local");
    expect(result.merged).toBe(local);
  });

  it("breaks updatedAt ties by lexicographically smaller deviceId (remote wins)", () => {
    const local = env({ name: "l" }, 10, "Z");
    const remote = env({ name: "r" }, 10, "A");
    const result = reconcile(local, remote);
    expect(result.winner).toBe("remote");
    expect(result.merged).toBe(remote);
  });

  it("returns tie when updatedAt, deviceId, and v all match", () => {
    const local = env({ name: "l" }, 10, "A");
    const remote = env({ name: "r" }, 10, "A");
    const result = reconcile(local, remote);
    expect(result.winner).toBe("tie");
    expect(result.merged).toBe(local);
  });

  it("higher schema version (local) wins even if remote.updatedAt is newer", () => {
    const local = env({ name: "l" }, 5, "A", 2);
    const remote = env({ name: "r" }, 100, "B", 1);
    const result = reconcile(local, remote);
    expect(result.winner).toBe("local");
    expect(result.merged).toBe(local);
  });

  it("higher schema version (remote) wins even if local.updatedAt is newer", () => {
    const local = env({ name: "l" }, 100, "A", 1);
    const remote = env({ name: "r" }, 5, "B", 2);
    const result = reconcile(local, remote);
    expect(result.winner).toBe("remote");
    expect(result.merged).toBe(remote);
  });

  it("does not mutate either input envelope", () => {
    const local = env({ name: "l" }, 10, "A");
    const remote = env({ name: "r" }, 20, "B");
    const localSnapshot = JSON.stringify(local);
    const remoteSnapshot = JSON.stringify(remote);
    reconcile(local, remote);
    expect(JSON.stringify(local)).toBe(localSnapshot);
    expect(JSON.stringify(remote)).toBe(remoteSnapshot);
  });
});
