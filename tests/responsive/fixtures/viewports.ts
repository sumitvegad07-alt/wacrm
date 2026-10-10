/**
 * The six screen sizes the portal must work at, from the approved spec.
 *
 * `laptop` is the regression guard: nothing in the responsive programme may
 * change how the app renders at that size, so every suite runs there too and
 * its results must stay identical across the whole programme.
 */
export const VIEWPORTS = [
  { name: "phone-small", width: 320, height: 568 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "laptop", width: 1440, height: 900 },
] as const;

export type Viewport = (typeof VIEWPORTS)[number];
