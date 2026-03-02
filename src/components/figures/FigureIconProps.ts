// ============================================================
// src/components/figures/FigureIconProps.ts
//
// PURPOSE: Shared prop interface for all figure icon components.
// Kept framework-agnostic so it can be imported by both the web
// SVG components and future React Native equivalents.
// ============================================================

export interface FigureIconProps {
  /** CSS color string for the sphere — driven by the owning player's color. */
  color: string;
  /** Diameter in pixels. Defaults to 48. */
  size?: number;
  /** When true, renders a gold selection ring around the sphere. */
  selected?: boolean;
}
