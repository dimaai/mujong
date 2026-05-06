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
