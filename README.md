# mojong

Project workspace with strict, learning-first GitHub Copilot instructions.

## Cloud sync (Phase J)

Profile and settings are mirrored to a small Azure Static Web Apps managed
Function (`/api/sync/{userId}/{kind}`) backed by Azure Table Storage. The
client side is gated by a single build-time feature flag:

| Env var | Effect |
|---|---|
| `NEXT_PUBLIC_SYNC_BASE_URL` unset | sync is off; everything is purely local |
| `NEXT_PUBLIC_SYNC_BASE_URL=/api/sync` | sync is on against the same-origin SWA API |
| `NEXT_PUBLIC_SYNC_BASE_URL=http://localhost:4280/api/sync` | local `swa start` against the API package |

Production deploys set the flag automatically from the GitHub Actions
workflow ([.github/workflows/azure-static-web-apps-ci-cd.yml](.github/workflows/azure-static-web-apps-ci-cd.yml)).
Local `npm run dev` deliberately leaves it unset so contributors do not
accidentally write to the production table; use `swa start` and override
the flag in `.env.local` when you need to exercise the full path.

Reconciliation is last-write-wins by `updatedAt`, with `deviceId`
breaking ties and a schema-version override so an upgraded client always
beats a downgraded one. The server applies the same rule, so the local
kernel and the API agree on every conflict. See
[ARCHITECTURE.md §5.5](ARCHITECTURE.md) for the algorithm and
[IMPLEMENTATION_PLAN.md Steps 24–27](IMPLEMENTATION_PLAN.md) for the
slice history.
