// ============================================================
// src/data/skins.ts
//
// PURPOSE: Visual skin definitions.
// A skin is purely cosmetic — swapping it never affects rules.
// imageFile paths are relative to /public so Next.js serves them.
//
// To add a skin: add an entry and drop the image file in /public/skins/.
// ============================================================

import type { Skin } from '../domain/types';

export const SKINS: Skin[] = [
  {
    skinId: 'skin_default_blue',
    name: 'Blue',
    // Placeholder path. Add /public/skins/blue.svg to show real art.
    imageFile: '/skins/blue.svg',
  },
  {
    skinId: 'skin_default_red',
    name: 'Red',
    imageFile: '/skins/red.svg',
  },
];

/**
 * O(1) lookup: skinId → Skin.
 * Used in components so they can resolve imageFile without scanning the array.
 */
export const SKIN_MAP: Record<string, Skin> = Object.fromEntries(
  SKINS.map((s) => [s.skinId, s]),
);
