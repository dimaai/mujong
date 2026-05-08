# Mojong signaling API

Azure Static Web Apps **managed Functions** backend (Node 20, Azure Functions v4
programming model). Owns the WebRTC signaling endpoints described in
[ARCHITECTURE.md](../ARCHITECTURE.md) §6 and [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md)
Steps 13–14.

## Endpoints (Step 13)

| Method | Route                              | Returns                            |
| ------ | ---------------------------------- | ---------------------------------- |
| POST   | `/api/sessions`                    | `201 { code, hostToken }`          |
| POST   | `/api/sessions/{code}/join`        | `200 { joinerToken }`, `404`, `409`|

> SDP/ICE relay endpoints land in **Step 14**.

## Layout

```
api/
  host.json              Azure Functions host config
  package.json           Node 20, @azure/functions v4
  tsconfig.json
  src/
    sessions/
      store.ts           Pure store (Map + injected clock + injected RNG)
      defaultStore.ts    Singleton wired to crypto.randomBytes + Date.now
      __tests__/
        store.test.ts
    functions/
      createSession.ts   Registers POST /api/sessions
      joinSession.ts     Registers POST /api/sessions/{code}/join
```

`src/sessions/store.ts` is intentionally framework-free (no `@azure/functions`
imports), so the same code can move to a different host later if needed.

## Local dev

```bash
cd api
npm install
npm run build
func start              # requires Azure Functions Core Tools v4
```

Then in another shell:

```bash
curl -X POST http://localhost:7071/api/sessions
# → { "code": "K7M2QX", "hostToken": "…" }

curl -X POST http://localhost:7071/api/sessions/K7M2QX/join
# → { "joinerToken": "…" }

curl -X POST http://localhost:7071/api/sessions/K7M2QX/join
# → 409 { "error": "already_joined" }
```

## Tests

```bash
npm test
```

## Notes

- Sessions are kept **in process memory only**. Acceptable for v1 because a
  game session completes within a few minutes and managed Functions instances
  are short-lived. Persistence (Azure Table Storage) lands with Phase J.
- Codes are 6 characters from a 31-char ambiguity-free alphabet
  (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`); `createSession` retries on collision.
- Tokens are 48-char hex strings (`crypto.randomBytes(24)`). They're opaque
  bearer secrets used by Step 14 to authorise SDP/ICE writes; no real auth
  in v1.
