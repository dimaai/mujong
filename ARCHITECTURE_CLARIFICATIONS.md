# Architecture Clarifications

Decisions explicitly made, plus open questions that need confirmation before they're locked in. Each entry is small, dated, and self-contained so it can be moved into [ARCHITECTURE.md](ARCHITECTURE.md) once settled.

> **How to use:** when you confirm or change a decision, edit the entry, change its **Status**, and (if it's now stable) consider folding it into the main ARCHITECTURE doc.

---

## Decisions made (2026-05-02)

### D-001 Multiplayer transport — WebRTC P2P
- **Decision:** WebRTC DataChannel for game traffic; tiny signaling service only for handshake.
- **Why:** turn-based ≈ <100 messages/game; no per-game server cost; matches static-export hosting; works through most NATs with a public STUN.
- **Trade-off:** ~10% of corporate networks may need a TURN relay. Acceptable for v1; we'll add TURN if telemetry shows failures.

### D-002 Authority model — deterministic dual-replica
- **Decision:** both peers run the same domain code on the same `TurnAction` stream; no central authority.
- **Why:** rules already pure (`src/domain/rules.ts`), turn ownership prevents conflicts, simpler than a server.
- **Trade-off:** a malicious peer can desync; we'll detect via post-action hash compare and disconnect. Anti-cheat is **not** a v1 goal.

### D-003 Persistence backend — localStorage + Zustand persist
- **Decision:** `localStorage` via a thin adapter in `src/persistence/`, integrated through Zustand `persist` middleware for profile/settings; manual snapshot for in-progress game.
- **Why:** payloads <10 KB, synchronous API is fine, smallest moving parts.
- **Upgrade path:** swap the adapter to IndexedDB without touching stores when game-history archive lands.

### D-004 PWA tooling — `@ducanh2912/next-pwa`
- **Decision:** maintained fork of `next-pwa`, App Router + Next 15 compatible.
- **Why:** drop-in service worker + manifest helpers; avoids hand-rolling Workbox config.
- **Disabled in dev** to avoid stale caches.

### D-005 Levels redesigned as "piece sets"
- **Decision:** `Difficulty` (Beginner / Normal / Advanced) controls **only** the piece roster. Board size becomes a separate `BoardSizePreset` setting. Existing `LEVELS[]` becomes the seed for the new piece sets.
- **Migration:** any saved settings using old `levelId` are mapped to `{ difficulty: 'normal', boardSizeId: 'medium' }` on first load.

### D-006 Routing — App Router pages, not in-component view state
- **Decision:** `/`, `/settings`, `/network`, `/play` are real Next.js routes.
- **Why:** native back-button support on iOS PWA, deep-linkable invitation URLs (`/?join=MJ-7K2X`), simpler component boundaries.

### D-007 Invitation code format
- **Decision:** `MJ-XXXX` where `XXXX` is 4 base32 chars (Crockford alphabet, no I/L/O/U). 1M combinations, ~10-min TTL on signaling.
- **Why:** short enough to read aloud, ambiguity-free, collision-resistant for the lifetime of an open invite.

### D-008 Online vs offline behaviour
- **Decision:** all features except Network Game work offline; the Network Game button is shown but disabled offline with a tooltip.

### D-009 Persistence — local-first with optional cloud mirror (resolves Q-007)
- **Decision:** local storage is the source of truth. A `Persisted<T>` envelope (`{ v, data, updatedAt, deviceId }`) wraps every cloud-eligible blob. When online, profile + settings are mirrored to a tiny REST endpoint with **last-write-wins by `updatedAt`** per blob.
- **Identity:** two ids — `deviceId` (per install, never synced) and `userId` (key for cloud blobs). Until accounts exist, `userId === deviceId`; "sync" is effectively a backup of this device. Adding auth later promotes `userId` to a true cross-device key with no store changes.
- **Scope:** profile + settings are synced. The in-progress game is **not** synced in v1 (changes too often; merge headache, no clear UX win).
- **Implementation:** the envelope and id generation land in Step 1 of the implementation plan (cheap, future-proof). The sync client + backend are deferred to **Phase J**, after the offline-first slice is shipped.
- **Why LWW per blob, not CRDT:** payloads are tiny, single-user, low-frequency. Whole-blob LWW is dramatically simpler and loses no data in realistic scenarios.

### D-010 Function App deploy — managed identity + public network access required (2026-05-12)
- **Decision:** the standalone Function App (`mojong-signaling-api`, Flex Consumption, West Europe) authenticates to its runtime storage account (`mojongsignaling`) via **system-assigned managed identity**, never via shared keys. The storage account therefore keeps `allowSharedKeyAccess = false`, but **must keep `publicNetworkAccess = Enabled`** so GitHub-hosted runners can upload deploy packages.
- **Required app settings** (already on the Function App; do not remove):
  - `AzureWebJobsStorage__blobServiceUri  = https://mojongsignaling.blob.core.windows.net`
  - `AzureWebJobsStorage__queueServiceUri = https://mojongsignaling.queue.core.windows.net`
  - `AzureWebJobsStorage__tableServiceUri = https://mojongsignaling.table.core.windows.net`
  - `AzureWebJobsStorage__credential       = managedidentity`
  - `MOJONG_TABLES_ENDPOINT                = https://mojongsignaling.table.core.windows.net` (used by `api/src/sessions/defaultStore.ts` and `api/src/sync/defaultStore.ts` to pick the AAD-backed Table store)
- **Required RBAC** (system-assigned MI on the Function App, principalId `1f96a8eb-c856-49ff-bdb6-700fea7a21a9` at the time of writing):
  - `Storage Blob Data Owner` on the storage account
  - `Storage Table Data Contributor` on the storage account
  - `Storage Queue Data Contributor` on the storage account
- **Common failure mode:** if a deploy fails with `Neither AzureWebJobsStorage nor AzureWebJobsStorage__accountName exist in app settings` AND/OR `Failed to deploy web package`, the cause is almost always `publicNetworkAccess = Disabled` on `mojongsignaling`. The error message is misleading — the runtime *does* have valid managed-identity settings; the upload path itself just cannot reach the deployment-storage container from the public runner. Fix:
  ```pwsh
  az storage account update --name mojongsignaling --resource-group mojong --public-network-access Enabled
  ```
  Then re-run the workflow (`gh run rerun <id>`). Do **not** add a shared-key connection string as a workaround — `allowSharedKeyAccess = false` will reject it at runtime even if the deploy validator accepts it.
- **Why we live with public access:** only `audit`-effect policies flag this; nothing enforces it back to Disabled. The security gate is shifted to MI-only auth + Defender data scanning, not network isolation. If we ever need network isolation, the proper path is a self-hosted runner inside a VNet that has a private endpoint to `mojongsignaling`; that's a Phase-K-or-later decision.
- **Why the `AzureWebJobsStorage` warning in the deploy log is safe to ignore:** the GitHub Action checks for the legacy connection-string-form setting. Flex Consumption uses the URI-form (`__blobServiceUri` + `__credential`) which the action doesn't recognise as equivalent. The Functions host honours both; the warning is cosmetic.

---

## Open questions (need confirmation)

### Q-001 Signaling host — Azure Functions vs Azure Web PubSub vs third party
- **Default if not answered:** single Azure Function (Node, HTTP trigger) with an in-memory `Map<code, session>` for v1. Free tier covers expected load. Replace with Web PubSub when concurrent sessions > ~50 or when we want presence.
- **Question for you:** are you okay paying ~$0/month on Functions free tier for v1, or do you want to skip a backend entirely (e.g. use a public WebRTC signaling service like PeerJS)?

### Q-002 Walls — placement rule and jumpability
- **Default if not answered:**
  - Board height even → walls at `(width/2 - 1, height/2)` and `(width/2, height/2 - 1)`.
  - Board height odd → walls at `(floor(width/2) - 1, floor(height/2))` and `(floor(width/2) + 1, floor(height/2))`.
  - Walls **block all figures**, including jumpers (`canJump`). They are terrain, not pieces.
- **Question for you:** confirm placement formula, and confirm that even `canJump` figures cannot leap walls.

### Q-003 Color picker — per-game or per-profile?
- **Default if not answered:** colors live on the **Profile** (one color per local player), reused across games. Network game uses each player's own profile color; if both pick the same color, the joiner gets the next color in a fallback palette.
- **Question for you:** confirm, or do you want per-game color selection that overrides profile?

### Q-004 Who controls game options in a network game?
- **Default if not answered:** the **host** picks all `GameOptions` before generating the invitation code. The joiner sees them in the lobby, can only Accept or Decline.
- **Question for you:** confirm, or should the joiner negotiate (e.g. propose changes)?

### Q-005 First move in a network game
- **Default if not answered:** **host = Player 1, always moves first.** Matches local convention and avoids a coin-flip handshake.
- **Question for you:** confirm.

### Q-006 Persisted in-progress game on app reopen
- **Default if not answered:** if a saved game exists, the Main Menu shows a "**Resume game**" banner above the buttons. Starting a new game prompts to discard.
- **Question for you:** confirm UX.

*(Q-007 resolved — see D-009 below.)*

### Q-008 iOS-specific UX details
- **Default if not answered:** standalone display, no status bar tinting beyond `default-translucent`. No haptics, no orientation lock.
- **Question for you:** lock to portrait? Add haptic feedback on capture?

### Q-009 Tutorial scope
- **Default if not answered:** a static page with figure types, board, and a worked example. No interactive board in v1.
- **Question for you:** confirm static is fine.

### Q-010 Telemetry / crash reporting
- **Default if not answered:** none in v1.
- **Question for you:** confirm.

---

## Rejected alternatives (kept here so we don't re-litigate)

### R-001 Authoritative server with Azure SignalR
- **Rejected because:** doubles infra cost for a strictly turn-based game; doesn't solve any problem D-002 doesn't already solve; adds a runtime dependency to an offline-first app.

### R-002 IndexedDB for v1
- **Rejected because:** payload <10 KB, async API complicates Zustand integration, no measurable benefit until we add game-history archives.

### R-003 Capacitor / native iOS shell for v1
- **Rejected because:** PWA satisfies all stated requirements (offline, no App Store). Capacitor remains the documented fallback if PWA storage eviction or install friction proves blocking.

### R-004 In-component view state instead of routes
- **Rejected because:** D-006 — App Router gives free back-button + deep-link support on iOS PWA.
