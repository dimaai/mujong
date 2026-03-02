// ============================================================
// src/components/figures/FigureIcon.tsx
//
// PURPOSE: Single SVG figure component for all figure types.
// The sphere, gradient, and selection ring are rendered once.
// Only the inner symbol differs per type — defined in SYMBOLS below.
//
// To add a new figure type: add one entry to SYMBOLS using its
// figureTypeId as the key. No new files needed.
// ============================================================

import React from 'react';
import type { FigureIconProps } from './FigureIconProps';

// ── Symbol definitions ────────────────────────────────────────
// Each value is the SVG content rendered on top of the sphere.
// Symbols use white fill/stroke so they work on any player color.
// Every symbol is paired with a shadow copy (translated 1px right,
// 1.5px down, black at low opacity) to give an embedded-in-surface look.

const SYMBOLS: Record<string, React.ReactNode> = {
  // Slon — diagonal-only mover. Symbol: diamond (four diagonal points).
  ft_slon: (
    <>
      <polygon points="24,13 36,24 24,35 12,24"
        fill="black" opacity="0.22" transform="translate(1,1.5)" />
      <polygon points="24,13 36,24 24,35 12,24"
        fill="white" opacity="0.88" />
    </>
  ),

  // Runner — long vertical + horizontal range. Symbol: upward chevron.
  ft_runner: (
    <>
      <polyline points="13,30 24,16 35,30"
        fill="none" stroke="black" strokeOpacity="0.22"
        strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"
        transform="translate(1,1.5)" />
      <polyline points="13,30 24,16 35,30"
        fill="none" stroke="white" strokeOpacity="0.9"
        strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),

  // Cross — short vertical + horizontal mover. Symbol: plus sign.
  ft_cross: (
    <>
      <g transform="translate(1,1.5)" opacity="0.22">
        <rect x="21" y="12" width="6" height="24" rx="2" fill="black" />
        <rect x="12" y="21" width="24" height="6" rx="2" fill="black" />
      </g>
      <rect x="21" y="12" width="6" height="24" rx="2" fill="white" opacity="0.88" />
      <rect x="12" y="21" width="24" height="6" rx="2" fill="white" opacity="0.88" />
    </>
  ),

  // Ziraf — tall vertical reach, can jump. Symbol: tall arch / leap arc.
  ft_ziraf: (
    <>
      <path d="M15,34 Q15,12 24,12 Q33,12 33,34"
        fill="none" stroke="black" strokeOpacity="0.22"
        strokeWidth="4" strokeLinecap="round"
        transform="translate(1,1.5)" />
      <path d="M15,34 Q15,12 24,12 Q33,12 33,34"
        fill="none" stroke="white" strokeOpacity="0.9"
        strokeWidth="4" strokeLinecap="round" />
    </>
  ),
};

// Fallback symbol for unknown types — question mark.
const FALLBACK_SYMBOL = (
  <text x="24" y="30" textAnchor="middle" fontSize="18"
    fill="white" opacity="0.9" fontWeight="bold" fontFamily="sans-serif">
    ?
  </text>
);

// ── Component ─────────────────────────────────────────────────

interface FigureIconAllProps extends FigureIconProps {
  /** ID from figuretypes.ts — determines which symbol is rendered. */
  figureTypeId: string;
}

/**
 * FigureIcon renders a 3D-styled dome for any figure type.
 *
 * The dome appearance comes from a radialGradient:
 *   offset light source (upper-left) → player color → dark shadow.
 * The inner symbol is looked up from SYMBOLS by figureTypeId.
 *
 * @param figureTypeId - matches the ids in figuretypes.ts
 * @param color        - player's CSS color, drives the sphere mid-band
 * @param size         - diameter in px (default 48)
 * @param selected     - when true, renders a gold ring outside the sphere
 */
export function FigureIcon({
  figureTypeId,
  color,
  size = 48,
  selected = false,
}: FigureIconAllProps) {
  // Gradient ID encodes both the type and color so instances with different
  // player colors never share the wrong gradient definition.
  const gradId = `sphere-${figureTypeId}-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  const symbol = SYMBOLS[figureTypeId] ?? FALLBACK_SYMBOL;

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: 'block' }}>
      <defs>
        <radialGradient id={gradId} cx="35%" cy="28%" r="62%" fx="35%" fy="28%">
          {/* Bright highlight where the light hits */}
          <stop offset="0%"   stopColor="white" stopOpacity="0.75" />
          {/* Player color in the mid-band */}
          <stop offset="45%"  stopColor={color} stopOpacity="1" />
          {/* Deep shadow on the far side */}
          <stop offset="100%" stopColor="black" stopOpacity="0.5" />
        </radialGradient>
      </defs>

      {/* Gold selection ring — outside the sphere boundary */}
      {selected && (
        <circle cx="24" cy="24" r="23" fill="none" stroke="#facc15" strokeWidth="2.5" />
      )}

      {/* Sphere — filled with the radial gradient */}
      <circle cx="24" cy="24" r="20" fill={`url(#${gradId})`} />

      {/* Inner symbol — sits on top of the sphere surface */}
      {symbol}
    </svg>
  );
}
