import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
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

/**
 * The source having a fallback is not the same as the BUILT CSS having one.
 *
 * Tailwind v4 minifies through Lightning CSS, which deduplicates repeated
 * declarations of the same property when it believes every target supports
 * the later value. That silently deleted the `100vh` line written above
 * `100dvh` — the fallback looked right in the source and was simply absent
 * from what shipped. Colour fallbacks it keeps; heights it does not, which is
 * why the height fallback is written with `@supports` instead.
 *
 * These tests compile globals.css through the project's real PostCSS
 * pipeline and assert on the output, so that class of silent loss cannot
 * come back.
 */
describe("globals.css compiled output", () => {
  const compiled = (async () => {
    const css = readFileSync(GLOBALS, "utf8");
    const result = await postcss([tailwind()]).process(css, { from: GLOBALS });
    return result.css;
  })();

  it("keeps a plain-colour fallback before every oklch token", async () => {
    const css = await compiled;

    const MODERN = /oklch\(|oklab\(|lab\(|lch\(|color\(/i;
    const PLAIN = /^#|^rgba?\(|^hsla?\(|^[a-z]+$/i;

    /**
     * Group every declaration by token, in source order.
     *
     * Only the LAST declaration of a token matters: Tailwind's own palette is
     * declared early with no fallback, and the generated block at the end of
     * globals.css re-declares the used colours hex-first. What ships is
     * whatever wins, so that is what we check.
     */
    const byToken = new Map<string, string[]>();
    for (const [, name, value] of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      const list = byToken.get(name) ?? [];
      list.push(value.trim());
      byToken.set(name, list);
    }

    /**
     * Tokens actually referenced by a rule. Tailwind scans raw file text, so
     * a colour merely *named in a code comment* gets its variable emitted
     * even though nothing uses it. An unreferenced variable cannot render
     * anything, so it needs no fallback.
     */
    const referenced = new Set(
      [...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]),
    );

    const unprotected: string[] = [];
    for (const [name, values] of byToken) {
      if (!referenced.has(name)) continue;

      const last = values[values.length - 1];
      if (!MODERN.test(last)) continue; // a plain final value needs no fallback

      const previous = values[values.length - 2];
      if (previous && PLAIN.test(previous)) continue; // hex-then-modern pair

      unprotected.push(`${name}: ${last}`);
    }

    expect(
      unprotected,
      `These tokens reach the built CSS with no plain-colour fallback before them, so a ` +
        `browser without oklch renders them as nothing.\n` +
        `If any is a Tailwind palette colour, re-run: node scripts/add-color-fallbacks.mjs --apply\n` +
        unprotected.join("\n"),
    ).toEqual([]);
  });

  it("keeps the @supports height fallback for browsers without dvh", async () => {
    const css = await compiled;

    expect(
      css,
      "The dvh height fallback was stripped from the built CSS. Do NOT write it as a " +
        "duplicate `100vh` declaration above `100dvh` — the minifier deletes that. Use @supports.",
    ).toMatch(/@supports\s+not\s*\(height:\s*100dvh\)/);

    expect(css).toMatch(/min-height:\s*100vh/);
  });
});
