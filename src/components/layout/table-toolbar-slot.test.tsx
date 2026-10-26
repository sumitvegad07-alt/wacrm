import { describe, expect, test } from "vitest";
import { shouldRenderHeader } from "./table-toolbar-slot";

const base = { breadcrumbs: false, badge: false, actions: false, claimed: false };

describe("shouldRenderHeader", () => {
  test("stays null when there is nothing at all to show", () => {
    expect(shouldRenderHeader(base)).toBe(false);
  });

  test("renders for its own content, as it always has", () => {
    expect(shouldRenderHeader({ ...base, actions: true })).toBe(true);
    expect(shouldRenderHeader({ ...base, badge: true })).toBe(true);
    expect(shouldRenderHeader({ ...base, breadcrumbs: true })).toBe(true);
  });

  // The trap. A page whose header has no content of its own still needs to
  // render once a table has claimed the slot, or the table's views, count
  // and menu have nowhere to go and disappear.
  test("renders when a table has claimed the slot, even with no content", () => {
    expect(shouldRenderHeader({ ...base, claimed: true })).toBe(true);
  });
});
