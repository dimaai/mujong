// ============================================================
// scripts/generate-pwa-icons.mjs
//
// PURPOSE: Regenerate the entire PWA raster asset matrix
// (manifest icons + Apple touch icon + Apple splash screens)
// from the single master SVG at public/images/logo-master.svg.
//
// USAGE:   npm run generate:pwa-icons
//
// This script is dev-time only. CI/production builds consume the
// pre-committed PNG outputs in public/images/ and never invoke
// `sharp` themselves.
//
// SIDE EFFECTS: Writes/overwrites the PNG files listed in ICONS
// and SPLASHES below. Idempotent — running it twice produces the
// same bytes (sharp uses deterministic PNG encoding for the same
// input).
// ============================================================

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const MASTER = resolve(PROJECT_ROOT, 'public/images/logo-master.svg');
const OUT_DIR = resolve(PROJECT_ROOT, 'public/images');

// Must match manifest.theme_color / background_color.
const BRAND_BG = '#0f172a';

/** Square icons rasterized straight from the master. */
const ICONS = [
  { file: 'icon-192.png', size: 192 },          // Android home screen (required)
  { file: 'icon-512.png', size: 512 },          // Android splash / install prompt
  { file: 'icon-maskable-512.png', size: 512 }, // Android adaptive icon
  { file: 'apple-touch-icon-180.png', size: 180 }, // iOS home screen tile
];

/**
 * Apple splash screens. Sizes cover the most common modern iPhones.
 * Add more entries here (and matching <link rel="apple-touch-startup-image">
 * media queries in src/app/layout.tsx) as new devices need coverage.
 */
const SPLASHES = [
  { file: 'apple-splash-1290x2796.png', w: 1290, h: 2796 }, // iPhone 14 Pro Max / 15 Pro Max
  { file: 'apple-splash-1170x2532.png', w: 1170, h: 2532 }, // iPhone 14 / 13 / 12
  { file: 'apple-splash-1080x2340.png', w: 1080, h: 2340 }, // iPhone 12 mini / 13 mini
];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // Rasterize the master once at 1024 so every downstream resize
  // shares the same source pixels (avoids subtle SVG-rendering drift).
  const masterPng = await sharp(MASTER).resize(1024, 1024).png().toBuffer();

  for (const { file, size } of ICONS) {
    const out = resolve(OUT_DIR, file);
    await sharp(masterPng).resize(size, size).png().toFile(out);
    console.log('wrote', file);
  }

  for (const { file, w, h } of SPLASHES) {
    // Icon takes ~38% of the shorter side — large enough to read,
    // small enough to leave generous brand-color margins like iOS expects.
    const iconSize = Math.round(Math.min(w, h) * 0.38);
    const iconBuf = await sharp(masterPng).resize(iconSize, iconSize).png().toBuffer();
    const out = resolve(OUT_DIR, file);
    await sharp({
      create: {
        width: w,
        height: h,
        channels: 4,
        background: BRAND_BG,
      },
    })
      .composite([{ input: iconBuf, gravity: 'center' }])
      .png()
      .toFile(out);
    console.log('wrote', file);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
