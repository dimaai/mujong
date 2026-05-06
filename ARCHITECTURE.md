# Mojong — Architecture

> Status: living document. Decisions that are still **open** or **assumed** are listed in [ARCHITECTURE_CLARIFICATIONS.md](ARCHITECTURE_CLARIFICATIONS.md). Do not treat this file as final until those clarifications are resolved.

---

## 1. Goals

Mojong is a 2-player turn-based strategy game. The next iteration must:

1. Run **offline on iPhone** without going through the App Store.
2. Add **online multiplayer** via short invitation codes (one host, one joiner).
3. Split the home screen into **Main Menu / Settings / Network Game** screens.
4. **Persist** user identity and settings between sessions (offline + online).
5. Provide a clear, conflict-safe model for **online sync, disconnects, and rejoin**.

The game logic itself (rules, board, figures, turn loop) is already solid and lives in framework-agnostic modules ([src/domain/](src/domain/)). The work below builds **around** that core without rewriting it.

---

## 2. High-Level Topology

```
┌────────────────────────────┐        invitation code         ┌────────────────────────────┐
│  iPhone PWA (Player A)     │ ───────────────────────────►   │  iPhone/Browser (Player B) │
│  - Next.js static export   │                                │  - Next.js static export   │
│  - Service worker (cache)  │   ┌──────────────────────┐     │  - Service worker (cache)  │
│  - Zustand stores          │ ◄─┤  Signaling service   ├──►  │  - Zustand stores          │
│  - WebRTC DataChannel      │   │  (Azure, stateless)  │     │  - WebRTC DataChannel      │
└──────────┬─────────────────┘   └──────────────────────┘     └──────────────┬─────────────┘
           │                                                                  │
           │              direct peer-to-peer game traffic                    │
           └──────────────────────────────────────────────────────────────────┘
```

- **Static frontend** keeps shipping to Azure Static Web Apps (already configured: `output: 'export'` in [next.config.ts](next.config.ts), rewrite rule in [staticwebapp.config.json](staticwebapp.config.json)).
- **Signaling** is a small stateless service whose only job is to relay WebRTC handshake messages between peers that share the same invitation code. After the handshake the service is no longer involved.
- **Game traffic** flows peer-to-peer over a WebRTC DataChannel — low latency, no per-game server cost, works fine for turn-based traffic (≤ 100 messages per game).

> Why P2P, not a hosted authoritative server: the game is **strictly turn-based** with one active player at a time, so the surface for cheating/conflicts is tiny. P2P also keeps the offline-first PWA story consistent — a network game is a thin overlay on the local engine.

---

## 3. Layered Module Map

The codebase will keep its current layering and grow new layers only where needed. Each layer has a single responsibility.

| Layer | Folder | Knows about | Does NOT know about |
|---|---|---|---|
| Domain (pure rules) | [src/domain/](src/domain/) | Types, board math, move validation | React, Zustand, Next.js, network |
| Data (seed configs) | [src/data/](src/data/) | Figure types, skins, level presets | Anything stateful |
| State stores | [src/store/](src/store/) | Domain + persistence + net adapter | React (read-only via hooks) |
| Persistence adapter | `src/persistence/` *(new)* | localStorage / IndexedDB | UI |
| Net adapter | `src/net/` *(new)* | WebRTC, signaling, message protocol | UI, rules |
| Hooks | [src/hooks/](src/hooks/) | Stores | Direct DOM |
| UI components | [src/components/](src/components/) | Hooks + stores | WebRTC, persistence internals |
| Routes | [src/app/](src/app/) | UI components | Domain internals |

**Rule:** anything below "Net adapter" must remain importable from a future React Native build. No `window`, no `document` outside the UI layer.

---

## 4. Domain Changes

### 4.1 Levels become "piece sets"
Today, [src/data/levels.ts](src/data/levels.ts) encodes board size + piece set + colors + timer in one `Level` object. The new design splits these so they can be combined freely.

```
Difficulty (= piece set)   →   Beginner | Normal | Advanced
BoardSize                  →   Small (6×9) | Medium (8×10) | Large (10×12)   (presets only)
GameOptions                →   timer, walls, againstView, colors, names
```

### 4.2 New domain concepts

- `Wall` — a board cell that is permanently blocked. Two walls placed deterministically on the middle row when `walls: true`. Treated by the rules engine the same way a friendly+enemy hybrid blocker is treated: never enterable, never jumpable except by `canJump` figures *(decision pending — see CLARIFICATIONS)*.
- `GameOptions` — the user-configurable settings bundle (separate from `Level`).
- `Profile` — the local player identity (id, display name, color preference, rating).

### 4.3 Type additions (sketch — see implementation plan for actual code)

```
Difficulty       = 'beginner' | 'normal' | 'advanced'
BoardSizePreset  = { id, label, width, height }
GameOptions      = { difficulty, boardSizeId, timerMinutes, againstView, walls, p1Color, p2Color }
Profile          = { id, displayName, color, rating, createdAt }
GameState.walls  : Position[]              // new field
```

`GameState.history` already records every `TurnAction` — we will reuse it as the **single source of truth** for online sync (Section 6).

---

## 5. Persistence

**Model:** local-first with optional cloud mirror. The local store is always the source of truth so the app works fully offline; the cloud copy is a convenience for cross-device users and may be absent at any time.

### 5.1 Storage layer

A thin adapter wraps the browser API so the rest of the app does not depend on `localStorage`:

```
src/persistence/storage.ts        → get/set/remove<T>(key): SSR-safe, JSON-typed, envelope-aware
src/persistence/keys.ts           → all storage keys in one place
src/persistence/ids.ts            → deviceId / userId generation and accessors
```

- Default backend: **`localStorage`** (small payloads: profile + settings + last-game snapshot).
- Reason for not using IndexedDB yet: payloads are <10 KB, sync API is simpler, and Zustand's `persist` middleware integrates trivially.
- Upgrade path: swap the adapter to IndexedDB if/when we add full game-history archives.

### 5.2 Persisted envelope

Every cloud-eligible blob is wrapped in the same envelope so sync code stays generic and conflict resolution is uniform:

```ts
type Persisted<T> = {
  v: 1;                 // schema version (drives migrations)
  data: T;              // the actual payload
  updatedAt: number;    // ms epoch, set on every write
  deviceId: string;     // device that wrote this revision
};
```

Local-only blobs (e.g. the in-progress game) may skip the envelope.

### 5.3 Identity: `deviceId` vs `userId`

Two distinct ids; conflating them is the easy way to lose data:

| Id | Lifetime | Purpose | Synced? |
|---|---|---|---|
| `deviceId` | Per install | Disambiguates which device wrote a revision; powers "this device vs others" UX | **No** — local only |
| `userId` | Forever (or until sign-in) | Key under which cloud blobs live | Yes |

Both are generated lazily on first run with `crypto.randomUUID()` and stored under `mojong.ids.v1`. Until accounts exist, `userId === deviceId`; "sync" is effectively a backup of this device. Adding any auth provider later promotes `userId` to a real cross-device key without touching the stores.

### 5.4 What gets persisted

| Key | Contents | Local | Cloud-mirrored |
|---|---|---|---|
| `mojong.ids.v1` | `{ deviceId, userId }` | ✅ | ❌ |
| `mojong.profile.v1` | `Persisted<{ player1: Profile; player2: Profile }>` | ✅ | ✅ |
| `mojong.settings.v1` | `Persisted<GameOptions>` | ✅ | ✅ |
| `mojong.game.current.v1` | `GameState` snapshot | ✅ | ❌ (changes too often; not worth it in v1) |
| `mojong.history.v1` *(later)* | Finished games summary | ✅ | TBD |

### 5.5 Cloud sync algorithm (Phase J)

Last-write-wins per blob, keyed by `updatedAt`. Stateless, idempotent, runs on app start and on every cloud-eligible write while online:

```
on app start (if online, for each cloud-mirrored kind):
  remote = GET /sync/{userId}/{kind}                (Persisted<T> | 404)
  local  = read local blob
  pick   = remote.updatedAt > local.updatedAt ? remote : local
  write `pick` to whichever side is stale

on local change (debounced 1 s, while online):
  PUT /sync/{userId}/{kind}  body: Persisted<T>

on network reconnect:
  re-run the "on app start" path
```

Notes:
- LWW per **blob**, not per field — the payloads are small enough that whole-blob replacement is fine and dramatically simpler than field-level merges.
- Server overwrites only when `body.updatedAt > stored.updatedAt`, otherwise responds `409` and the client refetches.
- The in-progress game is **never** synced in v1.

### 5.6 iOS PWA storage caveat
Apple evicts unused PWA storage after ~7 weeks of inactivity. We accept this and surface it in the UI ("Last saved … — kept for ~7 weeks while offline"). When online and Phase J is shipped, eviction is recoverable: app start re-pulls profile + settings from cloud.

### 5.7 Zustand integration
Two stores, two policies:

- `useProfileStore` and `useSettingsStore` — wrapped in Zustand `persist` middleware → automatic write-through. A single `subscribe` listener (added in Phase J) reads the envelope and forwards changes to the sync client.
- `useGameStore` — manually snapshotted to `mojong.game.current.v1` on every `executeAction`, cleared on `resetGame`. We do not auto-persist the entire store because game state changes 100+ times per game and we want to control serialization size.

### 5.8 Backend (Phase J)

Minimal REST surface, co-located with the WebRTC signaling service (§6):

```
GET  /sync/:userId/:kind   → Persisted<T> | 404
PUT  /sync/:userId/:kind   → Persisted<T>   (LWW by updatedAt; 409 on stale write)
```

Recommended hosting: **Azure Static Web Apps managed Functions API** (same deploy as the frontend) backed by **Azure Table Storage** — partition key `userId`, row key `kind`. Auth is deferred; until then, `userId` acts as a bearer secret (acceptable because no sensitive data is stored).

---

## 6. Online Multiplayer

### 6.1 Roles

Every network game has exactly two roles:

- **Host** — generates the invitation code, owns "Player 1" by default, controls game options.
- **Joiner** — enters the invitation code, takes "Player 2".

There is no third party / spectator / lobby in v1.

### 6.2 Invitation flow

```
Host                                        Signaling                     Joiner
 │  POST /sessions  (gameOptions)             │                              │
 │ ─────────────────────────────────────────► │                              │
 │ ◄──── { code: "MJ-7K2X" }                  │                              │
 │  (display code on screen)                  │                              │
 │                                            │  GET /sessions/MJ-7K2X       │
 │                                            │ ◄──────────────────────────  │
 │                                            │  ─── gameOptions, host SDP ► │
 │  ◄── joiner SDP (answer) ────────────────  │ ◄── joiner SDP ────────────  │
 │  ── ICE candidates (both directions) ────► │ ◄────────────────────────►   │
 │  ═══════════ WebRTC DataChannel open ════════════════════════════════════ │
 │                                            │  (signaling no longer used)  │
 │  ── { type: 'HELLO', profile } ──────────────────────────────────────────►│
 │ ◄── { type: 'HELLO', profile } ──────────────────────────────────────────  │
 │  ── { type: 'START', initialState } ────────────────────────────────────► │
 │  ── { type: 'ACTION', seq, action } ◄──────────────────────────────────►  │
```

- Invitation code: 6 base32 characters, prefixed `MJ-` for clarity. ~1 billion combinations; signaling rejects collisions and codes auto-expire after 10 minutes if unclaimed.
- Signaling carries **only** the SDP offer/answer + ICE candidates + initial `GameOptions`. Once the DataChannel is open, signaling is no longer touched.

### 6.3 Wire protocol (over the DataChannel)

All messages are JSON, versioned, and have a monotonically increasing `seq` per sender:

```
{ v: 1, type: 'HELLO',  seq, profile }
{ v: 1, type: 'START',  seq, gameOptions, initialFigures, hostPlayerIndex }
{ v: 1, type: 'ACTION', seq, action: TurnAction, turnNumber }
{ v: 1, type: 'OFFER_DRAW',  seq }
{ v: 1, type: 'ACCEPT_DRAW', seq }
{ v: 1, type: 'REJECT_DRAW', seq }
{ v: 1, type: 'FORFEIT', seq }
{ v: 1, type: 'PING',    seq, t }
{ v: 1, type: 'PONG',    seq, t }
{ v: 1, type: 'BYE',     seq, reason }
```

### 6.4 Authority & conflict resolution

- The game is **deterministic and turn-based**. Both peers run the same domain code on the same `TurnAction` → same `GameState`. No replication of full state needed after `START`.
- Only the **active player** is allowed to send `ACTION`. The receiver validates the action with `getValidMoves` / `getValidPlacements` before applying it. Invalid action → connection terminated with `BYE { reason: 'protocol' }`.
- **Sequence numbers** prevent replays and detect drops: receiver expects `seq = lastSeq + 1`, otherwise it requests resync (out of scope for v1 — we just disconnect with `protocol`).
- **Simultaneous events** (both players hit "offer draw" at the same instant): the host's message wins. This is the only tie-break needed because actions are otherwise serialized by turn ownership.

### 6.5 Disconnect & rejoin

| Event | Behaviour |
|---|---|
| DataChannel closes unexpectedly | Both clients freeze game UI, show "Reconnecting…" overlay. |
| `PING` unanswered for 10 s | Mark connection as suspect, start grace timer. |
| Grace timer expires (60 s) | Show "Opponent disconnected. Forfeit?" with options *Wait longer* / *Claim win* / *Resign*. |
| Reconnect succeeds within grace | Resume from local `GameState` (no replay needed because both sides are deterministic and the active player has not committed any new action). |

**Rejoin uses the same invitation code.** The signaling service keeps the session id alive for 5 minutes after the original handshake to allow one renegotiation. After that, the game is considered abandoned.

### 6.6 What the signaling service must do

Tiny surface, stateless except for short-lived session rows:

```
POST   /sessions            → { code }
GET    /sessions/:code      → { gameOptions, hostSdp, hostIce[] }   (long-poll or SSE)
POST   /sessions/:code/sdp  → joiner SDP answer
POST   /sessions/:code/ice  → ICE candidate (either side)
DELETE /sessions/:code      → host cancels before join
```

Recommended implementation: **Azure Functions + Azure Web PubSub** (or a single Azure Function with an in-memory map for v1). See CLARIFICATIONS — this is the largest open decision.

---

## 7. PWA / Offline

### 7.1 Build target
Already correct: Next.js static export (`output: 'export'`). The whole app ships as static files to Azure Static Web Apps.

### 7.2 Service worker
Use [`@ducanh2912/next-pwa`](https://github.com/DuCanhGH/next-pwa) (maintained fork of `next-pwa`, supports App Router + Next 15).

- **Strategy:** `CacheFirst` for static assets (`/_next/static/*`, images), `NetworkFirst` with cache fallback for HTML.
- **Auto-register:** on first visit, the SW pre-caches the entire build manifest so the next launch works fully offline.
- **Disabled in `dev`** to avoid stale caches during development.

### 7.3 Manifest & iOS install
- `public/manifest.webmanifest`: `name`, `short_name`, `display: "standalone"`, theme + background color, icon set (192, 512, maskable).
- iOS-specific tags in [src/app/layout.tsx](src/app/layout.tsx): `apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`.
- Distribution path: open URL in Safari → Share → Add to Home Screen. No App Store, no Apple Developer account.

### 7.4 Online vs offline behaviour

| Feature | Offline | Online |
|---|---|---|
| Local 2-player game | ✅ | ✅ |
| Settings + profile persistence | ✅ (local only) | ✅ (local; cloud sync TBD) |
| Network game | ❌ shows "Network unavailable" | ✅ |
| Tutorial | ✅ (bundled) | ✅ |

The network game button stays visible offline but is disabled with a tooltip — discoverability without surprise.

---

## 8. UI / Routing

### 8.1 New screens

```
/                  → Main Menu        (player names + colors, Network Game, Settings, Tutorial, Start)
/settings          → Settings         (against view, timer, difficulty, board size, walls, Save/Cancel)
/network           → Network Game     (Create code | Join code, then Lobby → Start)
/play              → Game canvas      (current GameCanvas)
/tutorial          → Tutorial         (static page, future)
```

We use the existing Next.js App Router. Each route is a thin client component that wires existing/new components into the stores.

### 8.2 Component reuse

- [GameSetup](src/components/GameSetup/GameSetup.tsx) is split: the form moves into a new `MainMenu` component, the game switch logic moves into `/play`. The current `againstView` / `timer` / `level` form fields move to the new `Settings` screen.
- [GameCanvas](src/components/GameCanvas/GameCanvas.tsx), [Board](src/components/Board/Board.tsx), [PlayerPanel](src/components/PlayerPanel/PlayerPanel.tsx), [FigurePanel](src/components/FigurePanel/FigurePanel.tsx) are unchanged in v1.

### 8.3 State flow per screen

| Screen | Reads | Writes |
|---|---|---|
| Main Menu | `useProfileStore`, `useSettingsStore` | `useProfileStore` (names/colors), starts game via `useGameStore.startGame` |
| Settings | `useSettingsStore` | `useSettingsStore.save` on Save, no-op on Cancel |
| Network Game | `useNetStore`, `useProfileStore` | `useNetStore.createSession` / `joinSession`; on success, navigates to `/play` |
| Game | `useGameStore`, `useNetStore` | `useGameStore` actions; mirrors `ACTION` over `useNetStore` when online |

---

## 9. Cross-Cutting Concerns

- **Versioning.** Every persisted blob and every wire message carries a `v: 1` field. Any breaking change bumps `v` and requires a migration function in `persistence/` or a hard reject in `net/`.
- **Time.** Turn timers are still owned by the **active player's** client (authoritative). The opponent receives the elapsed time inside `ACTION` messages and updates its display. Time-out is declared by the active client and broadcast as a `FORFEIT` with `reason: 'timeout'`.
- **Determinism.** `createInitialFigures` already produces a deterministic figure list for given inputs. Walls placement must also be deterministic given board size. No `Math.random` anywhere in the domain layer.
- **Logging.** A tiny `src/net/log.ts` ring-buffer logger captures the last 200 wire messages for diagnostics; never sent off-device unless the user opts in.

---

## 10. Out of Scope (v1)

- Accounts / authentication.
- Cloud sync of profile and settings.
- Spectator mode and replays.
- Matchmaking / leaderboards.
- iOS native shell (Capacitor) — kept as a follow-up if the PWA proves insufficient.
- AI opponent.

These are intentionally deferred and called out so the PR scope stays tight.
