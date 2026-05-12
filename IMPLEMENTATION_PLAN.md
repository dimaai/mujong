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

#### Step 19 — actually shipped (commit `19d3252`, scoped down)
What landed deviates from the plan above. Capturing the delta so a future contributor knows what's already in `main` and what's deferred:

- **Shipped (scoped Step 19):**
  - `connectionLost: boolean` + `connectionLostAt: number | null` on [src/store/netStore.ts](src/store/netStore.ts).
  - The `peer.on('state')` handler no longer instantly forfeits on `'closed'` / `'failed'` mid-game — it sets `connectionLost = true` and leaves the user in control.
  - Two new netStore actions: `claimWin()` (local wins, sends `BYE { reason: 'timeout' }`) and `resign()` (local loses, sends `BYE { reason: 'forfeit' }`). They use a module-level `pendingByeReason: ByeReason | null` so the existing phase-change subscriber emits the right BYE verb instead of the default `'normal'`.
  - Inbound BYE handler now branches on `reason`: `'timeout'` from the peer means *we* lose (peer claim-won us); everything else still treats it as the peer leaving and we win via `handleRemoteAbort`.
  - New presentational [src/components/Network/ReconnectOverlay.tsx](src/components/Network/ReconnectOverlay.tsx) — 60 s countdown, "Claim win" disabled until 0, "Resign" always available. Mounted in [src/components/GameCanvas/GameCanvas.tsx](src/components/GameCanvas/GameCanvas.tsx) when `isNetwork && connectionLost && phase === 'playing' && connectionLostAt != null`.
  - `STORAGE_KEYS.netSession = "mojong.netSession.v1"` registered in [src/persistence/keys.ts](src/persistence/keys.ts) but **not yet read or written**. Reserved for Step 19.5.
  - Fix shipped in `ba09e30`: [src/store/gameStore.ts](src/store/gameStore.ts) `flushSnapshot()` now skips writes when `mode === 'network'`, and `startGame()` deletes any leftover snapshot when entering network mode. This was a follow-up after closing P1's tab caused the game to be resumed as a *local* game on reload (because the Step 10 snapshot doesn't persist `mode` / `localPlayerIndex`).

- **Deferred to Step 19.5 (see below):**
  - `attemptReconnect()` — re-running the signaling handshake on a tab reload or peer-state recovery.
  - `STORAGE_KEYS.netSession` actually being written on connect / cleared on game end.
  - Auto-reconnect within the 60 s grace window (currently the overlay just waits — there is no recovery path; the user must Claim Win or Resign once the timer ends).

### Step 19.5 — Auto-reconnect (signaling re-attach + session persistence)
1. **Step name:** Make a reloaded or briefly-disconnected peer rejoin its existing session without user intervention.
2. **Files involved:**
   - [src/store/netStore.ts](src/store/netStore.ts) *(touch)* — write the netSession envelope on every successful `host()` / `join()`; clear it from `endNetworkSession()` and `teardown()`. Add `attemptReconnect()` that:
     1. reads the envelope,
     2. checks the server (via signaling) that the session still exists and we still hold a valid token,
     3. re-creates `currentPeer`, runs `connectViaSignaling(peer, client, role, …)` with our existing token, and
     4. on success sends a single `HELLO` (so `expectedRemoteSeq` resets cleanly), then a `RESYNC_REQ` (Step 20 consumes it).
   - [src/net/signaling.ts](src/net/signaling.ts) *(touch)* — extend the typed client with `reattach(code, role, token)` that returns the existing session metadata (peer's most-recent SDP, drained ICE candidates, current `expectedRemoteSeq` if we choose to track it server-side). The current client only handles initial create/join — it has no read-after-handshake mode.
   - [api/src/functions/exchangeSdp.ts](api/src/functions/exchangeSdp.ts), [api/src/functions/exchangeIce.ts](api/src/functions/exchangeIce.ts), [api/src/sessions/store.ts](api/src/sessions/store.ts) *(touch)* — must permit a second SDP exchange under the same token (today they assume single-use). Add a `renegotiationCount: number` on the session row so server-side TTL extension can be bounded (e.g. max 3 reconnects per session).
   - [api/src/sessions/__tests__/store.test.ts](api/src/sessions/__tests__/store.test.ts) *(touch)* + new `tableStore.reattach.test.ts`.
   - [src/components/Network/ReconnectOverlay.tsx](src/components/Network/ReconnectOverlay.tsx) *(touch)* — surface "Reconnecting…" state when an `attemptReconnect()` is in flight; on success the overlay hides itself.
   - [src/store/netStore.ts](src/store/netStore.ts) *(touch)* — call `attemptReconnect()` automatically on (a) module init if `STORAGE_KEYS.netSession` exists and `gameStarted` is implied by the snapshot, and (b) every 5 s while `connectionLost === true`, until the grace timer expires.
3. **What will be implemented:**
   - **Persistence record shape:** `{ code: string; role: 'host' | 'join'; ownToken: string; gameId: string; localPlayerIndex: 0 | 1; savedAt: number }`. Stored under the existing `STORAGE_KEYS.netSession` key using the same `Persisted<T>` envelope as everything else.
   - **Signaling re-attach contract:** `POST /api/sessions/{code}/reattach` with `Authorization: Bearer <ownToken>` returns `{ peerSdp, peerIce: [], peerSenderId, sessionAgeMs }` or `404`/`410` if the session is gone or expired. The server stores the *latest* peer SDP/ICE rather than draining on read so a re-attaching client can pick them up.
   - **Why a separate endpoint?** Today's `joinSession` is single-use (sets `joinerToken`). A second call on the same code would conflict. `reattach` is idempotent and token-gated: only the holder of the token issued at create/join time can re-fetch.
   - **Client-side flow:**
     1. App boot ([src/app/play/page.tsx](src/app/play/page.tsx) or a top-level effect): if `STORAGE_KEYS.netSession` is present AND a network-mode `GameState` snapshot is also present (we'll need to *do* persist network snapshots — see "open question" below), restore both stores and call `attemptReconnect()`.
     2. Mid-game disconnect: the existing `peer.on('state')` handler that flips `connectionLost = true` also kicks off the periodic `attemptReconnect()` loop.
     3. On reconnect success: send `HELLO` to confirm identity, then `RESYNC_REQ { fromSeq: expectedRemoteSeq }`. Consume the `RESYNC_RES` in Step 20.
   - **State-machine cleanup:** the existing `connectionLost` / `connectionLostAt` fields stay; add `reconnecting: boolean` so the overlay can show "Reconnecting…" instead of "Waiting…". On reconnect success: clear all three and resume the heartbeat.
   - **Open question — should we persist the network `GameState` snapshot?** The fix in `ba09e30` deliberately blocks this because today there's no recovery path. Step 19.5 needs to either (a) lift that block once auto-reconnect is in place, or (b) keep the snapshot blocked and rely on Step 20's `RESYNC_RES` to rebuild the in-memory game from the server-stored peer state (much harder — the server doesn't store game actions, only signaling). Decision: **persist the network snapshot under a separate `STORAGE_KEYS.netGameSnapshot` key** so the local-game snapshot path stays untouched. Only the network snapshot is restored when `attemptReconnect()` succeeds; if reconnect fails, the snapshot is dropped along with the netSession record.
4. **STOP condition:**
   - Two tabs in a network game; close tab B → tab A's overlay shows "Reconnecting…" → reopen `localhost:3000` in tab B → tab B auto-rejoins, both screens converge to the same state via Step 20's resync, and the overlay disappears.
   - Tab B reload (Cmd-R / Ctrl-R) without closing: same auto-reconnect path; tab A may not even notice the blip.
   - With tab B closed beyond the 10-min server TTL, the `reattach` call returns 410, the persistence record is cleared, and the user lands on MainMenu cleanly with no Resume option.
   - Unit tests: `signaling.reattach.test.ts` covers token-gated success, wrong-token 401, unknown-code 404, expired-session 410.
   - No orphan `RTCPeerConnection` instances after a successful reconnect (verified via `chrome://webrtc-internals`).

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
   - **Note on existing wiring:** `RESYNC_REQ` and `RESYNC_RES` are already in the `NetMessage` union from Step 11 and round-trip in [src/net/__tests__/protocol.test.ts](src/net/__tests__/protocol.test.ts). The current netStore message handler does **not** have a case for them — it falls through to no-op. Step 20 just adds the two `if (msg.type === 'RESYNC_REQ' …)` branches and the `getActionsSince` exporter; no protocol changes.
   - **Coupling to Step 19.5:** Step 20 is independently useful (handles seq gaps caused by transient drops within an open channel) but only delivers full disconnect-recovery when Step 19.5's auto-reconnect fires the `RESYNC_REQ` immediately after re-establishing the channel. Land 19.5 first, then 20 against it.
4. **STOP condition:** Programmatically dropping every other outgoing `ACTION` from tab A for 5 s (toggleable dev-only switch in the ring-buffer logger UI, optional) results in tab B catching up automatically once the drop stops. Unit test green; no regressions in Step 17's lockstep test.

---

## Next 5 steps (continue here, after Step 20 lands)

> Step 20 closes out the networking happy path: lockstep play, auto-reconnect, and missed-action recovery all work. What remains is (1) one outstanding gameplay gap — the `timerMinutes` setting is shown in `/settings` but not enforced anywhere — and (2) the polish + cloud-sync phases listed below. This batch lands the timer first (smallest user-facing bug), then the two polish items that unblock deleting dead code, then opens the cloud-sync foundation in two reviewable slices.
>
> The two cloud-sync steps (24 + 25) are deliberately *frontend-only*: pure LWW reconciliation logic, then a typed HTTP client wired to the existing stores against a *mock* server. The real Azure Function (Phase J-4) lands as Step 26 in the following batch so each PR stays under the ~150 LOC / ~2-file guideline.

### Step 21 — Per-player game clock (enforce `timerMinutes`)
1. **Step name:** Make the timer setting actually count down and end the game on flag-fall.
2. **Files involved:**
   - [src/domain/types.ts](src/domain/types.ts) *(touch — add `clocks: { p1RemainingMs: number; p2RemainingMs: number; lastTickAt: number | null } | null` to `GameState`; `null` means "timer disabled")*
   - [src/domain/board.ts](src/domain/board.ts) *(touch — `createInitialState` seeds `clocks` from `options.timerMinutes`; new pure helper `tickClock(state, now): GameState` that subtracts elapsed wall-time from the current player's clock and flips `phase` to `'finished'` with `winner = otherPlayer` on flag-fall)*
   - [src/domain/rules.ts](src/domain/rules.ts) *(touch — reducer charges the *current* player's clock between `lastTickAt` and `now` on every action; resets `lastTickAt` to `now` after the turn flips)*
   - [src/store/gameStore.ts](src/store/gameStore.ts) *(touch — a single `setInterval(250 ms)` driver that calls `tickClock` while `phase === 'playing'` and `clocks !== null`; cleared on `endGame` / mode change. **Not** persisted into the snapshot — on resume we set `lastTickAt = Date.now()` so the resumed turn starts fresh)*
   - [src/components/PlayerPanel/PlayerPanel.tsx](src/components/PlayerPanel/PlayerPanel.tsx) *(touch — render `mm:ss` from each player's clock; turn red below 30 s; pulse on the active player)*
   - `src/domain/__tests__/clocks.test.ts` *(new — table-driven: tick after 10 s subtracts 10 s from the current player only; flag-fall sets `winner`; disabled timer is a no-op)*
3. **What will be implemented:**
   - **Pure-domain clocks.** All time math lives in [src/domain/board.ts](src/domain/board.ts) so the rules engine stays deterministic and Node-testable (no `Date.now()` inside the reducer; `now` is passed in).
   - **Single source of truth: gameStore.** Only the store calls `Date.now()` and only the store schedules the 250 ms interval. UI components read `clocks` reactively; they never set their own intervals.
   - **Network mode:** the clock is driven *locally* on each peer from `state.clocks.lastTickAt`. Both peers tick from the same `lastTickAt` (it's part of `GameState` and ships in `START` + every `ACTION` echo), so clocks stay within one network RTT of each other. On flag-fall, whichever peer notices first sends a normal `ACTION` of type `'TIMEOUT'` (new variant) — Step 17's lockstep keeps the other side in agreement.
   - **Resume / snapshot:** the local snapshot (Step 10) stores `clocks` but `lastTickAt` is reset to `Date.now()` on hydrate. Rationale: we can't trust wall-clock deltas across a pause-to-tomorrow gap, and the alternative (deducting the gap) would let players "pause" the timer by closing the tab.
   - **Display-only when disabled.** If `options.timerMinutes === 0`, `state.clocks === null` and `PlayerPanel` renders no clock at all — same as today.
4. **STOP condition:** Set timer to 1 minute in `/settings`, start a single-device game, let player 1's clock run out without moving → game ends with player 2 as winner; player 1's panel shows `00:00`. Network mode: same scenario across two tabs, both screens transition to the win state within ~250 ms. `npm run type-check`, `npm run lint`, and the new `clocks.test.ts` pass; existing tests stay green (timer-off paths are unchanged).

### Step 22 — Tutorial route (Phase I-1)
1. **Step name:** Make the disabled "Tutorial" button on MainMenu lead to a real explainer page.
2. **Files involved:**
   - `src/app/tutorial/page.tsx` *(new — server component, no client JS needed)*
   - `src/components/Tutorial/Tutorial.tsx` *(new — pure presentational)*
   - `src/components/Tutorial/Tutorial.module.css` *(new)*
   - [src/components/MainMenu/MainMenu.tsx](src/components/MainMenu/MainMenu.tsx) *(touch — un-stub the "Tutorial" button to `router.push('/tutorial')`)*
   - `public/images/tutorial/` *(new — small static images of each piece on a board square; reuse existing figure SVGs where possible to avoid new asset churn)*
3. **What will be implemented:**
   - Single-page scrolling layout with sections: **Goal**, **Setup**, **Pieces** (one row per figure with name, icon, movement summary pulled from [src/data/figuretypes.ts](src/data/figuretypes.ts) — no duplication), **Turn structure** (place vs. move), **Walls** (if enabled in settings), **Winning** (capture all opponents' "king" equivalent — confirm exact win condition from [src/domain/rules.ts](src/domain/rules.ts)).
   - "Back to menu" button at top and bottom; uses `router.back()` if the referrer is `/`, otherwise `router.push('/')`.
   - **No interactive board** in v1. A future step can add a clickable mini-board, but that's a separate slice — keeping this step under ~150 LOC means text + static figure icons only.
   - Content is keyed off the same data files the game uses, so future rule changes are reflected automatically without editing tutorial copy.
4. **STOP condition:** MainMenu → Tutorial → page renders with all pieces and rules; back navigation returns to MainMenu. Page loads with zero client-side hydration warnings (verified in DevTools). `npm run type-check` and `npm run lint` pass.

### Step 23 — Remove legacy `GameSetup` and deprecated `levels.ts`
1. **Step name:** Delete the dead code Step 5 promised to clean up "in a follow-up".
2. **Files involved:**
   - [src/components/GameSetup/GameSetup.tsx](src/components/GameSetup/GameSetup.tsx) *(delete)*
   - [src/components/GameSetup/GameSetup.module.css](src/components/GameSetup/GameSetup.module.css) *(delete)*
   - [src/data/levels.ts](src/data/levels.ts) *(delete — the only remaining production reference is the Step 3 one-time migration; if that migration has already shipped to all users in `mojong.settings.v1`, delete the migration block too; otherwise keep the migration but inline the three `Level` shapes as local constants and drop the module)*
   - [src/store/settingsStore.ts](src/store/settingsStore.ts) *(touch — if the migration is inlined or removed, update imports accordingly)*
   - `src/components/GameSetup/__tests__/*` *(delete any stale tests)*
   - `grep` audit: confirm zero remaining imports of `GameSetup` or `Level` outside the migration.
3. **What will be implemented:**
   - Pure deletion. No new logic. No behaviour change.
   - **Decision on the migration:** keep it for one more release if there's any concern about returning users with `selectedLevelId` still in storage. Bias toward inlining the three `Level` constants so [src/data/levels.ts](src/data/levels.ts) can go away — the file is the only blocker to a clean `src/data/` tree.
   - Update [ARCHITECTURE.md](ARCHITECTURE.md) §"Migration" lines mentioning `GameSetup` to past-tense and add a note that the migration has shipped.
4. **STOP condition:** `npm run type-check`, `npm run lint`, and the full test suite pass. `grep -r GameSetup src/` and `grep -r 'data/levels' src/` return zero hits (outside the migration's inline copy, if kept). `npm run build` succeeds with no orphaned-module warnings. Bundle size goes down (capture before/after in the PR).

### Step 24 — Sync client core: LWW reconciliation (pure module, no I/O)
1. **Step name:** Pure module that decides who wins when local and remote `Persisted<T>` envelopes disagree.
2. **Files involved:**
   - `src/sync/types.ts` *(new — `SyncKind = 'profile' | 'settings'`; re-export `Persisted<T>` from [src/persistence/storage.ts](src/persistence/storage.ts))*
   - `src/sync/reconcile.ts` *(new — `reconcile<T>(local: Persisted<T> | null, remote: Persisted<T> | null): { winner: 'local' | 'remote' | 'tie'; merged: Persisted<T> | null }`)*
   - `src/sync/__tests__/reconcile.test.ts` *(new — table-driven cases)*
3. **What will be implemented:**
   - **Last-write-wins by `updatedAt`.** Tie-break by `deviceId` lexicographically so two devices that wrote at the exact same ms still converge deterministically.
   - **Schema-version guard.** If `local.v !== remote.v`, the higher `v` wins regardless of `updatedAt` — that's the "I just upgraded the app" case.
   - **Null handling.** `null + null → null`; `null + remote → remote` (and vice-versa). No mutation; always returns a new envelope.
   - **No network, no storage.** This module is the kernel that Step 25's HTTP wrapper and a future React Native build both consume verbatim. Per copilot rules, keep shared logic framework-agnostic.
   - Test matrix: local newer, remote newer, exact tie + deviceId tie-break, schema-version mismatch each direction, both-null, one-null × 2.
4. **STOP condition:** All cases in `reconcile.test.ts` green. `npm run type-check` and `npm run lint` pass. Zero imports into `useProfileStore` / `useSettingsStore` yet — this is a pure module landed in isolation.

### Step 25 — Sync HTTP client + wire `useProfileStore` and `useSettingsStore`
1. **Step name:** Pull on app start, push on store change (debounced 1 s), reconcile via Step 24.
2. **Files involved:**
   - `src/sync/httpClient.ts` *(new — `createSyncClient({ baseUrl, userId, fetch }): SyncClient` with `pull(kind)`, `push(kind, envelope)`; throws `SyncStaleError` on `409`, `SyncOfflineError` on network failure)*
   - `src/sync/syncStore.ts` *(new — Zustand store: `{ status: 'idle' | 'syncing' | 'error' | 'offline'; lastSyncedAt: number | null }`; one action per kind)*
   - `src/sync/wire.ts` *(new — `installSyncListeners()`: subscribes to `useProfileStore` and `useSettingsStore`, debounces 1 s, and pipes through the client; called once from a top-level effect)*
   - [src/app/layout.tsx](src/app/layout.tsx) *(touch — a tiny client component mounts `installSyncListeners()` once and re-runs on `online` event)*
   - [src/components/Settings/Settings.tsx](src/components/Settings/Settings.tsx) *(touch — render a minimal "Synced · 5s ago" / "Offline" indicator reading `useSyncStore`)*
   - `src/sync/__tests__/httpClient.test.ts` *(new — fetch is mocked; covers 200/409/network-failure)*
   - `src/sync/__tests__/wire.test.ts` *(new — fake stores, fake client; assert debounce + pull-on-mount + reconcile-on-conflict)*
3. **What will be implemented:**
   - **Wire contract:** `GET /api/sync/{userId}/{kind}` returns `Persisted<T> | null`; `PUT /api/sync/{userId}/{kind}` accepts a `Persisted<T>`, returns `200` on accept or `409 { current: Persisted<T> }` if the server has a newer `updatedAt`. Client handles `409` by feeding `current` into `reconcile` from Step 24 and re-`PUT`-ing the winner. Bounded to 3 attempts before surfacing `SyncStaleError`.
   - **Debounce.** A single `setTimeout(1000)` per kind, cancelled by subsequent writes; flushes immediately on `beforeunload`.
   - **Online/offline.** `navigator.onLine === false` short-circuits to `SyncOfflineError` and flips `syncStore.status = 'offline'`; on `online` event, a one-shot `pull(kind)` per kind re-runs to recover any divergence.
   - **userId.** Pulled from `getUserId()` (Step 1). For v1 it equals `deviceId` so two devices have *different* userIds and don't sync with each other — that's intentional. Cross-device sync would require authentication, which is explicitly deferred (see optional Phase Z at the bottom of this document).
   - **The backend Function does not exist yet.** Step 25 ships against a Vite-only mock in tests + a `process.env.NEXT_PUBLIC_SYNC_BASE_URL` toggle so the real call can be disabled until Step 26 lands the server. Default in production: feature flag off.
4. **STOP condition:** With the feature flag on and a mock `/api/sync/*` returning `null` (i.e. empty server): changing a name in MainMenu causes a `PUT` within ~1 s, visible in DevTools Network. Pre-seeding the mock with a newer envelope then reloading the page hydrates `useProfileStore` from the server. Killing the network → indicator flips to "Offline"; re-enabling triggers a `pull`. All new unit tests pass; existing stores' behaviour is unchanged when the feature flag is off.

### Step 26 — Sync backend Function: `/api/sync/{userId}/{kind}`
1. **Step name:** Server side of Phase J. Azure Static Web Apps managed Function backed by Azure Table Storage, mirroring the patterns already in [api/src/sessions/tableStore.ts](api/src/sessions/tableStore.ts).
2. **Files involved:**
   - `api/src/functions/syncGet.ts` *(new — HTTP-triggered `GET /sync/{userId}/{kind}`)*
   - `api/src/functions/syncPut.ts` *(new — HTTP-triggered `PUT /sync/{userId}/{kind}`)*
   - `api/src/sync/store.ts` *(new — `SyncStore` interface: `read(userId, kind)`, `write(userId, kind, envelope)`; pure, no Azure imports)*
   - `api/src/sync/tableStore.ts` *(new — Azure Table-backed implementation; one table `mojongSync`, `PartitionKey = userId`, `RowKey = kind`, body stored as JSON column + `updatedAt` numeric column for the server-side LWW check)*
   - `api/src/sync/defaultStore.ts` *(new — singleton chooser, in-memory in tests / locally, table-backed in production — same shape as `sessions/defaultStore.ts`)*
   - `api/src/sync/__tests__/store.test.ts` *(new — table-driven: read-empty, write-then-read, stale-PUT returns conflict, schema-version guard mirrors client kernel)*
   - [staticwebapp.config.json](staticwebapp.config.json) *(touch — only if SWA needs an explicit route for the new endpoints; usually `/api/*` blanket-routes already cover them)*
3. **What will be implemented:**
   - **Wire contract** matches Step 25 exactly: `GET` returns `Persisted<unknown> | null` (or `404` → client treats as null); `PUT` accepts a `Persisted<unknown>` body. Server compares `body.updatedAt` against the row's current `updatedAt`:
     - body strictly newer → write, return `200`.
     - body strictly older → no write, return `409 { current: <stored envelope> }`.
     - tie → tie-break by `deviceId` lexicographically (same rule as the client kernel) so two devices that write at the exact same ms still converge.
     - schema-version mismatch → the higher `v` always wins, regardless of `updatedAt` — exactly as the kernel does.
   - **Authentication** is intentionally *out of scope* and stays that way for v1: the API trusts the `userId` path segment because `userId === deviceId`. Cross-device sync is deferred (see optional Phase Z); this is **not** a temporary gap. We add a short comment in `syncGet.ts` / `syncPut.ts` marking the trust boundary so a future contributor doesn't bolt on identity without re-reading Phase Z first.
   - **Validation at the boundary** (per copilot rules): reject `userId` / `kind` that don't match `/^[\w-]{1,64}$/` and `/^(profile|settings)$/` respectively with `400`. Reject bodies that aren't a valid `Persisted<T>` shape (missing fields, wrong types) with `400`. This is the only place we ever trust user input.
   - **Storage backend isolation.** Only `tableStore.ts` imports `@azure/data-tables`. The Function handlers depend on `SyncStore`, so unit tests use the in-memory variant with zero Azure dependencies — same pattern that worked for the signaling sessions module.
   - **No client changes.** Step 25 already speaks this contract; flipping the feature flag in Step 27 is what activates it.
4. **STOP condition:** `npm --prefix api test` green; new `store.test.ts` covers all four LWW cases. With the API running locally (`swa start`) and the client pointed at it (`NEXT_PUBLIC_SYNC_BASE_URL=http://localhost:4280/api/sync`), changing a profile name in one tab and reloading a second tab on the *same* device shows the updated name. Concurrent writes from two simulated devices (different `deviceId`s) converge after each side's next push. `npm run type-check` and `npm run lint` still pass; existing signaling endpoints continue to work (regression check).

### Step 27 — Enable cloud sync in production + end-to-end smoke
1. **Step name:** Flip the feature flag, verify on the deployed Static Web App, lock in the Phase J STOP condition from ARCHITECTURE §5.5 / D-009.
2. **Files involved:**
   - [.github/workflows/azure-static-web-apps-ci-cd.yml](.github/workflows/azure-static-web-apps-ci-cd.yml) *(touch — pass `NEXT_PUBLIC_SYNC_BASE_URL` to the Oryx build via `env:` on the deploy step. Default value: `/api/sync` for same-origin calls)*
   - [src/components/Settings/SyncIndicator.tsx](src/components/Settings/SyncIndicator.tsx) *(touch — only if manual QA reveals copy/timing tweaks; otherwise no code change)*
   - [README.md](README.md) *(touch — add a one-paragraph "Cloud sync" section pointing at the env var and Phase J behaviour)*
   - [ARCHITECTURE.md](ARCHITECTURE.md) *(touch — flip the §5.5 / D-009 status note from "planned" to "shipped")*
3. **What will be implemented:**
   - No new code; this is the verification + documentation step that closes Phase J.
   - The flag default in *local* development (`npm run dev`) stays `unset` so contributors don't accidentally talk to the production sync table. Local sync uses `swa start` per Step 26's instructions.
   - Manual QA matrix on the preview deploy:
     1. Single tab, change profile name → 1 s later DevTools shows a `PUT` returning 200.
     2. Reload the tab → `GET` returns the envelope; UI shows the same name.
     3. Second tab on the same browser → `GET` returns the same envelope; edits in tab A reflect in tab B after the next reload (no live cross-tab broadcast — out of scope for v1).
     4. Kill the network in DevTools → indicator flips to "Offline" within ~1 s of the next edit.
     5. Restore network → an `online` event fires; the next `pull` succeeds; indicator returns to "Synced".
4. **STOP condition:** All five QA scenarios pass on the SWA preview URL. `gh pr view` shows a green CI run. ARCHITECTURE §5.5 reflects the shipped state. Phase J is closed. (Cross-device sync remains an explicit non-goal for v1; see optional Phase Z.)

### Step 28 — Game snapshot persistence (Phase D-1)
1. **Step name:** Persist `GameState` on every reducer action so a reload resumes mid-game.
2. **Files involved:**
   - [src/store/gameStore.ts](src/store/gameStore.ts) *(touch — wire `persist` middleware around the existing reducer slice; use the same envelope-aware storage adapter as Steps 2/3 so cloud-sync remains a future drop-in if we ever want resumable games across devices)*
   - [src/persistence/keys.ts](src/persistence/keys.ts) *(touch — `STORAGE_KEYS.gameSnapshot` already exists; no change expected unless we need to bump the version)*
   - `src/store/__tests__/gameStore.snapshot.test.ts` *(new — table-driven: action → reload → state preserved; finished-game snapshots are cleared on "New game")*
   - `src/store/gameStore.ts` *(touch — explicit `clearSnapshot()` action invoked from "New game" / "Forfeit" / `endGame` paths so we don't resume into a terminal state)*
3. **What will be implemented:**
   - **Partialize carefully.** Only persist the fields that fully describe a resumable game: `board`, `currentPlayer`, `placements`, `clocks`, `actionLog`, `turnNumber`, `players`, `options`. Exclude `winner` and any transient UI flags — if `winner` is set we delete the snapshot instead.
   - **Network mode rule.** Don't snapshot when `mode === 'network'` for v1. Resuming a peer-to-peer game after a reload is in Phase H's territory; mixing local-resume and network-rejoin paths now would couple two unrelated systems.
   - **SSR safety.** Same hydration-flicker pattern Steps 2/3 already use: `useGameHydrated()` hook + a layout-stable placeholder on the `/play` route during the first paint.
   - **Schema version.** Start at `v: 1`. Wire a `migrate` callback that returns `null` for unknown versions so a future shape change cleanly invalidates the saved game rather than corrupting it.
4. **STOP condition:** Start a local game, make 3 moves, hard-reload the tab → board, clocks, and current player are identical. Finish the game → reload → MainMenu (no resume). `npm run type-check`, `npm run lint`, and the new `gameStore.snapshot.test.ts` pass; existing tests stay green.

### Step 29 — "Resume game" banner on MainMenu (Phase D-2)
1. **Step name:** Surface the snapshot from Step 28 as a one-click resume on the home screen.
2. **Files involved:**
   - [src/components/MainMenu/MainMenu.tsx](src/components/MainMenu/MainMenu.tsx) *(touch — render a banner above the action buttons when an unfinished snapshot exists)*
   - [src/components/MainMenu/MainMenu.module.css](src/components/MainMenu/MainMenu.module.css) *(touch — banner styling: subtle, dismissible, fits the existing glassy aesthetic)*
   - [src/store/gameStore.ts](src/store/gameStore.ts) *(touch — add a `hasResumableSnapshot()` selector that returns `true` only when `winner === null` AND `turnNumber > 0`)*
   - `src/components/MainMenu/__tests__/MainMenu.resume.test.tsx` *(new — render with/without a snapshot; click "Resume" → router pushes `/play`; click "Discard" → snapshot cleared and banner disappears)*
3. **What will be implemented:**
   - **Three banner states:** none (no banner rendered), resumable (shows "Resume game · turn N"), finished (no banner — we cleared the snapshot in Step 28).
   - **Two actions:** "Resume" navigates to `/play` without touching the snapshot (the `/play` route's existing rehydration takes over). "Discard" calls `clearSnapshot()` and re-renders without the banner.
   - **No new persistence.** Everything reads from the Step 28 store; this is pure UI surfacing.
4. **STOP condition:** Start a game, navigate back to MainMenu without finishing → banner appears showing the correct turn number. Click Resume → game continues from the snapshot. Restart, finish a game → no banner on the next MainMenu visit. Banner test passes; `npm run type-check` and `npm run lint` pass.

### Step 30 — Final icon set + splash screens (Phase I-3)
1. **Step name:** Replace placeholder PWA assets with real ones; ship the maskable / Apple touch / splash matrix.
2. **Files involved:**
   - `public/images/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` *(new — real assets; 192 and 512 are required by Android, the maskable variant lets Android crop without clipping)*
   - `public/images/apple-touch-icon-180.png` *(new — Apple home-screen tile)*
   - `public/images/apple-splash-*.png` *(new — at least the iPhone 14 / 14 Pro Max / 12-mini sizes; full matrix can be generated from one master via a build-time script if it grows)*
   - [public/manifest.webmanifest](public/manifest.webmanifest) *(touch — point each `icons[]` entry at the new files and set `purpose: 'any maskable'` on the maskable variant)*
   - [src/app/layout.tsx](src/app/layout.tsx) *(touch — `metadata.icons.apple` and `appleWebApp.startupImage` point at the new files)*
   - `README.md` *(touch — short "Generating PWA assets" section explaining how to regenerate the set from a master SVG so we don't lose the recipe)*
3. **What will be implemented:**
   - One master SVG (`public/images/logo-master.svg`) + a `scripts/generate-pwa-icons.mjs` Node script that emits every required PNG via `sharp`. Script is dev-time only; production build pulls the pre-committed PNGs.
   - **No runtime code change** beyond metadata pointers. Bundle size impact is zero.
4. **STOP condition:** Lighthouse PWA audit on the deployed preview is 100, with no "icon" or "splash" warnings. Adding the app to the iOS home screen shows the new tile; opening it shows the new splash. Adding it on Android shows the maskable icon clipped correctly. `npm run build` succeeds; `npm run type-check` and `npm run lint` pass.

---

## Proposed next 4 steps (after Step 30)

> Status: **proposed, not yet approved.** Each entry is sized like the steps above (~150 LOC, ~3 files, one clear STOP). Order is suggested. All four form a new "Phase L — Production hardening & a11y" (see rollup below). Authentication is intentionally **not** in this batch — see the optional Phase Z at the bottom of this document for why it's deferred and what shipping it would look like.

### Step 31 — PWA install affordance (Phase L-1)
1. **Step name:** Give users a discoverable way to install the now-properly-iconed PWA on both Android/desktop Chrome and iOS Safari.
2. **Files involved:**
   - `src/hooks/usePwaInstall.ts` *(new — captures `beforeinstallprompt` and exposes `{ canInstall, promptInstall, isStandalone, isIOSSafari }`)*
   - `src/components/PwaInstall/InstallPill.tsx` *(new — small "Install Mojong" button rendered only when `canInstall` is true)*
   - `src/components/PwaInstall/InstallHintIOS.tsx` *(new — one-time iOS modal explaining "Tap Share → Add to Home Screen"; dismissal stored under a `mojong.installHintDismissed.v1` key)*
   - [src/components/MainMenu/MainMenu.tsx](src/components/MainMenu/MainMenu.tsx) *(touch — render the pill above the action buttons; render the iOS hint on first visit only)*
3. **What will be implemented:**
   - Listen for `beforeinstallprompt`, call `e.preventDefault()`, stash the event in a ref, expose `promptInstall()` that calls `e.prompt()`. Hide the pill once installed (`appinstalled` event or `display-mode: standalone`).
   - iOS Safari has no install event, so we detect `/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.navigator.standalone` and show the hint exactly once (gated by the dismissal key).
   - **Boundary discipline:** all `window` / `navigator` access lives in the hook, behind a `typeof window !== 'undefined'` check, so SSR/Next still renders cleanly.
4. **STOP condition:** On Chrome desktop with the app eligible, the pill appears and clicking it shows the native install prompt; accepting it installs the app and the pill disappears. On iOS Safari, the hint modal shows on first visit and never again after dismissal. In an already-installed standalone window, neither surface renders. `npm run type-check` and `npm run lint` pass.

### Step 32 — Service-worker update prompt (Phase L-2)
1. **Step name:** When a new build is deployed, prompt the user to reload instead of leaving them on a stale cached bundle.
2. **Files involved:**
   - `src/hooks/useSwUpdate.ts` *(new — listens for `controllerchange` and `waiting` SW events; exposes `{ updateReady, applyUpdate }`)*
   - `src/components/PwaUpdate/UpdateToast.tsx` *(new — bottom-of-screen toast: "New version available · Reload")*
   - [src/app/layout.tsx](src/app/layout.tsx) *(touch — mount the toast next to `<SyncBootstrap />`)*
   - [next.config.ts](next.config.ts) *(touch — confirm `@ducanh2912/next-pwa` is configured with `skipWaiting: false` so the user controls when the new SW activates)*
3. **What will be implemented:**
   - On `navigator.serviceWorker.ready`, watch `registration.waiting`; if present, set `updateReady = true`. Also handle the case where a new SW becomes waiting *while the tab is open* via `updatefound` → `statechange`.
   - `applyUpdate()` posts `{ type: 'SKIP_WAITING' }` to `registration.waiting`, then reloads the page when `controllerchange` fires.
   - Toast is dismissible (postpone) but reappears on the next route change so users don't get permanently stuck on the old bundle.
4. **STOP condition:** Deploy build A, install/load it, deploy build B, reload once → toast appears within a few seconds; clicking "Reload" lands on build B (verified by a build-id meta tag or version string surfaced in Settings). `npm run build` succeeds; `npm run type-check` and `npm run lint` pass.

### Step 33 — Root error boundary + opt-in client error log (Phase L-3)
1. **Step name:** Replace the "white screen of death" risk with a friendly fallback and (optionally) ship the error to the API for diagnosis.
2. **Files involved:**
   - `src/components/ErrorBoundary/ErrorBoundary.tsx` *(new — class component implementing `componentDidCatch`; renders a fallback with a "Try again" button that resets state)*
   - `src/components/ErrorBoundary/__tests__/ErrorBoundary.test.tsx` *(new — render a child that throws, assert the fallback shows; click "Try again", assert recovery)*
   - [src/app/layout.tsx](src/app/layout.tsx) *(touch — wrap `{children}` in `<ErrorBoundary>`)*
   - `api/src/functions/logError.ts` *(new, optional — accepts `{ message, stack, userId, deviceId, build, url }`; writes one row to a `clientErrors` table. Gated by `NEXT_PUBLIC_ERROR_LOG_URL`; absent flag → boundary still works, just doesn't report)*
3. **What will be implemented:**
   - The boundary catches **render-time** errors only (React's contract). Async errors stay the responsibility of their handlers; we don't add a global `window.onerror` hook in this step to keep scope tight.
   - Fallback UI matches the existing glassy aesthetic and never references the technical error message (we log it, we don't expose it).
   - When the env flag is set, the boundary `fetch`-POSTs the payload once per mount; failures to log are swallowed so a logging outage never blocks the UI.
4. **STOP condition:** Forcing a throw in a child component shows the fallback; clicking "Try again" recovers. With the log endpoint configured locally, the POST is observable in the network tab and the row appears in Table Storage. `npm run type-check`, `npm run lint`, and the new boundary test pass.

### Step 34 — Accessibility pass on board + menus (Phase L-4)
1. **Step name:** Make the board and primary menus keyboard- and screen-reader-usable; respect `prefers-reduced-motion`.
2. **Files involved:**
   - [src/components/Board/Board.tsx](src/components/Board/Board.tsx) *(touch — arrow-key focus traversal between cells; Enter/Space activates the focused cell with the same handler as click; `role="grid"` + `aria-rowindex` / `aria-colindex` on each cell)*
   - [src/components/MainMenu/MainMenu.tsx](src/components/MainMenu/MainMenu.tsx), [src/components/Settings/Settings.tsx](src/components/Settings/Settings.tsx) *(touch — confirm every interactive element has an accessible name; restore focus on route change)*
   - [src/app/globals.css](src/app/globals.css) *(touch — `:focus-visible` ring; `@media (prefers-reduced-motion: reduce)` disables non-essential transitions)*
   - `src/components/Board/__tests__/Board.a11y.test.tsx` *(new — render the board, fire arrow keys, assert the focus index advances; press Enter, assert the move handler fires)*
3. **What will be implemented:**
   - Roving-tabindex pattern on the board: exactly one cell has `tabIndex=0` at any time; arrow keys move it and call `focus()`.
   - No new visual design — purely additive a11y semantics and the reduced-motion guard.
4. **STOP condition:** Lighthouse Accessibility score ≥ 95 on `/`, `/play`, `/settings`. A full keyboard-only run (Tab from MainMenu → Start → arrow-key a move → Enter) plays a turn. Toggling the OS "reduce motion" setting disables the non-essential CSS transitions. `npm run type-check`, `npm run lint`, and the new a11y test pass.

---

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
- D-1 *(shipped as Step 28)* Snapshot `GameState` to local storage on each `executeAction`.
- D-2 *(scheduled as Step 29)* "Resume game" banner on MainMenu.

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

**Phase I — Polish** *(shipped)*
- I-1 *(shipped)* Tutorial static page at [/tutorial](src/app/tutorial/page.tsx).
- I-2 *(shipped)* Old `GameSetup` component deleted.
- I-3 *(shipped as Step 30)* Icon set finalisation, splash screens, theme polish.

**Phase J — Cloud sync for profile + settings (per ARCHITECTURE §5.5 / D-009)**
- J-1 *(shipped as Step 24)* `src/sync/reconcile.ts` — last-write-wins kernel, pure logic.
- J-2 *(shipped as Step 25)* `src/sync/httpClient.ts` — fetch wrapper for `GET/PUT /sync/:userId/:kind`, with debounce (1 s) and online/offline awareness.
- J-3 *(shipped as Step 25)* Wire `useProfileStore` and `useSettingsStore` to the sync client via a single Zustand `subscribe` listener — no store internals change.
- J-4 *(scheduled as Step 26)* Backend: Azure Static Web Apps managed Function `api/sync/{userId}/{kind}` backed by Azure Table Storage. LWW enforced server-side; `409` on stale `PUT`.
- J-5 *(shipped as Step 27)* Reconcile on app start and on `online` event; surface a tiny "Synced · just now" indicator in Settings.

**Phase L — Production hardening & a11y** *(shipped)*
- L-1 *(shipped as Step 31)* PWA install affordance — `beforeinstallprompt` pill + iOS Add-to-Home-Screen hint.
- L-2 *(shipped as Step 32)* Service-worker update prompt so a redeploy doesn't strand users on a stale cache.
- L-3 *(shipped as Step 33)* Root React error boundary + opt-in client error log endpoint.
- L-4 *(shipped as Step 34)* Board + menus keyboard / screen-reader pass; `prefers-reduced-motion` respect. Lighthouse Accessibility = 100 on `/`, `/play`, `/settings`.

---

## Phase Z — Authentication *(optional, deferred indefinitely)*

**Status:** **not on the v1 roadmap.** The app is fully functional without it. This section exists only so a future contributor doesn't have to re-derive the design if the product decision changes.

**Why it's deferred:**
- Every feature shipped so far works anonymously. `userId === deviceId` (a per-device UUID from [src/persistence/ids.ts](src/persistence/ids.ts)) is enough to scope cloud sync per device, and the signaling service uses session codes, not identities.
- The only thing auth unlocks is **same profile/settings following one human across multiple devices**. That's a nice-to-have, not a requirement — a returning user on the same device already sees their profile, settings, and resumable game.
- Auth adds material complexity (provider config, account-deletion flow, privacy policy obligations, abuse handling) that we don't need to take on to ship a playable game.

**If we ever do want it, the shape is:**
- **Z-1 — Sign-in via Static Web Apps built-in auth.** Add Apple / Google providers in [staticwebapp.config.json](staticwebapp.config.json); read `/.auth/me` from a new `src/hooks/useAuth.ts`; when authenticated, rebase the sync subscriber's `userId` from `deviceId` to the auth provider's stable user id.
- **Z-2 — Anonymous → authenticated migration.** New idempotent `POST /api/migrate` Function that copies `profile` + `settings` rows from `deviceId` to the authenticated `userId` if-and-only-if the destination is empty; sign-out reverts the client to the anonymous path. Shipped in the same PR as Z-1 so we never have an auth flow that orphans local data.
- **Z-3 — Account deletion / sign-out hygiene.** A `DELETE /api/me` Function plus a Settings affordance, required for App Store / Play Store compliance the moment auth exists.

Until somebody actually requests cross-device sync, Phase Z stays unscheduled — do **not** start it as a self-directed cleanup task.

---

## Definition of done (every step)

A step is only complete when **all** of these are true:

1. `npm run type-check` passes.
2. `npm run lint` passes.
3. The STOP condition stated in the step has been verified manually or by test.
4. No regressions in the existing single-device 2-player game flow.
5. Any new public function has a one-line purpose comment per the project's learning-first convention.
