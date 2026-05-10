// ============================================================
// src/net/iceServers.ts
//
// PURPOSE
//   Fetch a fresh `RTCIceServer[]` from the signaling API. Keeps
//   TURN credentials off the client bundle: the server-side
//   `iceServers` Function holds the provider API key in env
//   vars and proxies the provider's REST call.
//
//   Inputs  : optional `{ baseUrl, fetch }` test seam.
//   Output  : `RTCIceServer[]` — falls back to public STUN only
//             on failure so the app still boots when the API is
//             unreachable (signaling will fail later with a
//             clear error).
//   Side fx : one HTTPS request to `${baseUrl}/api/iceServers`.
// ============================================================

/** Built-in fallback. STUN-only — works on most networks but
 *  not on symmetric NAT (mobile carriers, corporate Wi-Fi). */
const STUN_FALLBACK: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export interface FetchIceServersOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * Ask the API for the current ICE server set. Never throws:
 * on any error returns `STUN_FALLBACK` so a broken iceServers
 * endpoint cannot block the lobby from at least trying. The
 * caller can log the fallback path via the net logger.
 */
export async function fetchIceServers(
  options: FetchIceServersOptions = {},
): Promise<{ iceServers: RTCIceServer[]; fellBack: boolean }> {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl: typeof fetch =
    options.fetch ?? (globalThis.fetch?.bind(globalThis) as typeof fetch);
  if (!fetchImpl) {
    return { iceServers: STUN_FALLBACK, fellBack: true };
  }

  try {
    const res = await fetchImpl(`${baseUrl}/api/iceServers`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { iceServers: STUN_FALLBACK, fellBack: true };
    const body = (await res.json()) as { iceServers?: RTCIceServer[] };
    if (!Array.isArray(body.iceServers) || body.iceServers.length === 0) {
      return { iceServers: STUN_FALLBACK, fellBack: true };
    }
    return { iceServers: body.iceServers, fellBack: false };
  } catch {
    return { iceServers: STUN_FALLBACK, fellBack: true };
  }
}
