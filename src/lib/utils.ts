import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The design-system token names that become Tailwind utilities.
 *
 * Keep these in step with the `@theme inline` block in src/app/globals.css —
 * that file defines the values, this list only tells tailwind-merge which
 * class group each name belongs to.
 */
const FONT_SIZES = [
  "micro",
  "caption",
  "table",
  "label",
  "body",
  "section",
  "page-title",
] as const

const CONTROL_SIZES = ["control", "control-sm", "control-lg", "control-touch"] as const

const Z_LAYERS = [
  "dropdown",
  "sticky",
  "overlay",
  "modal",
  "popover",
  "tooltip",
  "toast",
] as const

/**
 * tailwind-merge, taught the token names.
 *
 * Without this it cannot tell `text-body` from a colour: its `text-*` rule
 * routes anything that is not a known size into the text-colour group, so
 * `cn("text-body", "text-xs")` kept BOTH and the later-emitted rule won. A
 * caller asking for a smaller size would silently not get it — and when the
 * base class is responsive (`md:text-body`) the media query wins outright,
 * which is the same trap that once made every search box draw its magnifier
 * over the placeholder (see ui/input-padding.test.ts).
 *
 * The same applies to `h-control` vs `h-10` and `z-popover` vs `z-50`.
 * Verified by lib/utils.test.ts.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZES] }],
      h: [{ h: [...CONTROL_SIZES] }],
      "min-h": [{ "min-h": [...CONTROL_SIZES] }],
      w: [{ w: [...CONTROL_SIZES] }],
      size: [{ size: [...CONTROL_SIZES] }],
      z: [{ z: [...Z_LAYERS] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
