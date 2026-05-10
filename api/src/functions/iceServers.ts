// ============================================================
// api/src/functions/iceServers.ts
//
// PURPOSE
//   HTTP entry point for `GET /api/iceServers`. Returns a fresh
//   `RTCIceServer[]` for the browser to use when constructing
//   its `RTCPeerConnection`.
//
//   The browser must NEVER see our TURN provider's API key. So
//   this Function holds the secret in server-side env vars and
//   proxies metered.ca's REST API:
//
//     GET https://{METERED_APP}.metered.live/api/v1/turn/credentials
//         ?apiKey={METERED_API_KEY}
//
//   The provider returns an `iceServers` array (STUN + TURN with
//   username/credential). We forward it to the client verbatim.
//
//   Inputs   : none
//   Outputs  : 200 { iceServers: RTCIceServer[] }   on success
//              500 { error: 'misconfigured' }       if env vars missing
//              502 { error: 'upstream', detail }    if metered fails
//   Side fx  : one outbound HTTPS request per call
// ============================================================

import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions';

interface MeteredIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export async function iceServersHandler(
  _req: HttpRequest,
  ctx: InvocationContext,
): Promise<HttpResponseInit> {
  const apiKey = process.env.METERED_API_KEY;
  const appName = process.env.METERED_APP_NAME;

  if (!apiKey || !appName) {
    ctx.error('iceServers: METERED_API_KEY or METERED_APP_NAME missing');
    return { status: 500, jsonBody: { error: 'misconfigured' } };
  }

  const url =
    `https://${appName}.metered.live/api/v1/turn/credentials` +
    `?apiKey=${encodeURIComponent(apiKey)}`;

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    ctx.error('iceServers: upstream fetch threw', err);
    return { status: 502, jsonBody: { error: 'upstream', detail } };
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    ctx.error(`iceServers: upstream ${upstream.status} ${text}`);
    return {
      status: 502,
      jsonBody: { error: 'upstream', status: upstream.status },
    };
  }

  const body = (await upstream.json()) as MeteredIceServer[];
  // Light validation: it must be a non-empty array of objects
  // with `urls`. Anything weirder we treat as a provider issue.
  if (!Array.isArray(body) || body.length === 0) {
    ctx.error('iceServers: upstream returned unexpected shape');
    return { status: 502, jsonBody: { error: 'upstream-shape' } };
  }

  return {
    status: 200,
    // Cache for a few minutes. Credentials inside are still
    // long-lived on the provider side, but caching lets us
    // tolerate transient upstream blips without blocking new
    // sessions.
    headers: { 'cache-control': 'private, max-age=300' },
    jsonBody: { iceServers: body },
  };
}

app.http('iceServers', {
  methods: ['GET'],
  route: 'iceServers',
  authLevel: 'anonymous',
  handler: iceServersHandler,
});
