import type { CSSProperties, MouseEvent } from 'react';

/**
 * Returns an `onMouseEnter`/`onMouseLeave` pair that swaps inline styles on
 * hover — the same two-line pattern was hand-copied dozens of times across
 * Header/Footer/landing sections (one per link/card, each just a different
 * color pair). Centralizing it here means a color tweak is a one-line change
 * instead of a find-and-replace across files.
 */
export function hoverStyle<T extends HTMLElement = HTMLElement>(
  hoverStyles: CSSProperties,
  restingStyles: CSSProperties
) {
  return {
    onMouseEnter: (e: MouseEvent<T>) => Object.assign(e.currentTarget.style, hoverStyles),
    onMouseLeave: (e: MouseEvent<T>) => Object.assign(e.currentTarget.style, restingStyles),
  };
}
