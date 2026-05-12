// Tests for the HTTP transport. We mock `fetch` and `navigator.onLine`
// via the options object so the suite can run in plain Node.

import { describe, expect, it, vi } from "vitest";

import {
  createSyncClient,
  SyncOfflineError,
  SyncStaleError,
} from "../httpClient";
import type { Persisted } from "../types";

type Payload = { name: string };

function envelope(updatedAt: number): Persisted<Payload> {
  return { v: 1, data: { name: "x" }, updatedAt, deviceId: "dev-A" };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createSyncClient", () => {
  it("pull GETs the correct URL and parses the envelope", async () => {
    const env = envelope(100);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(env));
    const client = createSyncClient({
      baseUrl: "https://api.example.com/sync",
      userId: "user/1",
      fetch: fetchMock,
      isOnline: () => true,
    });

    const result = await client.pull("profile");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // userId must be percent-encoded.
    expect(url).toBe("https://api.example.com/sync/user%2F1/profile");
    expect(init.method).toBe("GET");
    expect(result).toEqual(env);
  });

  it("pull returns null on 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 404 }));
    const client = createSyncClient({
      baseUrl: "https://api.example.com",
      userId: "u",
      fetch: fetchMock,
      isOnline: () => true,
    });
    expect(await client.pull("settings")).toBeNull();
  });

  it("pull returns null when body is empty or 'null'", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 200 }))
      .mockResolvedValueOnce(new Response("null", { status: 200 }));
    const client = createSyncClient({
      baseUrl: "https://api.example.com",
      userId: "u",
      fetch: fetchMock,
      isOnline: () => true,
    });
    expect(await client.pull("profile")).toBeNull();
    expect(await client.pull("profile")).toBeNull();
  });

  it("pull throws SyncOfflineError when navigator is offline", async () => {
    const fetchMock = vi.fn();
    const client = createSyncClient({
      baseUrl: "https://api.example.com",
      userId: "u",
      fetch: fetchMock,
      isOnline: () => false,
    });
    await expect(client.pull("profile")).rejects.toBeInstanceOf(SyncOfflineError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pull throws SyncOfflineError on network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network"));
    const client = createSyncClient({
      baseUrl: "https://api.example.com",
      userId: "u",
      fetch: fetchMock,
      isOnline: () => true,
    });
    await expect(client.pull("profile")).rejects.toBeInstanceOf(SyncOfflineError);
  });

  it("push PUTs the envelope and resolves on 200", async () => {
    const env = envelope(200);
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    const client = createSyncClient({
      baseUrl: "https://api.example.com/",
      userId: "u",
      fetch: fetchMock,
      isOnline: () => true,
    });

    await client.push("settings", env);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/u/settings");
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(env);
  });

  it("push throws SyncStaleError carrying server.current on 409", async () => {
    const current = envelope(500);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ current }, 409));
    const client = createSyncClient({
      baseUrl: "https://api.example.com",
      userId: "u",
      fetch: fetchMock,
      isOnline: () => true,
    });

    const err = await client.push("profile", envelope(100)).catch((e) => e);
    expect(err).toBeInstanceOf(SyncStaleError);
    expect((err as SyncStaleError).current).toEqual(current);
  });

  it("push throws SyncOfflineError on network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("disconnected"));
    const client = createSyncClient({
      baseUrl: "https://api.example.com",
      userId: "u",
      fetch: fetchMock,
      isOnline: () => true,
    });
    await expect(client.push("profile", envelope(1))).rejects.toBeInstanceOf(
      SyncOfflineError,
    );
  });
});
