import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The nine surfaces that build a Record<ProductLine, boolean> called `owns`.
// Plan 1 gave each of them the constant `dms: false` because addon_lines was
// not on production yet. It is now. A constant here makes every DMS surface
// gate silently false, which is exactly how a paid feature ships invisible —
// so this list is pinned in a test rather than trusted to memory.
const OWNS_FILES = [
  "src/hooks/use-nav-items.ts",
  "src/components/layout/sidebar.tsx",
  "src/components/layout/command-palette.tsx",
  "src/app/(dashboard)/dashboard-shell.tsx",
  "src/app/(dashboard)/import/page.tsx",
  "src/app/(dashboard)/import/[module]/page.tsx",
  "src/app/(dashboard)/custom-fields/[module]/page.tsx",
  "src/app/(dashboard)/reports/page.tsx",
  "src/app/(dashboard)/settings/page.tsx",
];

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("the DMS add-on is wired into every owns map", () => {
  it("has all nine files still present", () => {
    // A rename that drops a file from this list would make the suite pass by
    // testing nothing, so prove each path resolves first.
    for (const f of OWNS_FILES) {
      expect(read(f).length, f).toBeGreaterThan(0);
    }
  });

  it("never hardcodes dms to a constant", () => {
    for (const f of OWNS_FILES) {
      const src = read(f);
      expect(src, `${f} still hardcodes dms`).not.toMatch(/\bdms:\s*(false|true)\b/);
    }
  });

  it("reads dms from hasDMS in every one of them", () => {
    for (const f of OWNS_FILES) {
      const src = read(f);
      expect(src, `${f} does not read hasDMS`).toMatch(/\bdms:\s*hasDMS\b/);
    }
  });
});
