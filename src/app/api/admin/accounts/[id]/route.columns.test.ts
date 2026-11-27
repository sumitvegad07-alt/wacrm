import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A column that does not exist yet must not be able to take this route down.
//
// This route is how the founder changes a tenant's plan, seats, expiry, modules
// and add-ons. `custom_features` arrives with migration 20261127120000, which is
// pasted into Supabase by hand AFTER the code deploys — the normal order here.
// In that window, a `custom_features` in the main select would make PostgREST
// answer 42703, the route would read it as "Account not found", and every
// billing change for every tenant would fail with a message about the wrong
// thing entirely. That is the shape of the bug that took the order screens down
// for three days (docs/engineering/WORKING-AGREEMENT.md), so it gets a guard
// rather than a comment.
//
// The route therefore reads the column in its own query and tolerates its
// absence. This test fails if anyone folds it back into the main select.
const SOURCE = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("the tenant billing route's account select", () => {
  // The main read: the one select that carries the commercial columns.
  const mainSelect = SOURCE.match(/"id, name, subscription_plan[^"]*"/)?.[0];

  it("reads the commercial columns in one select", () => {
    expect(mainSelect, "the main account select was not found at all").toBeTruthy();
    expect(mainSelect).toMatch(/addon_lines/);
    expect(mainSelect).toMatch(/portal_seats_limit/);
  });

  it("does NOT ask for custom_features there", () => {
    expect(mainSelect).not.toMatch(/custom_features/);
  });

  it("reads custom_features separately and survives the column not existing", () => {
    expect(SOURCE).toMatch(/\.select\("custom_features"\)/);
    expect(SOURCE).toMatch(/isUndefinedColumn/);
  });

  it("refuses a grant with a sentence that says what to do", () => {
    expect(SOURCE).toMatch(/RUN-THIS-IN-SUPABASE-custom-features\.sql/);
  });
});
