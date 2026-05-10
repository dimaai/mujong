// ============================================================
// src/net/signaling.ts
//
// PURPOSE
//   Typed `fetch` client for the v1 signaling backend
//   (IMPLEMENTATION_PLAN Step 14).
//
//   This is the ONLY module under `src/net/` that performs
//   network I/O. Everything else (`protocol.ts`, `peer.ts`,
//   `log.ts`) stays transport-agnostic so the same code runs
//   in a future React Native build with a different signaling
//   transport plugged in.
//
//   What this file owns:
//     1. The `SignalingClient` interface — small set of typed
//        verbs that mirror the four Functions endpoints
//        (`createSession`, `joinSession`, `putSdp`/`pollSdp`,
//        `postIce`/`pollIce`).
//     2. A `createSignalingClient({ baseUrl, fetch })` factory
//        with both deps injectable so unit tests can run under
//        Node without `fetch` and without a server.
//     3. Per-instance state: the chosen `code`, the bearer
//        token granted by the server, and an `AbortController`
//        used by `close()` to cancel any in-flight long-polls.
//
//   What this file does NOT do:
//     - No WebRTC. Receives strings + JSON, hands them to the
//       caller (typically the `Peer` adapter from peer.ts).
//     - No retries beyond what's needed to bridge the long-poll
//       (the server returns 204 on timeout; we just re-issue).
//       Real backoff/retry policy belongs in the orchestrator.
// ============================================================

export type Role = 'host' | 'joiner';

/** Errors `SignalingClient` may throw. */
export class SignalingError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message?: string) {
    super(message ?? `${code} (${status})`);
    this.name = 'SignalingError';
    this.status = status;
    this.code = code;
  }
}

export class SignalingAbortError extends Error {
  constructor() {
    super('signaling client closed');
    this.name = 'SignalingAbortError';
  }
}

/**
 * The transport surface used by `connectViaSignaling`. Each
 * instance is tied to exactly one session: the code is
 * established by `host()` or `join(code)` and reused by every
 * subsequent call.
 */
export interface SignalingClient {
  /** Allocate a new session. Resolves to the 6-char invitation code. */
  host(): Promise<{ code: string }>;
  /** Attach to an existing session. Throws on 404 / 409. */
  join(code: string): Promise<void>;
  /**
   * Hydrate the client from a previously-issued (code, role, token)
   * triple WITHOUT calling the server. Used by `attemptReconnect`
   * after a tab reload or transient drop, where we already hold a
   * valid token from the original `host()`/`join()` call.
   */
  attach(args: { code: string; role: Role; token: string }): void;
  /**
   * Re-authorise this client for a fresh handshake on the same
   * session. Server clears the SDP slots and ICE queues so the
   * subsequent `putSdp`/`pollSdp`/`postIce`/`pollIce` calls start
   * clean. Throws `SignalingError` on bad token / unknown code /
   * exceeded reattach limit.
   */
  reattach(): Promise<{ role: Role; renegotiationCount: number }>;
  /** Write `sdp` into the named role's slot. Token-gated server-side. */
  putSdp(role: Role, sdp: string): Promise<void>;
  /**
   * Long-poll for `role`'s SDP. Re-issues GETs until a 200 is
   * returned (the server replies 204 on its own timeout). Rejects
   * with `SignalingAbortError` if `close()` is called.
   */
  pollSdp(role: Role): Promise<string>;
  /** Append a single ICE candidate (or `null` for end-of-candidates). */
  postIce(role: Role, candidate: RTCIceCandidateInit | null): Promise<void>;
  /**
   * Drain the named role's ICE queue. Returns whatever was
   * collected during one server-side long-poll window — often
   * empty on a 204 timeout. Caller should loop while open.
   */
  pollIce(role: Role): Promise<(RTCIceCandidateInit | null)[]>;
  /** Cancel in-flight long-polls. Subsequent calls reject. */
  close(): void;
  /** Current code, set after `host()` / `join()`. */
  readonly code: string | null;
  /** Caller's own role. Set after `host()` / `join()`. */
  readonly role: Role | null;
  /** Bearer token issued by the server; opaque. */
  readonly token: string | null;
}

/** Options for `createSignalingClient`. Both fields are optional. */
export interface CreateSignalingClientOptions {
  /**
   * Base URL of the API. Defaults to `''` (same-origin), which
   * is what Static Web Apps wants. Tests pass `http://localhost`
   * or a fake.
   */
  baseUrl?: string;
  /** Test seam. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

interface JsonError {
  error?: string;
}

/**
 * Build a fresh signaling client. State lives in the closure;
 * each call yields an independent client (good for tests).
 */
export function createSignalingClient(
  options: CreateSignalingClientOptions = {},
): SignalingClient {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl: typeof fetch =
    options.fetch ?? (globalThis.fetch?.bind(globalThis) as typeof fetch);
  if (!fetchImpl) {
    throw new Error('signaling: no fetch available; pass options.fetch');
  }

  let code: string | null = null;
  let role: Role | null = null;
  let token: string | null = null;
  const aborter = new AbortController();
  let closed = false;

  const url = (path: string): string => `${baseUrl}/api${path}`;

  const authHeader = (): Record<string, string> => {
    if (!token) throw new Error('signaling: not authenticated yet');
    // We use a custom header instead of `Authorization` because Azure
    // Static Web Apps reserves `Authorization` for its own managed-auth
    // proxy and strips/replaces it before requests reach the Function.
    // The server reads the same `X-Mojong-Token` header.
    return { 'X-Mojong-Token': token };
  };

  /** Throw `SignalingError` on non-2xx; otherwise return the response. */
  async function check(res: Response): Promise<Response> {
    if (res.ok) return res;
    let errCode = `http_${res.status}`;
    let detail: string | undefined;
    try {
      const body = (await res.clone().json()) as JsonError & { detail?: string };
      if (typeof body?.error === 'string') errCode = body.error;
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // body wasn't JSON — fine, keep the generic code
    }
    throw new SignalingError(res.status, errCode, detail);
  }

  /** Re-throw an AbortError as our typed `SignalingAbortError`. */
  function rethrowIfAbort(err: unknown): never {
    if (closed || (err instanceof Error && err.name === 'AbortError')) {
      throw new SignalingAbortError();
    }
    throw err as Error;
  }

  // ── Session lifecycle ────────────────────────────────────

  async function host(): Promise<{ code: string }> {
    const res = await check(
      await fetchImpl(url('/sessions'), { method: 'POST' }),
    );
    const body = (await res.json()) as { code: string; hostToken: string };
    code = body.code;
    role = 'host';
    token = body.hostToken;
    return { code: body.code };
  }

  async function join(joinCode: string): Promise<void> {
    const upper = joinCode.toUpperCase();
    const res = await check(
      await fetchImpl(url(`/sessions/${encodeURIComponent(upper)}/join`), {
        method: 'POST',
      }),
    );
    const body = (await res.json()) as { joinerToken: string };
    code = upper;
    role = 'joiner';
    token = body.joinerToken;
  }

  function attach(args: { code: string; role: Role; token: string }): void {
    code = args.code.toUpperCase();
    role = args.role;
    token = args.token;
  }

  async function reattach(): Promise<{ role: Role; renegotiationCount: number }> {
    if (!code) throw new Error('signaling: no session yet');
    const res = await check(
      await fetchImpl(
        url(`/sessions/${encodeURIComponent(code)}/reattach`),
        {
          method: 'POST',
          headers: authHeader(),
        },
      ),
    );
    const body = (await res.json()) as { role: Role; renegotiationCount: number };
    // Server tells us authoritatively which slot we own. In normal
    // use this matches our cached role; if it doesn't, trust the
    // server (e.g. token reuse across roles in tests).
    role = body.role;
    return body;
  }

  // ── SDP ──────────────────────────────────────────────────

  async function putSdp(slot: Role, sdp: string): Promise<void> {
    if (!code) throw new Error('signaling: no session yet');
    await check(
      await fetchImpl(
        url(`/sessions/${encodeURIComponent(code)}/sdp/${slot}`),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify({ sdp }),
        },
      ),
    );
  }

  async function pollSdp(slot: Role): Promise<string> {
    if (!code) throw new Error('signaling: no session yet');
    while (!closed) {
      let res: Response;
      try {
        res = await fetchImpl(
          url(`/sessions/${encodeURIComponent(code)}/sdp/${slot}`),
          { method: 'GET', headers: authHeader(), signal: aborter.signal },
        );
      } catch (err) {
        rethrowIfAbort(err);
      }
      if (res!.status === 204) continue; // server long-poll timed out, retry
      const ok = await check(res!);
      const body = (await ok.json()) as { sdp: string };
      return body.sdp;
    }
    throw new SignalingAbortError();
  }

  // ── ICE ──────────────────────────────────────────────────

  async function postIce(
    slot: Role,
    candidate: RTCIceCandidateInit | null,
  ): Promise<void> {
    if (!code) throw new Error('signaling: no session yet');
    await check(
      await fetchImpl(
        url(`/sessions/${encodeURIComponent(code)}/ice/${slot}`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader() },
          body: JSON.stringify(candidate),
        },
      ),
    );
  }

  async function pollIce(
    slot: Role,
  ): Promise<(RTCIceCandidateInit | null)[]> {
    if (!code) throw new Error('signaling: no session yet');
    let res: Response;
    try {
      res = await fetchImpl(
        url(`/sessions/${encodeURIComponent(code)}/ice/${slot}`),
        { method: 'GET', headers: authHeader(), signal: aborter.signal },
      );
    } catch (err) {
      rethrowIfAbort(err);
    }
    if (res!.status === 204) return [];
    const ok = await check(res!);
    const body = (await ok.json()) as {
      candidates: (RTCIceCandidateInit | null)[];
    };
    return body.candidates;
  }

  function close(): void {
    if (closed) return;
    closed = true;
    aborter.abort();
  }

  return {
    host,
    join,
    attach,
    reattach,
    putSdp,
    pollSdp,
    postIce,
    pollIce,
    close,
    get code() {
      return code;
    },
    get role() {
      return role;
    },
    get token() {
      return token;
    },
  };
}
