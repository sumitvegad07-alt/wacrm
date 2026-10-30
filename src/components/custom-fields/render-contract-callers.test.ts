import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// The forms that call `renderCustomSystemField` must not hide a field merely
// because it has no `system_key`.
//
// A field with no system_key IS the account's own custom field — the whole
// point of the Custom Fields screen. Returning `null` for it means "hide this
// field entirely" (see the custom-fields render contract and
// visible-fields.test.ts), so a form that opens with
//
//     if (!field.system_key) return null;
//
// silently drops every field the account added itself. Both Employee forms did
// exactly that: a "Date Of Birth" field created for the Employee (user) module
// was stored, was active, had a section — and never painted anywhere.
//
// The correct guard returns `undefined`: "I have no opinion, draw the default
// input for it". This test reads the sources rather than rendering them so one
// check covers all fourteen forms, including ones added later.
// ---------------------------------------------------------------------------

/** `return null` (or a null arrow body) guarded only by a missing system_key. */
const HIDES_ACCOUNT_CUSTOM_FIELDS =
  /if\s*\(\s*!\s*(?:field|fld|f)\s*\.\s*system_key\s*\)\s*(?:return\s+null|\{\s*return\s+null)/;

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFilesUnder(path));
    else if (entry.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("renderCustomSystemField callers", () => {
  test("no form hides a field just because it has no system_key", () => {
    const offenders = sourceFilesUnder("src")
      .filter((path) => {
        const src = readFileSync(path, "utf8");
        return (
          src.includes("renderCustomSystemField") &&
          HIDES_ACCOUNT_CUSTOM_FIELDS.test(src)
        );
      })
      .map((path) => path.split("\\").join("/"));

    expect(offenders).toEqual([]);
  });
});
