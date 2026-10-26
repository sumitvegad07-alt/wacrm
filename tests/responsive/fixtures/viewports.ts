/**
 * The eight screen sizes the portal must work at.
 *
 * `laptop` is the regression guard: nothing in the responsive programme may
 * change how the app renders at that size, so every suite runs there too and
 * its results must stay identical across the whole programme.
 *
 * `laptop-small` (1366x768) and `desktop-wide` (1920x1080) were added for the
 * design-system programme. 1366x768 matters most: it is the size the desktop
 * density pass was aimed at — 32px controls and 32px grid rows exist so a
 * useful number of rows fits in 768px of height — and yet it was the one size
 * never tested. The suite's only desktop entry was 1440x900, which is 132px
 * taller and hides exactly the bottom-control and row-count problems that
 * density is trading against.
 */
export const VIEWPORTS = [
  { name: "phone-small", width: 320, height: 568 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "laptop-small", width: 1366, height: 768 },
  { name: "laptop", width: 1440, height: 900 },
  { name: "desktop-wide", width: 1920, height: 1080 },
] as const;

export type Viewport = (typeof VIEWPORTS)[number];
