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

// ── Icon image paths ──────────────────────────────────────────
// Each figure type maps to a PNG in /public/images/ rendered on
// the sphere surface via an SVG <image> element.

const ICON_PATHS: Record<string, string> = {
  ft_slon: '/images/x.png',
  ft_runner: '/images/arrow.png',
  ft_cross: '/images/cross.png',
  ft_ziraf: '/images/long_x.png',
};

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
  flipped = false,
}: FigureIconAllProps) {
  // Gradient ID encodes both the type and color so instances with different
  // player colors never share the wrong gradient definition.
  const gradId = `sphere-${figureTypeId}-${color.replace(/[^a-zA-Z0-9]/g, '')}`;
  const iconPath = ICON_PATHS[figureTypeId];

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: 'block' }}>
      <defs>
        <radialGradient id={gradId} cx="35%" cy="28%" r="62%" fx="35%" fy="28%">
          {/* Player color fills the sphere */}
          <stop offset="0%"   stopColor={color} stopOpacity="1" />
          {/* Deep shadow on the far side */}
          <stop offset="100%" stopColor="black" stopOpacity="0.5" />
        </radialGradient>
        {selected && (
          <filter id="sel-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feFlood floodColor="#facc15" floodOpacity="0.7" />
            <feComposite in2="blur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>

      {/* Sphere — filled with the radial gradient */}
      <circle cx="24" cy="24" r="20" fill={`url(#${gradId})`} filter={selected ? 'url(#sel-glow)' : undefined} />

      {/* Icon image rendered on top of the sphere surface */}
      {iconPath ? (
        <image
          href={iconPath}
          x="4" y="4" width="40" height="40"
          opacity="0.9"
          transform={flipped ? 'rotate(180 24 24)' : undefined}
        />
      ) : (
        <text x="24" y="30" textAnchor="middle" fontSize="18"
          fill="white" opacity="0.9" fontWeight="bold" fontFamily="sans-serif">
          ?
        </text>
      )}
    </svg>
  );
}
