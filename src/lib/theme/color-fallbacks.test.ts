import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GLOBALS = join(process.cwd(), "src", "app", "globals.css");

/** `  --background: oklch(0.13 0.01 260);` → `--background` */
const OKLCH_DECL = /^\s*(--[a-z0-9-]+)\s*:\s*oklch\(/i;
const ANY_DECL = /^\s*(--[a-z0-9-]+)\s*:\s*(.+);\s*$/i;

/**
 * Blank out `/* … *\/` comment bodies while keeping every newline, so line
 * numbers in failure messages still point at the real file. Comments may
 * legitimately quote a broken pattern in order to explain it.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

describe("globals.css colour fallbacks", () => {
  const lines = stripComments(readFileSync(GLOBALS, "utf8")).split("\n");

  it("gives every oklch custom property a plain-colour fallback on the line above", () => {
    const missing: string[] = [];

    lines.forEach((line, i) => {
      const oklch = OKLCH_DECL.exec(line);
      if (!oklch) return;
      const name = oklch[1];

      const previous = lines[i - 1] ?? "";
      const prev = ANY_DECL.exec(previous);
      const ok = prev?.[1] === name && !/oklch\(/i.test(prev[2]);

      if (!ok) missing.push(`line ${i + 1}: ${name}`);
    });

    expect(
      missing,
      `These oklch tokens have no plain-colour fallback above them, so Chrome/WebView 90-110, ` +
        `Firefox 100-112 and Safari below 15.4 will render them as nothing:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("never wraps a custom property in hsl(), which silently voids the colour", () => {
    const wrapped = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => /hsl\(\s*var\(--/i.test(line))
      .map(({ line, i }) => `line ${i + 1}: ${line.trim()}`);

    expect(
      wrapped,
      `The theme tokens hold full colours, not bare HSL channels, so hsl(var(--x)) is invalid ` +
        `and renders nothing:\n${wrapped.join("\n")}`,
    ).toEqual([]);
  });
});
