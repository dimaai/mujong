# mojong

Project workspace with strict, learning-first GitHub Copilot instructions.

## Generating PWA assets

All home-screen icons (Android 192/512, maskable, Apple touch icon) and Apple
launch-image splash screens are derived from a single master:
[public/images/logo-master.svg](public/images/logo-master.svg).

To regenerate the entire raster matrix after editing the master:

```powershell
npm run generate:pwa-icons
```

The script lives at [scripts/generate-pwa-icons.mjs](scripts/generate-pwa-icons.mjs)
and uses [`sharp`](https://sharp.pixelplumbing.com/) (a devDependency) to emit
deterministic PNGs into `public/images/`. The outputs are committed to the
repository — production builds never invoke `sharp` themselves.

To add a new Apple device target:

1. Append a `{ file, w, h }` entry to the `SPLASHES` array in the script.
2. Add a matching `appleWebApp.startupImage[]` entry in
   [src/app/layout.tsx](src/app/layout.tsx) with the correct
   `device-width` / `device-height` / `-webkit-device-pixel-ratio` media query.
3. Re-run `npm run generate:pwa-icons` and commit the new PNG.

The manifest icon list lives in
[public/manifest.webmanifest](public/manifest.webmanifest); add new sizes
there only if you also add them to the script.

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
