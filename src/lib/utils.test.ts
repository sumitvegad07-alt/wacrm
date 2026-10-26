import { describe, expect, it } from "vitest"

import { cn } from "./utils"

/**
 * The design-system tokens in globals.css are only usable if `cn` knows which
 * class group each one belongs to. tailwind-merge's stock `text-*` rule treats
 * any unrecognised value as a COLOUR, so `text-body` and `text-xs` would both
 * survive a merge and the later-emitted rule would win — a caller asking for a
 * smaller size would silently not get it.
 *
 * These tests fail if a token is added to globals.css without being added to
 * the list in utils.ts.
 */
describe("cn — design-system token class groups", () => {
  it("lets a caller's font size override a token font size", () => {
    expect(cn("text-body", "text-xs")).toBe("text-xs")
    expect(cn("text-caption", "text-page-title")).toBe("text-page-title")
    expect(cn("text-sm", "text-table")).toBe("text-table")
  })

  it("keeps a token font size and a text colour together", () => {
    // Different groups: a size must not evict a colour or the reverse.
    expect(cn("text-body", "text-muted-foreground").split(" ").sort()).toEqual([
      "text-body",
      "text-muted-foreground",
    ])
  })

  it("lets a caller's height override a token control height", () => {
    expect(cn("h-control", "h-10")).toBe("h-10")
    expect(cn("h-control-sm", "h-control")).toBe("h-control")
    expect(cn("min-h-control", "min-h-16")).toBe("min-h-16")
    expect(cn("size-control", "size-11")).toBe("size-11")
  })

  it("lets a caller's z-index override a token layer", () => {
    expect(cn("z-popover", "z-50")).toBe("z-50")
    expect(cn("z-dropdown", "z-modal")).toBe("z-modal")
  })

  /**
   * Documents the one case tailwind-merge cannot resolve, so nobody is
   * surprised by it: a responsive base class and a plain caller class are
   * different variants, so BOTH ship, and Tailwind emits the media query last.
   * This is why `h-control-touch md:h-control` correctly keeps 32px on desktop
   * even when a legacy call site still passes `h-10` — and why base padding
   * must never be written responsively (see ui/input-padding.test.ts).
   */
  it("keeps a responsive base alongside a plain override (media query wins)", () => {
    expect(cn("h-control-touch md:h-control", "h-10").split(" ").sort()).toEqual([
      "h-10",
      "md:h-control",
    ])
  })
})
