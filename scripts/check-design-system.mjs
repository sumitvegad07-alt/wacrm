#!/usr/bin/env node
/**
 * Design-system ratchet.
 *
 * ## Why this exists instead of more lint rules
 *
 * The design-system programme left real debt behind: 312 raw `<button>`
 * elements, 279 `text-red-*` classes, 331 arbitrary font sizes. None of that
 * can be an ESLint error, because a rule nobody can pass gets switched off or
 * ignored — and this repo already carries ~300 pre-existing lint errors that
 * prove the point.
 *
 * So the patterns that ARE at zero are ESLint errors (see eslint.config.mjs),
 * and the ones with debt are held here: counted against a recorded baseline,
 * failing only when a count goes UP. Existing code is allowed, new code is
 * not, and every batch that cleans some up ratchets the baseline down.
 *
 *   npm run lint:ui              check (use this in review / CI)
 *   npm run lint:ui -- --update  re-record the baseline after a cleanup
 *
 * Scope is the TENANT app only. src/app/(superadmin) is founder-only and
 * explicitly out of scope for the programme.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(ROOT, "scripts", "design-system-baseline.json");

const SCAN_DIRS = [
  join(ROOT, "src", "app", "(dashboard)"),
  join(ROOT, "src", "components"),
];

/** Paths allowed to contain a pattern because they DEFINE the fix. */
const EXEMPT = [
  "components/ui/",       // the primitives themselves set the heights
  "components/shared/",   // ditto for the layout and field primitives
  "components/landing/",  // marketing page, not the product UI
  "components/tremor/",   // vendored chart components
];

/**
 * `why` is printed when a count goes up, so whoever trips it does not have to
 * come and read this file to find out what to use instead.
 */
const CHECKS = [
  {
    key: "rawButton",
    label: "raw <button> elements",
    pattern: /<button[\s>]/g,
    why: "Use <Button> from @/components/ui/button — a raw button sits outside the shared focus-ring and disabled states.",
  },
  {
    key: "rawPaletteRed",
    label: "text-red-* (raw palette)",
    pattern: /\btext-red-\d{2,3}\b/g,
    why: "Use text-destructive. The raw palette has no dark-mode pairing and drifts from the semantic colour.",
  },
  {
    key: "rawPaletteBgRed",
    label: "bg-red-* (raw palette)",
    pattern: /\bbg-red-\d{2,3}\b/g,
    why: "Use bg-destructive/10. bg-red-50 in particular has no dark-mode pair and renders white-on-white.",
  },
  {
    key: "arbitraryFontSize",
    label: "arbitrary font sizes text-[...]",
    pattern: /\btext-\[\d+(?:px|rem)\]/g,
    why: "Use the type scale: text-micro / caption / table / label / body / section / page-title.",
  },
  {
    key: "hardcodedControlHeight",
    label: "hardcoded control heights h-7..h-11",
    pattern: /\bh-(?:7|8|9|10|11)\b/g,
    why: "Use h-control / h-control-sm / h-control-lg / h-control-touch, or let the shared control set its own height.",
  },
  {
    key: "inlineGridCols",
    label: "inline grid-cols-* declarations",
    pattern: /\bgrid-cols-\d\b/g,
    why: "For form fields use <FormGrid>; for detail pages use <DetailGrid cols={n}>.",
  },
  {
    key: "adHocCardSurface",
    label: "ad-hoc card surfaces",
    pattern: /bg-card\s+border\s+border-border\s+rounded/g,
    why: "Use <DetailSection> (detail pages) or <SettingsCard> (settings) so every panel shares one surface.",
  },
  {
    key: "rawTableFiles",
    label: "files hand-rolling <table>",
    pattern: /<table[\s>]/,
    perFile: true,
    skipIf: (src) => src.includes("components/ui/table"),
    why: "Use <LineItemsTable> for a read-only table inside a page, or <DataTable> for a list screen.",
  },
  {
    key: "adHocSpinnerFiles",
    label: "files with ad-hoc animate-spin",
    pattern: /animate-spin/,
    perFile: true,
    why: "Use <PageLoader> or <TableSkeleton> from @/components/shared.",
  },
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function measure() {
  const counts = Object.fromEntries(CHECKS.map((c) => [c.key, 0]));
  const files = SCAN_DIRS.flatMap((d) => walk(d));
  let scanned = 0;

  for (const file of files) {
    const rel = relative(join(ROOT, "src"), file).replace(/\\/g, "/");
    if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
    scanned += 1;
    const src = readFileSync(file, "utf8");

    for (const check of CHECKS) {
      if (check.skipIf && check.skipIf(src)) continue;
      if (check.perFile) {
        // A fresh regex each time: a /g regex carries lastIndex between calls.
        if (new RegExp(check.pattern.source).test(src)) counts[check.key] += 1;
      } else {
        const m = src.match(check.pattern);
        if (m) counts[check.key] += m.length;
      }
    }
  }
  return { counts, scanned };
}

const { counts, scanned } = measure();

if (process.argv.includes("--update")) {
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), counts }, null, 2) + "\n",
  );
  console.log(`Baseline updated from ${scanned} files:\n`);
  for (const c of CHECKS) console.log(`  ${String(counts[c.key]).padStart(5)}  ${c.label}`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error("No baseline found. Run: npm run lint:ui -- --update");
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const regressions = [];
let improved = 0;

console.log(`Design-system ratchet — ${scanned} files, baseline ${baseline.recorded}\n`);
for (const check of CHECKS) {
  const now = counts[check.key];
  const was = baseline.counts[check.key] ?? 0;
  const delta = now - was;
  const mark = delta > 0 ? "UP  " : delta < 0 ? "down" : "    ";
  const shown = delta === 0 ? "" : ` (${delta > 0 ? "+" : ""}${delta})`;
  console.log(`  ${mark} ${String(now).padStart(5)} / ${String(was).padEnd(5)} ${check.label}${shown}`);
  if (delta > 0) regressions.push({ check, now, was });
  if (delta < 0) improved += 1;
}

if (improved) {
  console.log(`\n${improved} pattern(s) improved. Lock it in:  npm run lint:ui -- --update`);
}

if (regressions.length) {
  console.error("\nDesign-system regressions:\n");
  for (const r of regressions) {
    console.error(`  ${r.check.label}: ${r.was} -> ${r.now}`);
    console.error(`    ${r.check.why}\n`);
  }
  console.error(
    "If the new usage is genuinely justified, say so in the commit message and\n" +
      "re-record the baseline with: npm run lint:ui -- --update\n",
  );
  process.exit(1);
}

console.log("\nNo design-system regressions.");
