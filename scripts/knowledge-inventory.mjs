#!/usr/bin/env node
/**
 * Knowledge-base inventory generator.
 *
 * Derives the route + navigation inventory for docs/ozzo-knowledge straight from
 * source, so the knowledge base can be re-checked against the code instead of
 * drifting. It reads three things and never guesses:
 *
 *   1. src/app/**\/page.tsx            → every addressable screen
 *   2. src/lib/plans/surface-gates.ts  → ROUTE_GATES / IMPORT_GATES / CUSTOM_FIELD_GATES
 *   3. src/components/layout/sidebar.tsx (getMenuStructure) → the nav tree + its gates
 *
 * Outputs:
 *   docs/ozzo-knowledge/_generated/routes.json
 *   docs/ozzo-knowledge/_generated/nav.json
 *   docs/ozzo-knowledge/navigation-map.md
 *   docs/ozzo-knowledge/test-matrix.md   (only with --seed; never clobbers results)
 *
 * Usage: node scripts/knowledge-inventory.mjs [--seed]
 *
 * This is a documentation tool. It reads the repo and writes Markdown/JSON under
 * docs/. It touches no application code and makes no network or database calls.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const APP_DIR = join(ROOT, "src", "app");
const OUT_DIR = join(ROOT, "docs", "ozzo-knowledge");
const GEN_DIR = join(OUT_DIR, "_generated");
const SEED = process.argv.includes("--seed");

// ── 1. Routes from the filesystem ────────────────────────────────────────────

/** Every directory holding a page.tsx, as an App Router pathname. */
function collectRoutes(dir, out = []) {
  // The root landing page sits directly in src/app, so it has no parent to find it.
  if (dir === APP_DIR && existsSync(join(dir, "page.tsx"))) out.push(dir);
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (existsSync(join(full, "page.tsx"))) out.push(full);
    collectRoutes(full, out);
  }
  return out;
}

/** src/app/(dashboard)/reports/orders → /reports/orders */
function toPathname(absDir) {
  const rel = relative(APP_DIR, absDir).split(sep);
  const segments = rel.filter((s) => !(s.startsWith("(") && s.endsWith(")")));
  return "/" + segments.join("/");
}

function areaOf(absDir) {
  const rel = relative(APP_DIR, absDir).split(sep)[0];
  if (rel === "(auth)") return "auth";
  if (rel === "(dashboard)") return "dashboard";
  if (rel === "(superadmin)") return "superadmin";
  if (rel === "print") return "print";
  if (rel === "join") return "join";
  return "public";
}

// ── 2. Gates from surface-gates.ts ───────────────────────────────────────────

const gatesSrc = readFileSync(join(ROOT, "src", "lib", "plans", "surface-gates.ts"), "utf8");

/** CATALOG_LINES and friends, resolved to real line arrays. */
const LINE_CONSTANTS = {
  CATALOG_LINES: ["crm", "sfa"],
};

function parseLineList(raw) {
  const trimmed = raw.trim();
  if (LINE_CONSTANTS[trimmed]) return LINE_CONSTANTS[trimmed];
  return [...trimmed.matchAll(/"(crm|wfa|sfa|fsm)"/g)].map((m) => m[1]);
}

/** Pull `line` / `anyLine` / `allLines` / `configModule` out of one object literal. */
function parseGate(body) {
  const gate = {};
  const line = body.match(/\bline:\s*"(crm|wfa|sfa|fsm)"/);
  if (line) gate.line = line[1];
  const anyLine = body.match(/\banyLine:\s*(\[[^\]]*\]|[A-Z_]+)/);
  if (anyLine) gate.anyLine = parseLineList(anyLine[1]);
  const allLines = body.match(/\ballLines:\s*(\[[^\]]*\]|[A-Z_]+)/);
  if (allLines) gate.allLines = parseLineList(allLines[1]);
  const mod = body.match(/\bconfigModule:\s*"([a-z_]+)"/);
  if (mod) gate.configModule = mod[1];
  return Object.keys(gate).length ? gate : undefined;
}

/**
 * The block of text between a named declaration and its closing bracket.
 *
 * `openAfter` matters: `const ROUTE_GATES: readonly (... { prefix: string })[] = [`
 * and `function getMenuStructure(...): MenuNode[] {` both contain a `[` in their
 * TYPE annotation before the real literal starts. Anchoring on `= [` / `return [`
 * skips the annotation.
 */
function sliceBlock(src, startMarker, open, close, openAfter) {
  const at = src.indexOf(startMarker);
  if (at === -1) throw new Error(`marker not found: ${startMarker}`);
  let searchFrom = at;
  if (openAfter) {
    const anchor = src.indexOf(openAfter, at);
    if (anchor === -1) throw new Error(`anchor not found: ${openAfter} after ${startMarker}`);
    searchFrom = anchor;
  }
  const from = src.indexOf(open, searchFrom);
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    if (src[i] === open) depth += 1;
    else if (src[i] === close) {
      depth -= 1;
      if (depth === 0) return src.slice(from + 1, i);
    }
  }
  throw new Error(`unterminated block: ${startMarker}`);
}

/** Top-level `{...}` object literals inside an array/object body. */
function objectLiterals(body) {
  const out = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        out.push({ text: body.slice(start, i + 1), start });
        start = -1;
      }
    }
  }
  return out;
}

const routeGates = objectLiterals(sliceBlock(gatesSrc, "const ROUTE_GATES", "[", "]", "= ["))
  .map(({ text }) => {
    const prefix = text.match(/prefix:\s*"([^"]+)"/);
    if (!prefix) return null;
    return { prefix: prefix[1], gate: parseGate(text) };
  })
  .filter(Boolean)
  // Longest prefix wins, exactly as gateForPath() sorts them.
  .sort((a, b) => b.prefix.length - a.prefix.length);

function gateForPath(pathname) {
  const hit = routeGates.find(
    (g) => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`),
  );
  return hit ? { gate: hit.gate, via: hit.prefix } : { gate: undefined, via: null };
}

/** IMPORT_GATES / CUSTOM_FIELD_GATES: `key: { ... },` maps. */
function parseGateMap(name) {
  const body = sliceBlock(gatesSrc, `export const ${name}`, "{", "}");
  const out = {};
  for (const { text, start } of objectLiterals(body)) {
    const before = body.slice(0, start);
    const key = before.match(/([a-z_]+)\s*:\s*$/m);
    if (key) out[key[1]] = parseGate(text) ?? {};
  }
  return out;
}

const importGates = parseGateMap("IMPORT_GATES");
const customFieldGates = parseGateMap("CUSTOM_FIELD_GATES");

// ── 3. The nav tree from sidebar.tsx ─────────────────────────────────────────

const sidebarSrc = readFileSync(
  join(ROOT, "src", "components", "layout", "sidebar.tsx"),
  "utf8",
);
const menuBody = sliceBlock(sidebarSrc, "export function getMenuStructure", "[", "]", "return [");

function parseNavItem(text, group, conditional) {
  const href = text.match(/href:\s*"([^"]+)"/);
  if (!href) return null;
  const label = text.match(/label:\s*"([^"]+)"/);
  const permission = text.match(/permission:\s*(?:"([^"]+)"|PERMISSIONS\.([A-Z_.]+))/);
  const mod = text.match(/\bmodule:\s*"([a-z_]+)"/);
  return {
    href: href[1],
    label: label ? label[1] : null,
    group,
    permission: permission ? (permission[1] ?? `PERMISSIONS.${permission[2]}`) : null,
    /** `module: "x"` is checked as the right `view_x` — not a module toggle. */
    viewRight: mod ? `view_${mod[1]}` : null,
    gate: parseGate(text),
    beta: /\bbeta:\s*true/.test(text),
    soon: /\bsoon:\s*true/.test(text),
    conditional: conditional || undefined,
  };
}

/** True when this literal sits inside a `...( cond ? [ ... ] : [] )` spread. */
function isConditional(body, start) {
  const before = body.slice(0, start);
  const lastItem = Math.max(before.lastIndexOf("},"), before.lastIndexOf("["));
  return before.slice(lastItem).includes("...(");
}

const navItems = [];
const navGroups = [];
for (const { text } of objectLiterals(menuBody)) {
  if (/type:\s*"spacer"/.test(text)) continue;
  if (/type:\s*"group"/.test(text)) {
    const label = text.match(/label:\s*"([^"]+)"/);
    const groupLabel = label ? label[1] : "(unnamed)";
    const groupGate = parseGate(text.slice(0, text.indexOf("items:")));
    const itemsBody = sliceBlock(text, "items:", "[", "]");
    const items = [];
    for (const item of objectLiterals(itemsBody)) {
      const parsed = parseNavItem(item.text, groupLabel, isConditional(itemsBody, item.start));
      if (parsed) {
        items.push(parsed);
        navItems.push(parsed);
      }
    }
    navGroups.push({ label: groupLabel, gate: groupGate, items: items.map((i) => i.href) });
    continue;
  }
  const parsed = parseNavItem(text, null, false);
  if (parsed) navItems.push(parsed);
}

// ── 4. Settings sections ─────────────────────────────────────────────────────

const settingsSrc = readFileSync(
  join(ROOT, "src", "components", "settings", "settings-sections.ts"),
  "utf8",
);
const sectionsBody = sliceBlock(settingsSrc, "export const SECTION_META", "{", "}");
const settingsSections = objectLiterals(sectionsBody)
  .map(({ text }) => {
    const id = text.match(/\bid:\s*'([a-z_]+)'/);
    if (!id) return null;
    const label = text.match(/label:\s*'([^']+)'/);
    const group = text.match(/group:\s*'([a-z]+)'/);
    const permission = text.match(/permission:\s*PERMISSIONS\.([A-Z_.]+)/);
    const gateMatch = text.match(/gate:\s*\{[^}]*\}/);
    return {
      id: id[1],
      label: label ? label[1] : null,
      rail: group ? group[1] : null,
      permission: permission ? `PERMISSIONS.${permission[1]}` : null,
      gate: gateMatch ? parseGate(gateMatch[0]) : undefined,
    };
  })
  .filter(Boolean);

// ── 5. Assemble ──────────────────────────────────────────────────────────────

const navByHref = new Map();
for (const item of navItems) {
  // A nav href may carry a ?tab= query; index on the path for route matching.
  const path = item.href.split("?")[0];
  if (!navByHref.has(path)) navByHref.set(path, []);
  navByHref.get(path).push(item);
}

const routes = collectRoutes(APP_DIR)
  .map((dir) => {
    const pathname = toPathname(dir);
    const { gate, via } = gateForPath(pathname);
    const nav = navByHref.get(pathname) ?? [];
    return {
      pathname,
      area: areaOf(dir),
      file: relative(ROOT, join(dir, "page.tsx")).split(sep).join("/"),
      dynamic: pathname.includes("["),
      routeGate: gate ?? null,
      routeGateVia: via,
      nav: nav.map((n) => ({
        label: n.label,
        group: n.group,
        permission: n.permission,
        viewRight: n.viewRight,
        gate: n.gate ?? null,
        conditional: n.conditional ?? false,
      })),
      /** No nav entry anywhere: reachable only by URL or by a link in a page. */
      orphan: nav.length === 0,
    };
  })
  .sort((a, b) => a.pathname.localeCompare(b.pathname));

mkdirSync(GEN_DIR, { recursive: true });

const generatedAt = new Date().toISOString().slice(0, 10);
const payload = {
  generatedAt,
  counts: {
    routes: routes.length,
    byArea: routes.reduce((acc, r) => ({ ...acc, [r.area]: (acc[r.area] ?? 0) + 1 }), {}),
    gated: routes.filter((r) => r.routeGate).length,
    orphans: routes.filter((r) => r.orphan).length,
    navItems: navItems.length,
    navGroups: navGroups.length,
    settingsSections: settingsSections.length,
  },
  routes,
};

writeFileSync(join(GEN_DIR, "routes.json"), JSON.stringify(payload, null, 2));
writeFileSync(
  join(GEN_DIR, "nav.json"),
  JSON.stringify(
    { generatedAt, groups: navGroups, items: navItems, settingsSections, importGates, customFieldGates },
    null,
    2,
  ),
);

// ── 6. navigation-map.md ─────────────────────────────────────────────────────

function gateText(gate) {
  if (!gate) return "—";
  const parts = [];
  if (gate.line) parts.push(`line \`${gate.line}\``);
  if (gate.anyLine) parts.push(`any of \`${gate.anyLine.join("/")}\``);
  if (gate.allLines) parts.push(`all of \`${gate.allLines.join("+")}\``);
  if (gate.configModule) parts.push(`module \`${gate.configModule}\``);
  return parts.join(" + ") || "—";
}

const lines = [];
lines.push("# Navigation map and route inventory");
lines.push("");
lines.push(
  `> GENERATED by \`scripts/knowledge-inventory.mjs\` on ${generatedAt}. Do not hand-edit —`,
);
lines.push(
  "> re-run the script. Every row is read from source: the route from `src/app`, the plan",
);
lines.push(
  "> gate from `src/lib/plans/surface-gates.ts`, the menu entry from `getMenuStructure` in",
);
lines.push("> `src/components/layout/sidebar.tsx`.");
lines.push("");
lines.push("**Verification status: VERIFIED IN CODE.** Nothing here was opened in a browser.");
lines.push("");
lines.push("## Totals");
lines.push("");
lines.push("| Measure | Count |");
lines.push("| --- | --- |");
lines.push(`| Page routes | ${payload.counts.routes} |`);
for (const [area, n] of Object.entries(payload.counts.byArea).sort()) {
  lines.push(`| — area \`${area}\` | ${n} |`);
}
lines.push(`| Routes carrying a plan gate | ${payload.counts.gated} |`);
lines.push(`| Routes with no sidebar entry | ${payload.counts.orphans} |`);
lines.push(`| Sidebar destinations | ${payload.counts.navItems} |`);
lines.push(`| Sidebar groups | ${payload.counts.navGroups} |`);
lines.push(`| Settings sections | ${payload.counts.settingsSections} |`);
lines.push("");
lines.push("## How a screen is reached and gated");
lines.push("");
lines.push(
  "Four independent layers decide whether a user gets a screen. All four must pass; they are",
);
lines.push("evaluated in different places and can disagree.");
lines.push("");
lines.push(
  "1. **Plan line** — `crm` / `wfa` / `sfa` / `fsm`, from the account's plan (`PLAN_LINES` in `src/lib/plans/catalog.ts`).",
);
lines.push(
  "2. **Module toggle** — the admin's switch in Organization Settings, already clamped to the plan server-side.",
);
lines.push(
  "3. **Role right** — a permission key resolved by Postgres `has_permission()` (owner/admin bypass).",
);
lines.push("4. **Row-level security** — what data the query is allowed to return at all.");
lines.push("");
lines.push(
  "A `module: \"x\"` field on a nav item is **not** a module toggle: the sidebar turns it into a",
);
lines.push("`view_x` permission check. The module toggle is `configModule`.");
lines.push("");
lines.push("## Sidebar tree");
lines.push("");
for (const group of navGroups) {
  lines.push(`### Group: ${group.label}  (group gate: ${gateText(group.gate)})`);
  lines.push("");
  lines.push("| Label | Href | Needs right | Plan/module gate | Conditional |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const href of group.items) {
    const item = navItems.find((i) => i.href === href && i.group === group.label);
    if (!item) continue;
    const right = item.permission ?? item.viewRight ?? "—";
    lines.push(
      `| ${item.label ?? "—"}${item.beta ? " _(beta)_" : ""}${item.soon ? " _(soon)_" : ""} | \`${item.href}\` | \`${right}\` | ${gateText(item.gate)} | ${item.conditional ? "yes" : "—"} |`,
    );
  }
  lines.push("");
}
lines.push("### Top-level links (no group)");
lines.push("");
lines.push("| Label | Href | Needs right | Plan/module gate |");
lines.push("| --- | --- | --- | --- |");
for (const item of navItems.filter((i) => !i.group)) {
  const right = item.permission ?? item.viewRight ?? "—";
  lines.push(
    `| ${item.label ?? "—"} | \`${item.href}\` | \`${right}\` | ${gateText(item.gate)} |`,
  );
}
lines.push("");
lines.push("## Settings sections (`/settings?tab=<id>`)");
lines.push("");
lines.push("| Tab id | Label | Rail group | Needs right | Plan/module gate |");
lines.push("| --- | --- | --- | --- | --- |");
for (const s of settingsSections) {
  lines.push(
    `| \`${s.id}\` | ${s.label ?? "—"} | ${s.rail ?? "—"} | ${s.permission ?? "— (personal)"} | ${gateText(s.gate)} |`,
  );
}
lines.push("");
lines.push("## Import wizards (`/import/<module>`)");
lines.push("");
lines.push("| Module key | Plan/module gate |");
lines.push("| --- | --- |");
for (const [key, gate] of Object.entries(importGates)) {
  lines.push(`| \`${key}\` | ${gateText(gate)} |`);
}
lines.push("");
lines.push("Keys absent from this table are base imports available on every plan.");
lines.push("");
lines.push("## Custom-field editors (`/custom-fields/<module>`)");
lines.push("");
lines.push("| Module key | Plan/module gate |");
lines.push("| --- | --- |");
for (const [key, gate] of Object.entries(customFieldGates)) {
  lines.push(`| \`${key}\` | ${gateText(gate)} |`);
}
lines.push("");
lines.push("Keys absent from this table are base modules available on every plan.");
lines.push("");
lines.push("## Every page route");
lines.push("");
lines.push("| Route | Area | Route-guard gate | In sidebar as | File |");
lines.push("| --- | --- | --- | --- | --- |");
for (const r of routes) {
  const navText = r.nav.length
    ? r.nav.map((n) => (n.group ? `${n.group} › ${n.label}` : n.label)).join("; ")
    : "_(no menu entry)_";
  lines.push(
    `| \`${r.pathname}\` | ${r.area} | ${gateText(r.routeGate)}${r.routeGateVia && r.routeGateVia !== r.pathname ? ` _(via \`${r.routeGateVia}\`)_` : ""} | ${navText} | \`${r.file}\` |`,
  );
}
lines.push("");

writeFileSync(join(OUT_DIR, "navigation-map.md"), lines.join("\n"));

// ── 7. test-matrix.md (seed only) ────────────────────────────────────────────

const matrixPath = join(OUT_DIR, "test-matrix.md");
if (SEED && !existsSync(matrixPath)) {
  const m = [];
  m.push("# Test matrix — route coverage");
  m.push("");
  m.push(
    `> SEEDED from \`scripts/knowledge-inventory.mjs\` on ${generatedAt}, then maintained by hand.`,
  );
  m.push(
    "> Re-running the generator will NOT overwrite this file. Status values: PASS / FAIL /",
  );
  m.push("> BLOCKED / NOT TESTED.");
  m.push("");
  m.push("Verification is read-only on test tenant **001288**. No form is submitted, no record");
  m.push("is created, changed or deleted, because the local dev server talks to the production");
  m.push("database.");
  m.push("");
  m.push("| Route | Area | Status | Date | Evidence | Notes |");
  m.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of routes) {
    m.push(`| \`${r.pathname}\` | ${r.area} | NOT TESTED | — | — | — |`);
  }
  m.push("");
  writeFileSync(matrixPath, m.join("\n"));
}

// ── 8. Console summary ───────────────────────────────────────────────────────

console.log(`routes:            ${payload.counts.routes}`);
console.log(`  by area:         ${JSON.stringify(payload.counts.byArea)}`);
console.log(`  plan-gated:      ${payload.counts.gated}`);
console.log(`  no menu entry:   ${payload.counts.orphans}`);
console.log(`nav destinations:  ${payload.counts.navItems} in ${payload.counts.navGroups} groups`);
console.log(`settings sections: ${payload.counts.settingsSections}`);
console.log(`import gates:      ${Object.keys(importGates).length}`);
console.log(`custom-field gates:${Object.keys(customFieldGates).length}`);
console.log(`wrote: docs/ozzo-knowledge/navigation-map.md + _generated/{routes,nav}.json`);
if (SEED) console.log(`seeded: docs/ozzo-knowledge/test-matrix.md (if absent)`);
