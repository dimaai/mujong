// ============================================================
// api/src/sessions/appServiceCredential.ts
//
// PURPOSE
//   Minimal `TokenCredential` for the App Service / Static Web
//   Apps managed-identity endpoint.
//
//   The official `ManagedIdentityCredential` from
//   `@azure/identity` ships with auto-detection logic that, in
//   our SWA-managed-Functions runtime, picks a path expecting an
//   `expires_on` field that the IDENTITY_ENDPOINT response
//   doesn't include in the shape it wants — producing the
//   famously unhelpful "Cannot read properties of undefined
//   (reading 'expires_on')" error.
//
//   We sidestep the SDK entirely by speaking directly to the
//   IMDS-style HTTP endpoint App Service exposes. The protocol
//   is stable and documented:
//     https://learn.microsoft.com/azure/app-service/overview-managed-identity
//
//   The two env vars `IDENTITY_ENDPOINT` and `IDENTITY_HEADER`
//   are injected by the runtime; we GET the endpoint with
//   `?resource=...&api-version=2019-08-01` and the
//   `X-IDENTITY-HEADER: <IDENTITY_HEADER>` header.
//
//   We cache the token in-process and refresh ~5 min before
//   expiry so the hot path is allocation-free.
// ============================================================

import type {
  AccessToken,
  GetTokenOptions,
  TokenCredential,
} from '@azure/core-auth';

/** Refresh this many ms before the token's stated expiry. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Shape of the JSON returned by the App Service identity endpoint. */
interface IdentityResponse {
  access_token: string;
  /** Unix epoch *seconds* (string in legacy responses, number in newer). */
  expires_on?: string | number;
  /** Lifetime in seconds (alternative field). */
  expires_in?: string | number;
  resource?: string;
  token_type?: string;
}

/**
 * Build a `TokenCredential` that talks to the App Service /
 * SWA-managed-Functions identity endpoint.
 *
 * Throws at *call time* (not construction) if the endpoint env
 * vars are missing, so unit tests and offline runs that never
 * touch this credential aren't affected.
 */
export function createAppServiceManagedIdentityCredential(): TokenCredential {
  let cached: AccessToken | null = null;

  return {
    async getToken(
      scopes: string | string[],
      _options?: GetTokenOptions,
    ): Promise<AccessToken | null> {
      const endpoint = process.env.IDENTITY_ENDPOINT;
      const header = process.env.IDENTITY_HEADER;
      if (!endpoint || !header) {
        throw new Error(
          'IDENTITY_ENDPOINT/IDENTITY_HEADER not set — managed identity is not available in this runtime',
        );
      }

      // Reuse the cached token if it's still comfortably valid.
      const now = Date.now();
      if (cached && cached.expiresOnTimestamp - REFRESH_SKEW_MS > now) {
        return cached;
      }

      // The Azure SDK passes scopes like
      // "https://storage.azure.com/.default". The IMDS endpoint
      // wants a resource without the "/.default" suffix.
      const scope = Array.isArray(scopes) ? scopes[0]! : scopes;
      const resource = scope.replace(/\/\.default$/, '');

      const url = `${endpoint}?resource=${encodeURIComponent(resource)}&api-version=2019-08-01`;
      const res = await fetch(url, {
        headers: { 'X-IDENTITY-HEADER': header },
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `App Service identity endpoint ${res.status}: ${body || res.statusText}`,
        );
      }

      const data = (await res.json()) as IdentityResponse;
      if (!data.access_token) {
        throw new Error(
          'App Service identity endpoint returned no access_token',
        );
      }

      // Compute expiry. Prefer `expires_on` (absolute), else
      // derive from `expires_in` (relative seconds).
      let expiresOnTimestamp: number;
      if (data.expires_on !== undefined && data.expires_on !== null) {
        const asNum =
          typeof data.expires_on === 'string'
            ? Number(data.expires_on)
            : data.expires_on;
        // Some endpoints return seconds, some milliseconds.
        // Anything below 10^12 is clearly seconds.
        expiresOnTimestamp = asNum < 1e12 ? asNum * 1000 : asNum;
      } else if (data.expires_in !== undefined && data.expires_in !== null) {
        const seconds =
          typeof data.expires_in === 'string'
            ? Number(data.expires_in)
            : data.expires_in;
        expiresOnTimestamp = now + seconds * 1000;
      } else {
        // Last-ditch: assume the standard 1-hour lifetime.
        expiresOnTimestamp = now + 60 * 60 * 1000;
      }

      cached = { token: data.access_token, expiresOnTimestamp };
      return cached;
    },
  };
}
