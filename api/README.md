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

- The session store has two implementations behind the same `SessionStore`
  interface:
  - **In-memory** (default for `func start` and unit tests). Sessions are lost
    when the process restarts.
  - **Azure Table Storage** (used in deployment). Picked automatically when
    `AzureWebJobsStorage` (or `MOJONG_TABLES_CONN`) is set, so signaling
    sessions survive cold starts and worker scale-out — required because SWA
    managed Functions can route a single lobby's host and joiner calls to
    different worker instances.
  - Local dev with the table store: install Azurite (`npm i -g azurite`), set
    `"AzureWebJobsStorage": "UseDevelopmentStorage=true"` in
    `local.settings.json`, then `func start`.
- Codes are 6 characters from a 31-char ambiguity-free alphabet
  (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`); `createSession` retries on collision.
- Tokens are 48-char hex strings (`crypto.randomBytes(24)`). They're opaque
  bearer secrets used by Step 14 to authorise SDP/ICE writes; no real auth
  in v1.

## Operations

### Deploy

Pushes to `main` that touch `api/**` trigger [.github/workflows/azure-functions-api.yml](../.github/workflows/azure-functions-api.yml),
which builds, tests, and ZIP-deploys to the Flex Consumption Function App
`mojong-signaling-api` (West Europe, resource group `mojong`) via OIDC.

### "Deployment Failed!" troubleshooting

If the workflow fails with **"Neither AzureWebJobsStorage nor
AzureWebJobsStorage__accountName exist in app settings"** and/or **"Failed
to deploy web package"**, the cause is almost always that the storage
account `mojongsignaling` has `publicNetworkAccess = Disabled`. The
GitHub-hosted runner cannot upload the deploy package to the deployment-
storage container without public network access, and the error message is
misleading. See [ARCHITECTURE_CLARIFICATIONS.md D-010](../ARCHITECTURE_CLARIFICATIONS.md)
for the full rationale.

**Fix:**

```pwsh
az storage account update `
  --name mojongsignaling `
  --resource-group mojong `
  --public-network-access Enabled

# Then re-run the failed workflow:
gh run rerun <run-id>
```

**Do not** add a shared-key connection string for `AzureWebJobsStorage` as
a workaround. The storage account has `allowSharedKeyAccess = false` by
design (managed-identity-only auth); shared keys are rejected at runtime
even if the deploy validator accepts them.

### What "good" looks like on the Function App

These app settings must be present (already configured; recorded here so a
future redeploy / IaC migration preserves them):

| Setting                                 | Value                                                         |
| --------------------------------------- | ------------------------------------------------------------- |
| `AzureWebJobsStorage__blobServiceUri`   | `https://mojongsignaling.blob.core.windows.net`               |
| `AzureWebJobsStorage__queueServiceUri`  | `https://mojongsignaling.queue.core.windows.net`              |
| `AzureWebJobsStorage__tableServiceUri`  | `https://mojongsignaling.table.core.windows.net`              |
| `AzureWebJobsStorage__credential`       | `managedidentity`                                             |
| `MOJONG_TABLES_ENDPOINT`                | `https://mojongsignaling.table.core.windows.net`              |

The Function App's system-assigned managed identity must hold these roles
on the `mojongsignaling` storage account:

- Storage Blob Data Owner
- Storage Table Data Contributor
- Storage Queue Data Contributor

The deploy log will print a warning that `AzureWebJobsStorage` is missing.
That warning is **safe to ignore** — the Functions runtime accepts the
URI-form settings above; the deploy action just doesn't recognise them as
equivalent.
