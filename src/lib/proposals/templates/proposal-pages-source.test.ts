import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// A source-shape test, deliberately not a rendering test.
//
// Next compiles this project with SWC, and SWC drops the leading space of a JSX
// text node when that text contains an HTML entity:
//
//     <b>Self-calculates</b> from orders &amp; collections   →  "Self-calculatesfrom orders"
//     <b>Geo-tagged visits</b> — check-in only works         →  correct (no entity)
//
// Vitest transforms with esbuild, which keeps the space — so a rendering test
// passes while the deployed proposal reads "Self-calculatesfrom". The only
// reliable guard is the source shape itself. Write "&" and "'" literally; JSX
// handles both, and neither triggers the bug.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync(join(__dirname, "proposal-pages.tsx"), "utf8");

describe("proposal-pages.tsx source", () => {
  test("has no HTML entity directly after a closing tag and a space", () => {
    const offenders = SOURCE.split("\n")
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /<\/\w+>\s+[^<{]*&(amp|apos|nbsp|quot|#\d+);/.test(line))
      .map(({ line, n }) => `${n}: ${line.trim()}`);

    expect(offenders, "SWC will eat the space before this text").toEqual([]);
  });

  test("writes ampersands literally rather than as &amp;", () => {
    expect(SOURCE).not.toContain("&amp;");
  });
});
