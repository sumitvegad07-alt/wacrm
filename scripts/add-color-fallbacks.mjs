// ============================================================
// Insert a plain-colour fallback above every oklch() custom property in
// src/app/globals.css.
//
//   node scripts/add-color-fallbacks.mjs            (dry run — prints a diff)
//   node scripts/add-color-fallbacks.mjs --apply    (rewrites the file)
//
// Why: Tailwind v4 writes colours as oklch(). Chrome and Android WebView
// 90-110, Firefox 100-112 and Safari below 15.4 cannot read oklch, throw the
// declaration away, and render the UI with no colours at all. A plain colour
// on the line ABOVE survives, because those browsers keep the last
// declaration they understood while modern ones take the oklch.
//
// Idempotent: a token that already has a fallback above it is left alone, so
// this is safe to re-run after adding new tokens.
// ============================================================

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const GLOBALS = path.join(process.cwd(), "src", "app", "globals.css");
const apply = process.argv.includes("--apply");

const PALETTE_BLOCK_START = "/* >>> tailwind-palette-fallbacks (generated) >>> */";
const PALETTE_BLOCK_END = "/* <<< tailwind-palette-fallbacks <<< */";

/** oklch(L C H) or oklch(L C H / A), with L as 0-1 or a percentage. */
const OKLCH_DECL =
  /^(\s*)(--[a-z0-9-]+)\s*:\s*oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)\s*;\s*$/i;
const ANY_DECL = /^\s*(--[a-z0-9-]+)\s*:/i;

function oklchToSrgb(L, C, H) {
  const hRad = (H * Math.PI) / 180;
  const a = Math.cos(hRad) * C;
  const b = Math.sin(hRad) * C;

  // OKLab -> LMS (cube roots)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  // LMS -> linear sRGB
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  // linear -> gamma-encoded 0-255, clamped into sRGB
  return lin.map((v) => {
    const encoded =
      v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(encoded * 255)));
  });
}

const num = (raw) => (raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw));

const lines = readFileSync(GLOBALS, "utf8").split("\n");
const out = [];
const added = [];
const skipped = [];

lines.forEach((line, i) => {
  const match = OKLCH_DECL.exec(line);
  if (!match) {
    // Catch an oklch declaration the regex could not parse, so a token can
    // never be silently left without a fallback.
    if (/^\s*--[a-z0-9-]+\s*:\s*oklch\(/i.test(line)) skipped.push(`line ${i + 1}: ${line.trim()}`);
    out.push(line);
    return;
  }

  const [, indent, name, rawL, rawC, rawH, rawAlpha] = match;

  // Already has a fallback for the same token directly above? Leave it.
  const previous = lines[i - 1] ?? "";
  const prev = ANY_DECL.exec(previous);
  if (prev?.[1] === name && !/oklch\(/i.test(previous)) {
    out.push(line);
    return;
  }

  const [r, g, b] = oklchToSrgb(num(rawL), parseFloat(rawC), parseFloat(rawH));
  const fallback = rawAlpha
    ? `${indent}${name}: rgba(${r}, ${g}, ${b}, ${num(rawAlpha)});`
    : `${indent}${name}: #${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")};`;

  out.push(fallback);
  out.push(line);
  added.push(`${line.trim()}  ->  ${fallback.trim()}`);
});

if (skipped.length) {
  console.error(
    `\nERROR: ${skipped.length} oklch declaration(s) could not be parsed, so they would be ` +
      `left with no fallback. Fix the pattern before applying:\n${skipped.join("\n")}\n`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------
// Tailwind's OWN palette (--color-red-500 and friends).
//
// Those ship from the Tailwind package as oklch with no fallback, and the app
// uses them directly all over: status badges, alerts, chart series. On a
// browser without oklch every one of them renders as nothing. We cannot edit
// Tailwind's files, so we re-declare the ones this app actually uses in a
// managed block, hex first.
// ---------------------------------------------------------------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compile globals.css WITHOUT the generated block, then read back both the
 * palette tokens Tailwind defines and the ones its generated utilities
 * actually reference through `var(…)`.
 *
 * Deriving the list from the compiled CSS rather than by scanning source
 * files is exact: it covers every palette colour that can really paint,
 * including ones Tailwind picks up from places a class-name regex would miss.
 * Tokens nothing references are skipped — they cannot render anything.
 */
async function paletteFromCompiledCss() {
  const source = readFileSync(GLOBALS, "utf8").replace(
    new RegExp(`${escapeRe(PALETTE_BLOCK_START)}[\\s\\S]*?${escapeRe(PALETTE_BLOCK_END)}`),
    "",
  );
  const compiled = await postcss([tailwind()]).process(source, { from: GLOBALS });

  const defined = new Map();
  for (const m of compiled.css.matchAll(
    /(--color-[a-z]+-\d{2,3}(?!\d))\s*:\s*(oklch\([^)]*\))/gi,
  )) {
    defined.set(m[1], m[2]);
  }

  const referenced = new Set(
    // NOTE: `\d{2,3}(?!\d)` not `(?:50|[1-9]00|950)`. The alternation form
    // matches "50" inside "500" and silently captures the wrong token, which
    // left every -500 shade without a fallback.
    [...compiled.css.matchAll(/var\(\s*(--color-[a-z]+-\d{2,3}(?!\d))/gi)].map((m) => m[1]),
  );

  return { defined, referenced };
}

const { defined, referenced } = await paletteFromCompiledCss();
const used = [...referenced].filter((name) => defined.has(name)).sort();

const paletteLines = [];
const unresolved = [];
for (const varName of used) {
  const oklch = defined.get(varName);
  if (!oklch) {
    unresolved.push(varName);
    continue;
  }
  const parsed = /oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)/i.exec(oklch);
  if (!parsed) {
    unresolved.push(`${varName} (${oklch})`);
    continue;
  }
  const [r, g, b] = oklchToSrgb(num(parsed[1]), parseFloat(parsed[2]), parseFloat(parsed[3]));
  const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  paletteLines.push(`  ${varName}: ${hex};`);
  paletteLines.push(`  ${varName}: ${oklch};`);
}

if (unresolved.length) {
  console.error(
    `\nERROR: could not resolve a value for:\n${unresolved.join("\n")}\n` +
      `These would be left with no fallback.\n`,
  );
  process.exit(1);
}

const paletteBlock = [
  PALETTE_BLOCK_START,
  "/* Generated by scripts/add-color-fallbacks.mjs — do not edit by hand.",
  " *",
  " * Tailwind ships its palette as oklch with no fallback. Browsers without",
  " * oklch (Chrome/WebView 90-110, Firefox 100-112, Safari below 15.4) drop",
  " * those declarations and render the colour as nothing, which is how status",
  " * badges and alerts lose their colour entirely. Re-declared here hex-first,",
  " * for the palette colours this app actually uses. Re-run the script after",
  " * using a new one. */",
  ":root {",
  ...paletteLines,
  "}",
  PALETTE_BLOCK_END,
].join("\n");

let finalCss = out.join("\n");
const existing = new RegExp(
  `${escapeRe(PALETTE_BLOCK_START)}[\\s\\S]*?${escapeRe(PALETTE_BLOCK_END)}`,
);
finalCss = existing.test(finalCss)
  ? finalCss.replace(existing, paletteBlock)
  : `${finalCss.trimEnd()}\n\n${paletteBlock}\n`;

if (!apply) {
  console.log(added.join("\n"));
  console.log(
    `\n${added.length} theme fallbacks would be added.\n` +
      `${paletteLines.length / 2} Tailwind palette colours would be re-declared hex-first.\n` +
      `Re-run with --apply to write.`,
  );
} else {
  writeFileSync(GLOBALS, finalCss, "utf8");
  console.log(
    `${added.length} theme fallbacks + ${paletteLines.length / 2} palette colours written to ${GLOBALS}`,
  );
}
