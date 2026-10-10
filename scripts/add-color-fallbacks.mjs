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

const GLOBALS = path.join(process.cwd(), "src", "app", "globals.css");
const apply = process.argv.includes("--apply");

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

if (!apply) {
  console.log(added.join("\n"));
  console.log(`\n${added.length} fallbacks would be added. Re-run with --apply to write.`);
} else {
  writeFileSync(GLOBALS, out.join("\n"), "utf8");
  console.log(`${added.length} fallbacks written to ${GLOBALS}`);
}
