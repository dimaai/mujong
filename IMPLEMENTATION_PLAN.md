# Implementation Plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). Work is sliced into small, independent steps. Each step has a **clear stopping point** so it can land as its own PR and be reviewed in isolation.

> **How to use:** start at the top. Do not begin step *N+1* until step *N*'s STOP condition is met. If a step grows beyond ~150 LOC or ~2 files, split it.

---

## Next 5 steps (start here)

### 1. Persistence adapter + storage keys + envelope + ids
1. **Step name:** Add a typed local-storage adapter with the `Persisted<T>` envelope and id bootstrap.
2. **Files involved:**
   - `src/persistence/storage.ts` *(new)*
   - `src/persistence/keys.ts` *(new)*
   - `src/persistence/ids.ts` *(new)*
3. **What will be implemented:**
   - Generic `getItem<T>(key)`, `setItem<T>(key, value)`, `removeItem(key)` that JSON-encode and are SSR-safe (no-op when `window` is undefined).
   - `Persisted<T> = { v, data, updatedAt, deviceId }` type plus `getEnvelope<T>(key) / setEnvelope<T>(key, data)` helpers that stamp `updatedAt` and `deviceId` on every write.
   - Centralised `STORAGE_KEYS` object listing every key, each suffixed with a version (`v1`).
   - `getDeviceId()` / `getUserId()` lazily create UUIDs via `crypto.randomUUID()` and persist them under `mojong.ids.v1`. For v1, `userId === deviceId` until accounts exist.
   - No store changes yet — pure utility module. Cloud sync is **not** implemented here; the envelope just makes Phase J a drop-in.
4. **STOP condition:** `npm run type-check` passes; calling `setEnvelope` then `getEnvelope` from a one-off debug call round-trips the data, `updatedAt` advances on each write, and `deviceId` is stable across reloads. No UI impact.

### Step 2 — Profile store with persistence
1. **Step name:** Introduce `useProfileStore` backed by the adapter.
2. **Files involved:**
   - `src/store/profileStore.ts` *(new)*
   - `src/persistence/storage.ts` *(touch — only if `persist` middleware needs a custom storage object)*
3. **What will be implemented:**
   - Zustand store holding `{ player1: Profile, player2: Profile }` with actions `setName`, `setColor`, `reset`.
   - Wired through Zustand `persist` middleware using the adapter from Step 1 and key `STORAGE_KEYS.profile`.
   - Default profiles: `Player 1 / blue`, `Player 2 / red`.
   - **No UI wiring yet.** [GameSetup](src/components/GameSetup/GameSetup.tsx) is untouched.
4. **STOP condition:** opening DevTools shows the JSON in `localStorage` after calling `setName` from a temporary debug button or test; reload preserves the value.

### Step 3 — Settings store + new domain types (no UI yet)
1. **Step name:** Add `GameOptions` types and `useSettingsStore`.
2. **Files involved:**
   - `src/domain/types.ts` *(touch — add `Difficulty`, `BoardSizePreset`, `GameOptions`; do **not** remove `Level` yet)*
   - `src/store/settingsStore.ts` *(new)*
   - `src/data/boardSizes.ts` *(new — three presets seeded from existing `LEVELS`)*
3. **What will be implemented:**
   - New types living **alongside** the existing `Level`, so nothing breaks.
   - `useSettingsStore` with persisted `GameOptions` (`difficulty`, `boardSizeId`, `timerMinutes`, `againstView`, `walls`) and a `save(partial)` action.
   - One-time migration: if the old `selectedLevelId` is found in storage, map it to `{ difficulty: 'normal', boardSizeId: 'medium' }` and delete the old key.
4. **STOP condition:** `npm run type-check` passes; `useSettingsStore.getState()` returns sensible defaults; existing game still starts and plays normally because the old `LEVELS` path is untouched.

### Step 4 — PWA shell (manifest + service worker), no behaviour changes
1. **Step name:** Make the app installable and offline-cacheable on iOS.
2. **Files involved:**
   - `next.config.ts` *(touch — wrap config with `@ducanh2912/next-pwa`)*
   - `public/manifest.webmanifest` *(new)*
   - `src/app/layout.tsx` *(touch — add `<link rel="manifest">`, apple-touch-icon, `apple-mobile-web-app-capable` meta)*
   - `package.json` *(touch — add `@ducanh2912/next-pwa` dep)*
   - icon assets in `public/icons/` *(new — 192, 512, maskable; can start with placeholders)*
3. **What will be implemented:**
   - Service worker registered automatically in production builds; disabled in dev.
   - Manifest with name, short_name, `display: "standalone"`, theme + background colors, icon set.
   - iOS meta tags so "Add to Home Screen" produces a proper standalone icon.
   - **Zero changes to gameplay code.**
4. **STOP condition:** `npm run build && npx serve out` (or deployed to Azure) → opening on iPhone Safari → "Add to Home Screen" → launching from home screen shows the app fullscreen and works after enabling Airplane Mode.

### Step 5 — Split home into MainMenu route (Settings + Network still stubs)
1. **Step name:** Replace the monolithic [GameSetup](src/components/GameSetup/GameSetup.tsx) with routes `/` (MainMenu) and `/play`.
2. **Files involved:**
   - `src/components/MainMenu/MainMenu.tsx` *(new — names + colors read/written via `useProfileStore`; buttons: Network Game, Settings, Tutorial, Start Game)*
   - `src/app/page.tsx` *(touch — render `<MainMenu />` instead of `<GameSetup />`)*
   - `src/app/play/page.tsx` *(new — renders `<GameCanvas />` and redirects to `/` when no active game)*
3. **What will be implemented:**
   - MainMenu uses the new `useProfileStore` for name/color inputs.
   - "Settings", "Network Game", "Tutorial" buttons render as **disabled stubs** (`disabled` + tooltip "Coming soon"). They will be wired in subsequent steps.
   - "Start Game" calls `useGameStore.startGame` using a hard-coded current `Level` (kept from `LEVELS[1]`) so gameplay still works exactly as today.
   - Old [GameSetup](src/components/GameSetup/GameSetup.tsx) file is **left in place**, simply no longer imported, so we can delete it cleanly in a follow-up.
4. **STOP condition:** `npm run dev` → home shows the new menu; clicking Start Game opens `/play` with the working board; reloading `/play` mid-game restores the canvas (in-progress persistence comes later — for now reload may reset).

---

## Next 5 steps (continue here, after Step 5 lands)

### Step 6 — Settings route + form (read/write `useSettingsStore`)
1. **Step name:** Add a real `/settings` route that edits `GameOptions` and persists via Step 3's store.
2. **Files involved:**
   - `src/app/settings/page.tsx` *(new — renders `<Settings />`)*
   - `src/components/Settings/Settings.tsx` *(new)*
   - `src/components/Settings/Settings.module.css` *(new)*
   - `src/components/MainMenu/MainMenu.tsx` *(touch — un-stub the "Settings" button to navigate to `/settings`)*
3. **What will be implemented:**
   - Form controls for every field on `GameOptions`:
     - `difficulty` — segmented control: Beginner / Normal / Advanced.
     - `boardSizeId` — segmented control fed by [src/data/boardSizes.ts](src/data/boardSizes.ts).
     - `timerMinutes` — number input (0 = off).
     - `againstView` — toggle (per ARCHITECTURE §4: orient board so each player faces their own pieces).
     - `walls` — toggle.
   - **Save / Cancel** semantics: on mount, snapshot `useSettingsStore.getState().options`; "Save" calls `save(form)`, "Cancel" navigates back without writing.
   - No gameplay wiring yet — Start Game still uses the hard-coded `Level` from Step 5. This step only proves the store round-trips through a real UI.
4. **STOP condition:** `npm run dev` → MainMenu → Settings → change every field → Save → reload → Settings reopens with the saved values. Cancel discards changes. `npm run type-check` and `npm run lint` pass.

### Step 7 — Wire Start Game to `useSettingsStore` (replace hard-coded `Level`)
1. **Step name:** MainMenu's Start button reads the live `GameOptions` instead of `LEVELS[1]`.
2. **Files involved:**
   - `src/components/MainMenu/MainMenu.tsx` *(touch)*
   - `src/store/gameStore.ts` *(touch — `startGame` accepts `GameOptions` + `Profile[2]` instead of a single `Level`)*
   - `src/domain/board.ts` *(touch — `createInitialState` accepts `{ boardSize, allowedFigures, players }` derived from `GameOptions` + difficulty mapping)*
   - `src/data/levels.ts` *(touch — keep file for now but mark deprecated in a top comment; Phase I deletes it)*
3. **What will be implemented:**
   - Difficulty → `allowedFigures` mapping lives in a new helper `getFigureRosterFor(difficulty)` in [src/data/figuretypes.ts](src/data/figuretypes.ts) (or a new `src/data/difficulty.ts` if that file is too crowded — pick the smaller diff).
   - `boardSizeId` → `{ rows, cols }` via [src/data/boardSizes.ts](src/data/boardSizes.ts).
   - Player names + colors come from `useProfileStore`. Walls and timer are read but not yet honoured by the rules engine (walls land in Step 9; timer is display-only for now).
   - `useGameStore.startGame` signature changes from `startGame(level)` to `startGame({ options, profiles })`; all call sites updated in this step.
4. **STOP condition:** Changing any setting in `/settings`, returning to MainMenu and pressing Start produces a board that reflects those settings (correct size, correct piece roster, correct names/colors). Existing single-device gameplay still works end-to-end.

### Step 8 — `Walls` in the domain (state + deterministic placement, no rendering yet)
1. **Step name:** Make walls a first-class part of `GameState` and the rules engine.
2. **Files involved:**
   - `src/domain/types.ts` *(touch — add `walls: Position[]` to `GameState`; add `WallCell` discriminator if a `BoardCell` union is used)*
   - `src/domain/board.ts` *(touch — `placeWalls(boardSize): Position[]` deterministic helper; `createInitialState` consumes `options.walls`)*
   - `src/domain/rules.ts` *(touch — `getValidMoves` and `getValidPlacements` treat wall cells as blocked; `canJump` figures may pass over walls per ARCHITECTURE §4.2 pending the open clarification — implement the "blocks all, jumpable by `canJump`" branch and leave a `// TODO(Q-walls)` if the clarification flips it)*
   - `src/domain/__tests__/walls.test.ts` *(new — table-driven tests for blocked moves, blocked placements, and jumper-over-wall)*
3. **What will be implemented:**
   - `placeWalls` puts two walls symmetrically on the middle row(s) so the layout is identical for both players (deterministic, no RNG).
   - Rules helpers consult `state.walls` via a `Set<string>` of `"r,c"` for O(1) lookup.
   - Board rendering is **not** touched yet — walls exist in state but are invisible. This keeps the rules change isolated and reviewable.
4. **STOP condition:** New unit tests pass. Starting a game with `walls: true` produces a `GameState` whose `walls` array has the expected positions, and a manual test (paint walls red in DevTools by editing CSS, or log them) confirms moves into wall squares are rejected. `npm run type-check`, `npm run lint`, and tests all green.

### Step 9 — Render walls on the board
1. **Step name:** Make walls visible and skip them in placement/move highlighting.
2. **Files involved:**
   - `src/components/Board/Board.tsx` *(touch — render a `WallCell` variant for any position in `state.walls`)*
   - `src/components/Board/Board.module.css` *(touch — `.wall` style: distinct from valid/invalid highlights, accessible contrast)*
3. **What will be implemented:**
   - For each cell, check the wall set built in Step 8 and render a non-interactive cell (no click handler, `aria-label="Wall"`).
   - Valid-move and valid-placement highlights skip wall cells (already enforced in domain — UI just trusts the rules output).
   - No new domain logic; this step is purely presentational.
4. **STOP condition:** Toggling `walls` in Settings and starting a game shows two clearly distinguishable wall cells on the middle row that cannot be clicked, cannot receive a placement, and cannot be moved into. Screenshot attached to the PR.

### Step 10 — In-progress game persistence + "Resume" entry point
1. **Step name:** Snapshot `GameState` to local storage so a reload (or "Add to Home Screen" relaunch) doesn't lose the game.
2. **Files involved:**
   - `src/store/gameStore.ts` *(touch — write/clear an envelope under `STORAGE_KEYS.gameInProgress` on every `executeAction` and on `endGame`)*
   - `src/persistence/keys.ts` *(touch — add `gameInProgress: 'mojong.game.v1'`)*
   - `src/components/MainMenu/MainMenu.tsx` *(touch — show a "Resume game" button when an envelope exists)*
   - `src/app/play/page.tsx` *(touch — on mount, if no in-memory game but a persisted envelope exists, hydrate the store from it)*
3. **What will be implemented:**
   - Use the `Persisted<T>` envelope from Step 1 — same shape, no special-case storage.
   - Snapshot is debounced (e.g. `requestIdleCallback` fallback to `setTimeout(0)`) to avoid blocking the UI on every move.
   - On `endGame`, the envelope is removed so MainMenu doesn't keep offering to resume a finished match.
   - Schema-version guard: if the persisted `v` doesn't match the current `Persisted` version, delete the envelope and continue (no migration in v1).
4. **STOP condition:** Start a game, make a few moves, refresh the browser → MainMenu shows "Resume game" → clicking it returns to `/play` with the exact same `GameState`. Finishing the game and returning to MainMenu hides the Resume button. Persistence is verified to survive a full PWA relaunch on iOS (Add to Home Screen → close → reopen).

---

## Next 5 steps (continue here, after Step 10 lands)

> These steps build the **networking foundation** (ARCHITECTURE §2 + Phases E–G). They deliberately land in the order *pure protocol → transport → signaling backend → backend wiring → UI lobby*, so each step is reviewable on its own and gameplay stays untouched until Phase G proper. No step in this batch sends a real `ACTION` over the wire — that lands in a later slice once the lobby is stable.

### Step 11 — Net protocol types + ring-buffer logger (pure modules)
1. **Step name:** Define the wire-format and a tiny diagnostic logger, with zero runtime I/O.
2. **Files involved:**
   - `src/net/protocol.ts` *(new)*
   - `src/net/log.ts` *(new)*
   - `src/net/__tests__/protocol.test.ts` *(new)*
3. **What will be implemented:**
   - `protocol.ts` exports a discriminated-union `NetMessage` covering the v1 verbs from ARCHITECTURE §6 (`HELLO`, `ACTION`, `PING`, `PONG`, `BYE`, `RESYNC_REQ`, `RESYNC_RES`) plus shared envelope fields (`seq: number`, `gameId: string`, `senderId: string`, `t: number`).
   - `nextSeq(state)` helper returns a monotonically increasing sequence number per `gameId`; pure function, state passed in.
   - `encode(msg): string` / `decode(raw): NetMessage` thin JSON wrappers that throw `NetProtocolError` on malformed input (validated at the boundary, per copilot rules).
   - `log.ts` exports a ring-buffer logger: `createNetLogger({ capacity = 200 })` returning `{ log(level, tag, data), snapshot(): LogEntry[], clear() }`. No `console` writes, no globals — UI can pull `snapshot()` later for a debug overlay.
   - **No WebRTC, no React, no DOM access.** Both modules are framework-agnostic so a future React Native build reuses them verbatim.
4. **STOP condition:** `npm run type-check`, `npm run lint`, and the new `protocol.test.ts` (round-trip encode→decode for each verb + malformed-input rejection) all pass. No UI or store imports the new files yet.

### Step 12 — WebRTC peer wrapper (manual SDP, no signaling yet)
1. **Step name:** Wrap `RTCPeerConnection` + DataChannel in a typed adapter that we can drive by hand from a temporary debug page before any signaling exists.
2. **Files involved:**
   - `src/net/peer.ts` *(new)*
   - `src/net/__tests__/peer.fake.test.ts` *(new — uses a fake `RTCPeerConnection` shim so the test runs in Node)*
   - `src/app/_debug/peer/page.tsx` *(new — dev-only manual-SDP harness; gated behind `process.env.NODE_ENV !== 'production'`)*
3. **What will be implemented:**
   - `createPeer({ role: 'host' | 'joiner', logger }): Peer` returning `{ createOffer(), acceptOffer(sdp), createAnswer(), acceptAnswer(sdp), addIceCandidate(c), send(msg: NetMessage), on(event, handler), close() }`.
   - Internally owns one `RTCPeerConnection` and one `RTCDataChannel` (`ordered: true`, `negotiated: false`, label `"mojong"`).
   - `send` runs `encode` from Step 11; incoming messages run `decode` and emit `'message'`. Connection state changes emit `'state'` (`'new' | 'connecting' | 'open' | 'closed' | 'failed'`).
   - All ICE candidates are buffered until the remote description is set, to avoid ordering bugs.
   - Debug page renders two textareas (offer/answer SDP) and a send-message form, so a developer can connect two browser tabs by hand and verify a `HELLO` round-trip.
   - **No store wiring, no game traffic.** The peer is a pure transport.
4. **STOP condition:** Two browser tabs at `/_debug/peer`, copy-pasting offer/answer SDP, reach DataChannel state `open` and exchange a `HELLO` message visible in the on-page log. Fake-shim unit test passes in CI.

### Step 13 — Signaling service skeleton (Azure Function, in-memory)
1. **Step name:** Stand up the smallest possible signaling backend that hands out invitation codes and stores SDP/ICE in memory.
2. **Files involved:**
   - `api/host.json` *(new — Azure Functions v4 host config)*
   - `api/package.json` *(new — `@azure/functions` dep, Node 20)*
   - `api/src/sessions/store.ts` *(new — `Map<code, Session>`, `createSession()`, `getSession(code)`, `deleteSession(code)`; pure module with injected clock)*
   - `api/src/functions/createSession.ts` *(new — `POST /api/sessions` → `{ code, hostToken }`)*
   - `api/src/functions/joinSession.ts` *(new — `POST /api/sessions/{code}/join` → `{ joinerToken }` or `404`)*
   - `staticwebapp.config.json` *(touch — ensure `/api/*` is not rewritten to `index.html`)*
3. **What will be implemented:**
   - 6-character invitation codes from an unambiguous alphabet (no `0/O`, `1/I/L`); `createSession` retries on collision.
   - `Session = { code, createdAt, hostToken, joinerToken?, hostSdp?, joinerSdp?, hostIce: [], joinerIce: [] }`.
   - Tokens are opaque random strings used in Step 14 to authorise SDP/ICE writes; no real auth in v1.
   - Sessions live only in process memory — acceptable because Azure Static Web Apps managed Functions are short-lived and a v1 session completes within a few minutes. Persistence comes with Phase J.
   - Unit tests for `createSession` (collision retry) and `joinSession` (404 on unknown code, 409 if already joined).
   - **No SDP/ICE endpoints yet** — that is Step 14.
4. **STOP condition:** `npm --prefix api run build` succeeds; `func start` locally serves both endpoints; `curl POST /api/sessions` returns a code, `curl POST /api/sessions/{code}/join` returns a joiner token, repeating the join returns 409. CI lints `api/`.

### Step 14 — SDP/ICE relay + TTL cleanup, wired to the Step 12 peer
1. **Step name:** Finish the signaling protocol and replace the manual-SDP harness with real handshake calls.
2. **Files involved:**
   - `api/src/functions/exchangeSdp.ts` *(new — `PUT/GET /api/sessions/{code}/sdp/{role}` guarded by token)*
   - `api/src/functions/exchangeIce.ts` *(new — `POST/GET /api/sessions/{code}/ice/{role}` append-and-drain)*
   - `api/src/sessions/cleanup.ts` *(new — sweep sessions older than 10 min on every request; cheap and stateless)*
   - `src/net/signaling.ts` *(new — typed `fetch` client: `createSession()`, `joinSession(code)`, `putSdp(role, sdp)`, `pollSdp(role)`, `postIce(role, c)`, `pollIce(role)`)*
   - `src/net/peer.ts` *(touch — add `connectViaSignaling(client, role)` orchestrator that drives the handshake end-to-end)*
   - `src/app/_debug/peer/page.tsx` *(touch — add a second mode that uses real signaling instead of textareas)*
3. **What will be implemented:**
   - SDP write rejected unless the request's bearer token matches `hostToken` or `joinerToken` for that role.
   - ICE polling uses a simple long-poll with a 5 s timeout (no SignalR/WebSockets in v1 — keeps the Function cold-start trivial).
   - `signaling.ts` is the **only** module in `src/net/` that does `fetch`; everything else stays transport-agnostic.
   - `connectViaSignaling` wires Step 12's `Peer` to Step 14's client: host creates session → puts offer → polls answer → drains ICE; joiner mirrors. Both sides emit `'state: open'` when the DataChannel is up.
   - 10-minute TTL is enforced opportunistically (no timers, no background jobs) — sessions silently 404 once expired.
4. **STOP condition:** Two browser tabs at `/_debug/peer` (real-signaling mode), one clicks "Host", reads a 6-char code, the other types it and clicks "Join" → DataChannel reaches `open` → manual `HELLO` exchange works exactly as in Step 12, but with **no SDP copy-paste**. Local Function logs show the session being created, joined, and SDP/ICE exchanged. Restarting `func start` (wiping memory) before join produces a clear `404`.

### Step 15 — `/network` route: Create / Join lobby (no game wiring yet)
1. **Step name:** Replace the disabled "Network Game" stub with a real lobby that uses Steps 11–14 but does **not** start a game yet.
2. **Files involved:**
   - `src/app/network/page.tsx` *(new — renders `<NetworkLobby />`)*
   - `src/components/NetworkLobby/NetworkLobby.tsx` *(new)*
   - `src/components/NetworkLobby/NetworkLobby.module.css` *(new)*
   - `src/store/netStore.ts` *(new — Zustand store: `{ status, code, role, peerProfile, error }` + actions `host()`, `join(code)`, `leave()`; owns the `Peer` instance via a non-reactive ref)*
   - `src/components/MainMenu/MainMenu.tsx` *(touch — un-stub "Network Game" to navigate to `/network`)*
3. **What will be implemented:**
   - **Create** flow: button → `netStore.host()` → shows the 6-char code in big type with a "Copy" button and a spinner labelled "Waiting for opponent…".
   - **Join** flow: code input (uppercased, trimmed, validated against the Step 13 alphabet) → `netStore.join(code)` → spinner labelled "Connecting…".
   - On DataChannel `'open'`, both sides exchange a single `HELLO` carrying their `Profile` from `useProfileStore`; the lobby then renders both player cards side-by-side and a disabled "Start Game" button with tooltip "Wired in the next step".
   - Errors (`404 unknown code`, `409 session full`, `failed` ICE) surface as inline messages with a "Try again" button that calls `leave()` and resets the store.
   - Leaving the route (`useEffect` cleanup) calls `netStore.leave()` so we never leak a `RTCPeerConnection`.
   - **No `useGameStore.startGame` call yet.** That wiring is the next slice (Phase G-3) and is intentionally out of scope so this PR stays small.
4. **STOP condition:** Two devices (or two browser profiles) on the deployed app: device A opens `/network` → Create → reads code aloud → device B opens `/network` → Join → enters code → both screens show both player cards within ~2 s. Closing either tab releases the peer (verified via Function logs going quiet). `npm run type-check`, `npm run lint`, and all tests green.

---

## Next 5 steps (continue here, after Step 15 lands)

> Step 15 leaves us with a working lobby that exchanges `HELLO` profiles but does not start a game. Steps 16–20 carry the connection through to a fully playable, fault-tolerant networked match. The slicing keeps gameplay code untouched until Step 17, and keeps fault-handling separate from the happy path so each PR is independently reviewable.

> **Hotfix prerequisite (insert before Step 16): Step 15.5 — Persist signaling sessions in Azure Table Storage.** Step 13 stored sessions in process memory. On Azure Static Web Apps managed Functions this is fatal: the host scales to multiple workers and idles out after ~30 s, so a `POST /api/sessions` from device A and the matching `POST /api/sessions/{code}/join` from device B usually land on different workers (or after a cold start) and the second one returns `not_found`. Locally with `func start` everything is one process so the bug is invisible — that's why Step 13's tests passed but production lobbies drop after ~30 s. This step is independent from heartbeat (Step 18), which lives entirely on the open DataChannel and never touches the backend.

### Step 15.5 — Persist signaling sessions in Azure Table Storage
1. **Step name:** Replace the in-memory `defaultStore` with an Azure Table Storage-backed implementation, keeping the `SessionStore` interface and the in-memory store for tests / offline dev.
2. **Files involved:**
   - `api/package.json` *(touch — add `@azure/data-tables` dep)*
   - `api/src/sessions/tableStore.ts` *(new — implements `SessionStore` against `@azure/data-tables`; uses `AzureWebJobsStorage` connection string)*
   - [api/src/sessions/defaultStore.ts](api/src/sessions/defaultStore.ts) *(touch — choose `tableStore` when `AzureWebJobsStorage` is set, otherwise fall back to the existing in-memory store; same singleton export)*
   - [api/src/sessions/cleanup.ts](api/src/sessions/cleanup.ts) *(touch — `pruneExpired` becomes `async` so the table-backed store can issue a bounded query; in-memory store stays synchronous internally and just resolves immediately)*
   - [api/src/sessions/store.ts](api/src/sessions/store.ts) *(touch — make `SessionStore` methods return `Promise<…>`; trivial change since handlers already `await` everything anyway)*
   - [api/src/functions/createSession.ts](api/src/functions/createSession.ts), [api/src/functions/joinSession.ts](api/src/functions/joinSession.ts), [api/src/functions/exchangeSdp.ts](api/src/functions/exchangeSdp.ts), [api/src/functions/exchangeIce.ts](api/src/functions/exchangeIce.ts) *(touch — `await` the now-async store calls)*
   - `api/src/sessions/__tests__/tableStore.test.ts` *(new — unit tests using a fake `TableClient` to cover create/get/update/delete and code-collision retry)*
3. **What will be implemented:**
   - One Table called `mojongSessions`, partition key = single shard `'s'`, row key = the 6-char code. Entity columns map 1:1 to the existing `Session` shape (`createdAt`, `hostToken`, `joinerToken?`, `hostSdp?`, `joinerSdp?`, `hostIce` / `joinerIce` stored as JSON strings to keep schema flat).
   - `tableStore.createSession()` uses `createEntity` with `If-None-Match: *` so collisions return `409` and the existing retry loop in `defaultStore.createSession` keeps working.
   - `pruneExpired` issues `queryEntities({ filter: createdAt lt cutoff })` and deletes in a small batch — opportunistic, called from each handler exactly as today.
   - **Local dev:** `func start` reads `AzureWebJobsStorage` from `local.settings.json`. We support `UseDevelopmentStorage=true` (Azurite) and a clear "missing → in-memory" fallback so offline dev keeps working without Azurite installed. CI tests use the in-memory store.
   - **Deployed:** SWA managed Functions already inject a real `AzureWebJobsStorage` connection string, so no extra Azure config is needed beyond creating the storage account and granting the Function its existing managed identity (or just using the connection string).
4. **STOP condition:** Two devices on the deployed app: device A creates a code on a phone PWA, waits 60 s (well past the cold-start window), device B joins from a different network → `joinSession` succeeds and the lobby connects. Restarting `func start` locally with `AzureWebJobsStorage=UseDevelopmentStorage=true` preserves sessions across restarts; with the env var unset, the existing in-memory behaviour is unchanged. `npm --prefix api run build`, `npm --prefix api test`, and `npm run type-check` all pass.

---

### Step 16 — Host-authoritative game start over the wire
1. **Step name:** Lobby's "Start Game" actually starts a synchronised game on both peers.
2. **Files involved:**
   - [src/net/protocol.ts](src/net/protocol.ts) *(touch — add `START` verb carrying `options`, `profiles: [Profile, Profile]`, `hostPlayerIndex: 0|1`; bump `PROTOCOL_VERSION` only if a shape changes)*
   - [src/net/__tests__/protocol.test.ts](src/net/__tests__/protocol.test.ts) *(touch — add round-trip + malformed-input cases for `START`)*
   - [src/store/netStore.ts](src/store/netStore.ts) *(touch — add `localPlayerIndex: 0|1|null`, `mode: 'host'|'join'|null`; new `startNetworkGame()` action on host; on joiner, route incoming `START` to `useGameStore.startGame` and navigate to `/play`)*
   - [src/components/NetworkLobby/NetworkLobby.tsx](src/components/NetworkLobby/NetworkLobby.tsx) *(touch — un-stub "Start Game" on host once `status === 'connected'`; reads `useSettingsStore` + both `Profile`s)*
   - [src/store/gameStore.ts](src/store/gameStore.ts) *(touch — `startGame` already accepts `{options, profiles}`; add an optional `seed?: string` field carried in `START` so future RNG (e.g. wall placement variants) is identical on both sides)*
3. **What will be implemented:**
   - Host is the source of truth for game configuration. On click it: builds the initial `GameState`, sends `START`, then calls `startGame` locally and `router.push('/play')`.
   - Joiner waits for `START`, applies the same inputs, and navigates. Both peers reach `/play` with byte-identical `GameState` (verified by a debug `JSON.stringify` log in dev only).
   - Player → device mapping is decided by host: host is `player1` (index 0) by default in v1; we can flip later. `netStore.localPlayerIndex` is the only place that knows which side this device controls.
   - **No move broadcasting yet** — Step 17 wires that. This step proves the synchronised start.
4. **STOP condition:** Two browser tabs hosted via `npm run dev`: A hosts → B joins → A clicks Start → both tabs land on `/play` showing the same board, names, colors, and current-player highlight. Closing either tab returns the other to a clean lobby state. `npm run type-check`, `npm run lint`, tests green.

### Step 17 — Broadcast & apply `ACTION` (Phase G-3 core)
1. **Step name:** Each `executeAction` round-trips through the DataChannel so both boards stay in lockstep.
2. **Files involved:**
   - [src/store/gameStore.ts](src/store/gameStore.ts) *(touch — add `mode: 'local'|'network'` and an in-memory `actionLog: { seq, turnNumber, action }[]`; `executeAction` becomes `executeAction(action, { source: 'local'|'remote' })`)*
   - [src/store/netStore.ts](src/store/netStore.ts) *(touch — register a peer `'message'` handler that filters `ACTION` and forwards to `useGameStore.applyRemoteAction`)*
   - [src/components/Board/Board.tsx](src/components/Board/Board.tsx) and [src/components/PlayerPanel/PlayerPanel.tsx](src/components/PlayerPanel/PlayerPanel.tsx) *(touch — disable interactions when `mode === 'network'` and `currentPlayer !== localPlayerIndex`)*
   - `src/store/__tests__/gameStore.network.test.ts` *(new — drive a fake peer through a 4-move exchange; assert both stores converge)*
3. **What will be implemented:**
   - Local-origin actions: apply → append to `actionLog` → `peer.send({ type: 'ACTION', action, turnNumber })`.
   - Remote-origin actions: validate `senderId === opponentId`, `seq === expected`, `turnNumber === state.turnNumber`. On any mismatch, log to the ring buffer and **do not** apply (real recovery lands in Step 20).
   - The reducer path is unchanged — only the entry point splits by `source`. This keeps the existing rules engine and tests untouched.
   - UI hint: when it is the remote player's turn, show a subtle "Opponent's turn" banner (single span, no new component).
4. **STOP condition:** Two tabs play a full game end-to-end with every move appearing on both boards within ~100 ms on localhost. Trying to click on the board on the wrong-turn side does nothing. Game-end (win/draw) fires on both sides simultaneously.

### Step 18 — Heartbeat + connection-quality indicator (H-1)
1. **Step name:** Continuous PING/PONG so the UI can show real connection health.
2. **Files involved:**
   - [src/store/netStore.ts](src/store/netStore.ts) *(touch — add `quality: 'good'|'slow'|'unstable'|null`, `lastRttMs: number|null`, `lastSeenAt: number|null`; start a 5 s interval on `'open'`, clear on `leave`)*
   - [src/net/peer.ts](src/net/peer.ts) *(touch — convenience `sendPing()` that stamps `seq` and resolves the matching `PONG`)*
   - [src/components/GameCanvas/GameCanvas.tsx](src/components/GameCanvas/GameCanvas.tsx) *(touch — render a small connection pill from `useNetStore` when `mode === 'network'`)*
3. **What will be implemented:**
   - Sliding RTT window of the last 5 PONGs, mean RTT drives the pill: `< 150 ms` good (green), `< 400 ms` slow (amber), else unstable (red).
   - 15 s without a PONG → `unstable`; 30 s → trigger Step 19's reconnect flow (signal exposed as a store event, no UI from this step).
   - All timers cleaned up in `leave()` and on `beforeunload` so no leaks.
4. **STOP condition:** With two tabs connected, the pill shows green and a number around 1–10 ms locally. Throttling DevTools network to "Slow 3G" turns it amber; killing the peer tab turns it red within 30 s. Tests: a fake-clock unit test confirms the threshold transitions.

### Step 19 — Reconnect overlay + grace timer + claim-win (H-2 + H-3)
1. **Step name:** Fault-handling UI so a flaky network or a closed tab doesn't strand the game.
2. **Files involved:**
   - [src/store/netStore.ts](src/store/netStore.ts) *(touch — persist `{ code, role, hostToken|joinerToken }` to `STORAGE_KEYS.netSession` so a refresh can re-attach; add `attemptReconnect()` that re-runs `connectViaSignaling` if the session is still alive)*
   - [src/persistence/keys.ts](src/persistence/keys.ts) *(touch — `netSession: 'mojong.net.v1'`)*
   - `src/components/Network/ReconnectOverlay.tsx` *(new — full-screen modal with countdown and "Claim win" button; pure presentational)*
   - [src/components/GameCanvas/GameCanvas.tsx](src/components/GameCanvas/GameCanvas.tsx) *(touch — mount the overlay when `quality === 'unstable'` for >X s)*
   - [src/store/gameStore.ts](src/store/gameStore.ts) *(touch — `claimWin(reason: 'forfeit'|'timeout')` ends the game with the local player as winner)*
3. **What will be implemented:**
   - On `'closed' | 'failed'` or `unstable` for 30 s: show overlay with a 60 s countdown.
   - Auto-reconnect runs in the background: `attemptReconnect()` re-uses the persisted session record (signaling sessions still live within their 10-min TTL from Step 14).
   - If reconnection succeeds before the timer expires, both peers send a `RESYNC_REQ` (consumed in Step 20 — for now they no-op gracefully) and the overlay closes.
   - After the grace period: "Claim win" enabled → calls `claimWin('timeout')` and sends `BYE { reason: 'timeout' }`.
   - Manual forfeit ("Resign" button on the overlay too) sends `BYE { reason: 'forfeit' }` and ends the game with the opponent as winner.
4. **STOP condition:** With two tabs mid-game, closing tab B for 10 s then reopening it auto-reconnects without user action; closing for 60+ s lets tab A claim a win and returns both to MainMenu cleanly. No orphan `RTCPeerConnection` instances after the flow (verified via `chrome://webrtc-internals`).

### Step 20 — `RESYNC_REQ` / `RESYNC_RES` to recover missed actions
1. **Step name:** A reconnected peer catches up via the action log instead of resyncing the whole `GameState`.
2. **Files involved:**
   - [src/store/gameStore.ts](src/store/gameStore.ts) *(touch — expose `getActionsSince(seq): { seq, action, turnNumber }[]` reading the in-memory `actionLog` from Step 17)*
   - [src/store/netStore.ts](src/store/netStore.ts) *(touch — handle incoming `RESYNC_REQ` by sending `RESYNC_RES`; handle incoming `RESYNC_RES` by feeding actions to `applyRemoteAction` in order)*
   - `src/store/__tests__/gameStore.resync.test.ts` *(new — simulate a 3-action gap; assert convergence after resync)*
3. **What will be implemented:**
   - On any `seq` gap detected in Step 17's validator, the receiver sends `RESYNC_REQ { fromSeq: expectedSeq }` (rate-limited to once per 2 s).
   - Sender replies with the slice of its `actionLog` from `fromSeq` onwards. Empty slice = "you're caught up".
   - The receiver applies the slice in order through the same `applyRemoteAction` path; the validator now tolerates a contiguous batch.
   - Bound the log: trim entries older than the last 200 turns to keep memory flat (a real game is far shorter; this is just paranoia).
4. **STOP condition:** Programmatically dropping every other outgoing `ACTION` from tab A for 5 s (toggleable dev-only switch in the ring-buffer logger UI, optional) results in tab B catching up automatically once the drop stops. Unit test green; no regressions in Step 17's lockstep test.

---

## Subsequent phases (for context only — not the next 5 steps)

These are listed so reviewers see the shape of the work. They are **not** approved yet and will be sliced into their own small steps when their turn comes. Order is suggested, not contractual.

**Phase B — Settings screen wiring**
- B-1 `Settings` route + form for `againstView`, `timer`, `difficulty`, `boardSizeId`, `walls`.
- B-2 Save/Cancel semantics; cancel restores via `useSettingsStore` snapshot.
- B-3 MainMenu's Start button reads `useSettingsStore` instead of hard-coded level.

**Phase C — Walls + difficulty in domain**
- C-1 `walls: Position[]` on `GameState`; deterministic placement helper.
- C-2 `getValidMoves` / `getValidPlacements` honour walls (per Q-002 confirmation).
- C-3 Board renders walls as a distinct cell type.
- C-4 `Difficulty` → piece roster mapping replaces `Level.allowedFigures`.

**Phase D — In-progress game persistence**
- D-1 Snapshot `GameState` to local storage on each `executeAction`.
- D-2 "Resume game" banner on MainMenu.

**Phase E — Net adapter scaffolding (offline-friendly)**
- E-1 `src/net/protocol.ts` — message types and `seq` helpers.
- E-2 `src/net/peer.ts` — WebRTC DataChannel wrapper, no signaling yet.
- E-3 `src/net/log.ts` — ring-buffer logger.

**Phase F — Signaling service**
- F-1 Azure Function project skeleton, in-memory session map, code generation.
- F-2 SDP/ICE relay endpoints.
- F-3 TTL + cleanup.

**Phase G — Network Game UI**
- G-1 `/network` route with Create / Join modes.
- G-2 Lobby screen showing connected peer profile.
- G-3 Wire `useGameStore.executeAction` to broadcast `ACTION` when online.

**Phase H — Disconnect / rejoin**
- H-1 PING/PONG heartbeat.
- H-2 Reconnect overlay + grace timer.
- H-3 Forfeit / claim-win flow per ARCHITECTURE §6.5.

**Phase I — Polish**
- I-1 Tutorial static page.
- I-2 Delete old [GameSetup](src/components/GameSetup/GameSetup.tsx).
- I-3 Icon set finalisation, splash screens, theme polish.

**Phase J — Cloud sync for profile + settings (per ARCHITECTURE §5.5 / D-009)**
- J-1 `src/sync/syncClient.ts` — `pull(kind)`, `push(kind, envelope)`, `reconcile(kind)` implementing last-write-wins by `updatedAt`. Pure logic; backend client injected.
- J-2 `src/sync/httpClient.ts` — fetch wrapper for `GET/PUT /sync/:userId/:kind`, with debounce (1 s) and online/offline awareness.
- J-3 Wire `useProfileStore` and `useSettingsStore` to the sync client via a single Zustand `subscribe` listener — no store internals change.
- J-4 Backend: Azure Static Web Apps managed Function `api/sync/{userId}/{kind}` backed by Azure Table Storage. LWW enforced server-side; `409` on stale `PUT`.
- J-5 Reconcile on app start and on `online` event; surface a tiny "Synced · just now" indicator in Settings.

**Phase K — Auth (optional, unlocks real cross-device sync)**
- K-1 Add a Static Web Apps auth provider (Apple / Google) and exchange the session for a stable `userId`.
- K-2 One-shot migration: copy blobs from the old anonymous `userId` to the new authenticated one on first sign-in.

---

## Definition of done (every step)

A step is only complete when **all** of these are true:

1. `npm run type-check` passes.
2. `npm run lint` passes.
3. The STOP condition stated in the step has been verified manually or by test.
4. No regressions in the existing single-device 2-player game flow.
5. Any new public function has a one-line purpose comment per the project's learning-first convention.
