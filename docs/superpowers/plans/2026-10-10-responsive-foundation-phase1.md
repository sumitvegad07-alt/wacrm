# Responsive Foundation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every page of the admin portal reachable, readable and tappable on phones and tablets, and stop old browsers rendering a colourless UI — without changing anything at 1024px and above.

**Architecture:** Six tasks. Task 1 builds the Playwright harness first, so every later task is measured rather than claimed. Task 2 adds plain-colour fallbacks ahead of the `oklch` values in `globals.css` via a one-time generator script plus a vitest guard. Task 3 changes the app shell's scroll model below 1024px — the riskiest change, done only once the harness can prove it. Tasks 4–6 add touch-sized controls, stop sideways page scroll, and add the old-browser gate.

**Tech Stack:** Next.js 16.2.6, React 19.2.4, Tailwind CSS 4.3.1, TypeScript strict, vitest (unit), Playwright (new — browser tests), Supabase.

**Spec:** `docs/superpowers/specs/2026-10-10-responsive-cross-browser-admin-portal-design.md`

## Global Constraints

- **Nothing changes at 1024px and above.** Every change is gated behind a `max-width` media query, or written as "small-screen value, then the existing value from `md:` up". The `laptop` (1440×900) Playwright project is the regression guard.
- **Pinch-zoom stays enabled.** Never set `maximumScale` or `userScalable: false`.
- Tier 1 browsers: Chrome 111+, Safari 16.4+, Edge 111+, Firefox 128+, Samsung Internet 22+.
- Tier 2 browsers (must work, may look plainer): Chrome/Android WebView 90–110, Safari 15.0–16.3, Firefox 100–127, Samsung Internet 14–21.
- Narrow floor for testing: **320px**.
- `@property` is missing below Safari 16.4 / Firefox 128 and **cannot** be polyfilled. Plainer gradients, shadows and transforms on Tier 2 are accepted, not worked around.
- **The Playwright suite is read-only.** `.env.local` points at the Mumbai production database (`ltigfpywdbfilsagtpyd`), so no test may create, edit or delete a record. Tests navigate and measure only.
- No `any` without a justifying comment (repo rule). TypeScript is strict.
- `vitest.config.ts` only picks up `src/**/*.test.ts(x)`. Playwright specs are named `*.spec.ts` and live in `tests/`, so the two runners never collide.
- Repo rule: never write a report asserting a result you did not actually run.

---

### Task 1: Playwright harness and the read-only layout sweep

Builds the measuring instrument. Everything after this task is verified by it.

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/responsive/fixtures/viewports.ts`
- Create: `tests/responsive/fixtures/routes.ts`
- Create: `tests/responsive/auth.setup.ts`
- Create: `tests/responsive/no-horizontal-scroll.spec.ts`
- Create: `tests/responsive/bottom-control-reachable.spec.ts`
- Create: `tests/responsive/touch-targets.spec.ts`
- Create: `tests/responsive/README.md`
- Create: `.env.test.local.example`
- Modify: `package.json` (add `@playwright/test` devDependency + three scripts)
- Modify: `.gitignore` (ignore Playwright output, saved session, `.env.test.local`)

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `VIEWPORTS: readonly { name: string; width: number; height: number }[]` from `tests/responsive/fixtures/viewports.ts`
  - `staticDashboardRoutes(): string[]` from `tests/responsive/fixtures/routes.ts`
  - npm scripts `test:responsive` (smoke scope, all engines), `test:responsive:all` (every static route, Chromium), `test:responsive:laptop` (the regression guard), `test:responsive:report`
  - `SMOKE_ROUTES: readonly string[]` from `tests/responsive/fixtures/routes.ts`
  - The `RESPONSIVE_SCOPE` environment variable (`smoke` by default, `all` for the full sweep)
  - A saved login session at `tests/responsive/.auth/user.json`

- [ ] **Step 1: Install Playwright and its browsers**

```bash
npm install --save-dev @playwright/test@1.56.1
npx playwright install chromium firefox webkit
```

Expected: three browsers download (roughly 200MB). If `npx playwright install` fails behind a proxy, stop and report it — do not carry on with a partial browser set.

- [ ] **Step 2: Add the ignore rules**

(The npm scripts are added in Step 5, once the two run scopes exist.)

Append to `.gitignore`:

```gitignore
# playwright
/test-results/
/playwright-report/
/blob-report/
/tests/responsive/.auth/
.env.test.local
```

- [ ] **Step 3: Write the viewport list**

Create `tests/responsive/fixtures/viewports.ts`:

```ts
/**
 * The six screen sizes the portal must work at, from the approved spec.
 *
 * `laptop` is the regression guard: nothing in the responsive programme may
 * change how the app renders at that size, so every suite runs there too and
 * its results must stay identical across the whole programme.
 */
export const VIEWPORTS = [
  { name: "phone-small", width: 320, height: 568 },
  { name: "phone", width: 390, height: 844 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "laptop", width: 1440, height: 900 },
] as const;

export type Viewport = (typeof VIEWPORTS)[number];
```

- [ ] **Step 4: Write the route inventory**

Create `tests/responsive/fixtures/routes.ts`. It derives routes from the App Router tree, so adding a page automatically adds it to the sweep and the list can never drift out of date:

```ts
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const DASHBOARD_ROOT = join(process.cwd(), "src", "app", "(dashboard)");

/**
 * Every dashboard route that can be opened without knowing a record id.
 *
 * Directories named `[something]` are skipped: a detail page needs a real
 * record, and this suite is read-only against the production database, so it
 * must not depend on any particular row existing. Detail pages are covered
 * per-module in the Phase 3 batches instead.
 */
export function staticDashboardRoutes(): string[] {
  const routes: string[] = [];
  walk(DASHBOARD_ROOT, routes);
  return routes.sort();
}

function walk(dir: string, routes: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry.startsWith("[")) continue;
      if (entry.startsWith("(")) continue; // route group, not a URL segment
      walk(full, routes);
      continue;
    }
    if (entry !== "page.tsx") continue;
    const segments = dir.slice(DASHBOARD_ROOT.length).split(sep).filter(Boolean);
    if (segments.length === 0) continue; // the group has no page of its own
    routes.push("/" + segments.join("/"));
  }
}
```

- [ ] **Step 5: Add the smoke subset**

The full matrix is too big to run on every change: roughly 90 static routes × 3 suites × 18 projects is about 4,800 tests. So the suite has two scopes. Append to `tests/responsive/fixtures/routes.ts`:

```ts
/**
 * A representative slice of the app, used for the all-engine runs.
 *
 * One of each shape: a plain table page, a wide table, a create form, a
 * settings page with a side rail, a dashboard of charts, a wizard, a map
 * page, a kanban board, a report, and the chat-shaped inbox. If a layout rule
 * is wrong, it is almost certainly wrong on one of these.
 */
export const SMOKE_ROUTES = [
  "/contacts",
  "/orders",
  "/leads/new",
  "/settings",
  "/dashboard",
  "/import",
  "/location-tracking/all-locations",
  "/pipelines",
  "/reports/sales",
  "/inbox",
] as const;
```

Then add this to the top of each of the three spec files written in Steps 8–10, so a full-matrix run stays practical:

```ts
/**
 * `RESPONSIVE_SCOPE=smoke` (the default) runs the 10 representative routes, so
 * the all-engine matrix finishes in minutes. `RESPONSIVE_SCOPE=all` runs every
 * static route — use it on Chromium for a full sweep, and before declaring a
 * phase complete.
 */
const routes =
  process.env.RESPONSIVE_SCOPE === "all" ? staticDashboardRoutes() : [...SMOKE_ROUTES];
```

and iterate `routes` instead of `staticDashboardRoutes()`. Update the import in each spec to `import { SMOKE_ROUTES, staticDashboardRoutes } from "./fixtures/routes";`.

Then make the scopes explicit in `package.json`:

```json
"test:responsive": "playwright test",
"test:responsive:all": "cross-env RESPONSIVE_SCOPE=all playwright test --project=phone-chromium --project=tablet-portrait-chromium --project=laptop-chromium",
"test:responsive:laptop": "playwright test --project=laptop-chromium",
"test:responsive:report": "playwright show-report"
```

`cross-env` is needed because the repo is developed on Windows, where `VAR=x cmd` does not work. Install it: `npm install --save-dev cross-env@7.0.3`.

- [ ] **Step 6: Write the Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";
import { VIEWPORTS } from "./tests/responsive/fixtures/viewports";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const STORAGE_STATE = "tests/responsive/.auth/user.json";

/**
 * Engines: Chromium, Firefox and WebKit (Safari's engine) at six sizes.
 *
 * The layout suites run on all three engines at every size. WebKit is how
 * iPhone and iPad are covered: same engine, so CSS and layout behaviour is
 * accurate, but it does not reproduce iOS address-bar or keyboard behaviour —
 * that needs a real device, as the spec says.
 */
const engines = [
  { key: "chromium", use: devices["Desktop Chrome"] },
  { key: "firefox", use: devices["Desktop Firefox"] },
  { key: "webkit", use: devices["Desktop Safari"] },
] as const;

export default defineConfig({
  testDir: "./tests/responsive",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    ...engines.flatMap(({ key, use }) =>
      VIEWPORTS.map((vp) => ({
        name: `${vp.name}-${key}`,
        use: {
          ...use,
          viewport: { width: vp.width, height: vp.height },
          storageState: STORAGE_STATE,
        },
        dependencies: ["setup"],
        testIgnore: /auth\.setup\.ts/,
      })),
    ),
  ],
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
```

- [ ] **Step 7: Write the login setup**

Create `tests/responsive/auth.setup.ts`. Every dashboard route is behind auth, so the suite logs in once and reuses the session:

```ts
import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const STORAGE_STATE = path.join(__dirname, ".auth", "user.json");

setup("log in once and save the session", async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "Set E2E_EMAIL and E2E_PASSWORD in .env.test.local (see .env.test.local.example). " +
        "These tests never create, edit or delete anything — they only open pages and " +
        "measure them — but every dashboard route is behind a login.",
    );
  }

  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page).toHaveURL(/\/(dashboard|getting-started)/, { timeout: 30_000 });
  await page.context().storageState({ path: STORAGE_STATE });
});
```

Create `.env.test.local.example`:

```dotenv
# Credentials for the read-only Playwright layout sweep.
# Copy to .env.test.local (git-ignored) and fill in.
#
# IMPORTANT: .env.local points at the Mumbai PRODUCTION database, so this
# suite is read-only by design. It opens pages and measures them. It never
# creates, edits or deletes a record. Use an account whose data you are happy
# to have read repeatedly.
E2E_EMAIL=
E2E_PASSWORD=

# Optional: point the suite at an already-running dev server.
# E2E_BASE_URL=http://localhost:3000
```

- [ ] **Step 8: Write the failing sideways-scroll test**

Create `tests/responsive/no-horizontal-scroll.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { staticDashboardRoutes } from "./fixtures/routes";

/**
 * A page must never be wider than the window. One pixel of slack absorbs
 * sub-pixel rounding, which differs between the three engines.
 */
for (const route of staticDashboardRoutes()) {
  test(`${route} does not scroll sideways`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");

    const { scrollWidth, clientWidth, widest } = await page.evaluate(() => {
      const doc = document.documentElement;
      let widest = "";
      let worst = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const right = el.getBoundingClientRect().right;
        if (right > worst) {
          worst = right;
          widest =
            el.tagName.toLowerCase() +
            (el.className && typeof el.className === "string"
              ? "." + el.className.split(/\s+/).slice(0, 3).join(".")
              : "");
        }
      }
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, widest };
    });

    expect(
      scrollWidth,
      `${route} is ${scrollWidth - clientWidth}px wider than the window. Widest element: ${widest}`,
    ).toBeLessThanOrEqual(clientWidth + 1);
  });
}
```

- [ ] **Step 9: Write the failing bottom-control test**

Create `tests/responsive/bottom-control-reachable.spec.ts`. This is the guard on Task 3:

```ts
import { test, expect } from "@playwright/test";
import { staticDashboardRoutes } from "./fixtures/routes";

/**
 * The last interactive control on a page must be scrollable into view AND
 * actually clickable once there.
 *
 * This is the test for the bug the whole programme starts from: the shell is
 * locked to 100vh with overflow hidden, so on a phone the bottom strip of
 * every page (pagination, Save) sits under the browser's address bar and
 * cannot be reached at all.
 */
for (const route of staticDashboardRoutes()) {
  test(`${route} lets you reach its bottom control`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState("networkidle");

    const controls = page.locator("button:visible, a[href]:visible");
    const count = await controls.count();
    test.skip(count === 0, "no interactive controls on this page");

    const last = controls.nth(count - 1);
    await last.scrollIntoViewIfNeeded();

    const reachable = await last.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const withinViewport =
        r.bottom <= window.innerHeight + 1 && r.top >= -1 && r.height > 0;
      const midX = r.x + r.width / 2;
      const midY = r.y + r.height / 2;
      const onTop = document.elementFromPoint(midX, midY);
      const clickable = !!onTop && (onTop === el || el.contains(onTop) || onTop.contains(el));
      return { withinViewport, clickable, bottom: r.bottom, innerHeight: window.innerHeight };
    });

    expect(
      reachable.withinViewport,
      `${route}: bottom control sits at y=${reachable.bottom} but the window is only ${reachable.innerHeight} tall, and scrolling did not bring it in`,
    ).toBe(true);
    expect(reachable.clickable, `${route}: bottom control is covered by something else`).toBe(true);
  });
}
```

- [ ] **Step 10: Write the failing touch-target test**

Create `tests/responsive/touch-targets.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { staticDashboardRoutes } from "./fixtures/routes";

const TOUCH_MIN = 44;

/**
 * Below 768px every control needs a 44px tap target.
 *
 * Three controls are deliberately small on screen and grow their tap area with
 * an `::after` overlay instead — the pattern radio-group.tsx already uses in
 * this repo. For those we measure the overlay, not the visible box.
 */
const PSEUDO_TARGET_SLOTS = new Set(["checkbox", "radio-group-item", "switch"]);

test.describe("touch targets", () => {
  for (const route of staticDashboardRoutes()) {
    test(`${route} has thumb-sized controls`, async ({ page }, testInfo) => {
      const width = testInfo.project.use.viewport?.width ?? 0;
      test.skip(width >= 768, "44px rule applies below 768px only");

      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const tooSmall = await page.evaluate(
        ({ min, pseudoSlots }) => {
          const offenders: string[] = [];
          const nodes = document.querySelectorAll<HTMLElement>(
            "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='menuitem']",
          );
          for (const el of Array.from(nodes)) {
            const box = el.getBoundingClientRect();
            if (box.width === 0 || box.height === 0) continue; // hidden

            const slot = el.getAttribute("data-slot") ?? "";
            let { width, height } = box;

            if (pseudoSlots.includes(slot)) {
              const after = getComputedStyle(el, "::after");
              const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : 0);
              width += Math.abs(px(after.left)) + Math.abs(px(after.right));
              height += Math.abs(px(after.top)) + Math.abs(px(after.bottom));
            }

            if (width < min || height < min) {
              offenders.push(
                `${el.tagName.toLowerCase()}${slot ? `[${slot}]` : ""} ` +
                  `"${(el.textContent ?? "").trim().slice(0, 25)}" ` +
                  `${Math.round(width)}x${Math.round(height)}`,
              );
            }
          }
          return offenders;
        },
        { min: TOUCH_MIN, pseudoSlots: [...PSEUDO_TARGET_SLOTS] },
      );

      expect(tooSmall, `${route} has controls below ${TOUCH_MIN}px:\n${tooSmall.join("\n")}`).toEqual([]);
    });
  }
});
```

- [ ] **Step 11: Confirm the route inventory finds the real pages, then run the suite and confirm it FAILS**

First check the inventory through the same code path the suite uses, so there is no separate script to trust:

```bash
npx cross-env RESPONSIVE_SCOPE=all playwright test --project=laptop-chromium no-horizontal-scroll.spec.ts --list | tail -3
```

Expected: a total in the 85–100 range (124 pages, minus the `[id]` ones) with real paths such as `/announcements` and `/catalog/categories` listed. A total of 0 means `DASHBOARD_ROOT` is wrong — fix that before going on, or every later task will be verified against an empty suite.

Then run the smoke scope for real:

```bash
npm run test:responsive -- --project=phone-chromium --reporter=list
```

Expected: the setup project logs in, then **failures**. Specifically, `bottom-control-reachable` and `touch-targets` should fail on many routes — that is the bug this programme exists to fix, now measured instead of described. Record the failing counts; they are the baseline.

If instead the setup project fails, fix the login before going further: the whole suite depends on it.

- [ ] **Step 12: Run the laptop project and confirm it PASSES**

```bash
npm run test:responsive:laptop -- --reporter=list
```

Expected: PASS, or a small number of pre-existing failures. Write the exact result into `tests/responsive/README.md` as the "before" baseline — every later task must leave this number unchanged or better.

- [ ] **Step 13: Write the harness README**

Create `tests/responsive/README.md` covering: what the suite checks, the six viewports and three engines, that it is **read-only because `.env.local` points at production**, how to supply `E2E_EMAIL`/`E2E_PASSWORD`, how to run one project, how to open the HTML report, and the recorded laptop baseline from Step 12.

- [ ] **Step 14: Commit**

```bash
git add playwright.config.ts tests/ .env.test.local.example .gitignore package.json package-lock.json
git commit -m "test: add read-only Playwright layout sweep across 3 engines and 6 screen sizes

Measures what the responsive programme has to fix: sideways scroll, whether a
page's bottom control can be reached, and 44px tap targets. Read-only, because
.env.local points at the production database.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Plain-colour fallbacks for every oklch token

**Files:**
- Create: `scripts/add-color-fallbacks.mjs`
- Create: `src/lib/theme/color-fallbacks.test.ts`
- Modify: `src/app/globals.css` (adds one fallback line before each of the 120 `oklch()` declarations; also fixes two broken `hsl(var(--border))` uses)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `src/app/globals.css` where every custom property whose value is `oklch(...)` is preceded by the same property set to a `#rrggbb` or `rgba(...)` equivalent. Task 6's gate and all later tasks rely on this holding.

- [ ] **Step 1: Write the failing guard test**

Create `src/lib/theme/color-fallbacks.test.ts`. It lives under `src/` so plain `npm test` picks it up and a future edit cannot silently drop a fallback:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const GLOBALS = join(process.cwd(), "src", "app", "globals.css");

/** `  --background: oklch(0.13 0.01 260);` → `--background` */
const OKLCH_DECL = /^\s*(--[a-z0-9-]+)\s*:\s*oklch\(/i;
const ANY_DECL = /^\s*(--[a-z0-9-]+)\s*:\s*(.+);\s*$/i;

describe("globals.css colour fallbacks", () => {
  const lines = readFileSync(GLOBALS, "utf8").split("\n");

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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/theme/color-fallbacks.test.ts
```

Expected: FAIL. The first test should report roughly 120 tokens with no fallback. The second should report the two `hsl(var(--border))` / `hsl(var(--muted-foreground))` lines in the `.custom-scrollbar` block near the end of `globals.css`.

- [ ] **Step 3: Write the generator script**

Create `scripts/add-color-fallbacks.mjs`. It converts OKLCH to sRGB with the standard Oklab matrices and rewrites `globals.css` in place:

```js
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
    const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(encoded * 255)));
  });
}

const num = (raw) => (raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw));

const lines = readFileSync(GLOBALS, "utf8").split("\n");
const out = [];
const added = [];

lines.forEach((line, i) => {
  const match = OKLCH_DECL.exec(line);
  if (!match) {
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
  added.push(`${name}  ${line.trim()}  ->  ${fallback.trim()}`);
});

if (!apply) {
  console.log(added.join("\n"));
  console.log(`\n${added.length} fallbacks would be added. Re-run with --apply to write.`);
} else {
  writeFileSync(GLOBALS, out.join("\n"), "utf8");
  console.log(`${added.length} fallbacks written to ${GLOBALS}`);
}
```

- [ ] **Step 4: Dry-run the script and sanity-check three conversions by eye**

```bash
node scripts/add-color-fallbacks.mjs | head -20
```

Expected: about 120 proposed lines. Check three by eye before applying:
- `--background: oklch(0.13 0.01 260)` is a very dark blue-grey, so the hex must be near `#15181d` — a dark value, not light.
- `--foreground: oklch(0.985 0 0)` is near-white, so near `#fcfcfc`.
- `--primary-soft: oklch(0.526 0.247 293 / 0.12)` must become an `rgba(...)` ending in `, 0.12)` — alpha must survive.

If any of those three look wrong, stop: the conversion maths is wrong and every one of the 120 values will be wrong too.

- [ ] **Step 5: Apply the script**

```bash
node scripts/add-color-fallbacks.mjs --apply
```

- [ ] **Step 6: Fix the two broken hsl() wrappers by hand**

In `src/app/globals.css`, the `.custom-scrollbar` block wraps theme tokens in `hsl()`. These tokens hold complete colours, not bare HSL channels, so the declarations are invalid and render nothing today. Replace:

```css
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: hsl(var(--border));
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: hsl(var(--muted-foreground));
}
```

with:

```css
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--muted-foreground);
}
```

- [ ] **Step 7: Run the guard test to verify it passes**

```bash
npx vitest run src/lib/theme/color-fallbacks.test.ts
```

Expected: both tests PASS.

- [ ] **Step 8: Verify the live UI is unchanged on a modern browser**

```bash
npm run test:responsive:laptop -- --reporter=list
```

Expected: the same result recorded in Task 1 Step 12. Modern browsers take the `oklch` line, so nothing should look different. Then open the app and confirm by eye that all five accent themes and both light and dark mode still render — the fallback lines must not have displaced a token into the wrong block.

- [ ] **Step 9: Commit**

```bash
git add scripts/add-color-fallbacks.mjs src/lib/theme/color-fallbacks.test.ts src/app/globals.css
git commit -m "fix: give every oklch colour a plain-colour fallback

Chrome and Android WebView 90-110, Firefox 100-112 and Safari below 15.4
cannot read oklch and were rendering the whole UI with no colours. A plain
colour on the line above survives there; modern browsers still take the oklch.

Also fixes two hsl(var(--token)) declarations in the scrollbar block, which
were invalid and rendering nothing on every browser.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Release the locked scroll model below 1024px

The riskiest change in the programme. It is third so the harness from Task 1 can prove it.

**Files:**
- Modify: `src/app/globals.css` (add the `app-shell`, `app-main` and safe-area classes)
- Modify: `src/app/layout.tsx:69-71` (the `viewport` export)
- Modify: `src/app/(dashboard)/dashboard-shell.tsx:270-278` (the shell and `<main>`)
- Modify: `src/components/layout/header.tsx:105` (sticky below `lg`, safe-area padding)
- Modify: `src/app/(superadmin)/admin/admin-shell.tsx` (same shell treatment)

**Interfaces:**
- Consumes: the Task 1 suites, which must go from failing to passing here.
- Produces: CSS classes `app-shell`, `app-main`, `safe-bottom`, `safe-top` in `globals.css`, used by both shells.

- [ ] **Step 1: Confirm the failing state and record the number**

```bash
npm run test:responsive -- --project=phone-chromium bottom-control-reachable.spec.ts --reporter=list
```

Expected: FAIL on many routes. Write down how many. That number must become zero by Step 7.

- [ ] **Step 2: Add the shell classes to globals.css**

Add inside the existing `@layer base { … }` block in `src/app/globals.css`:

```css
  /* ---- App shell height and scrolling ----
   *
   * Below 1024px the page scrolls normally. A locked 100vh shell fights the
   * mobile browser: 100vh is taller than the visible area, the address bar
   * never collapses, and the bottom strip of every page (pagination, Save)
   * ends up under it, unreachable because the shell has overflow hidden.
   *
   * At 1024px and up the original locked shell is restored exactly: full
   * height, hidden overflow, inner scrolling. Nothing changes on a laptop.
   *
   * The duplicate height declarations are the Tier 2 fallback — a browser
   * without dvh keeps the vh line. */
  .app-shell {
    min-height: 100vh;
    min-height: 100dvh;
  }

  .app-main {
    /* page-level scrolling on small screens */
    overflow: visible;
  }

  @media (min-width: 64rem) {
    .app-shell {
      height: 100vh;
      height: 100dvh;
      min-height: 0;
      overflow: hidden;
    }

    .app-main {
      overflow-y: auto;
    }
  }

  /* iPhone notch and home bar. Only ever adds padding, so a device without
   * safe areas is unaffected (env() falls back to 0px). */
  .safe-top {
    padding-top: env(safe-area-inset-top, 0px);
  }

  .safe-bottom {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
```

- [ ] **Step 3: Update the viewport export**

In `src/app/layout.tsx`, replace:

```tsx
export const viewport: Viewport = {
  themeColor: "#0f172a",
};
```

with:

```tsx
export const viewport: Viewport = {
  themeColor: "#0f172a",
  // Draw into the notch area so the app fills an iPhone screen; the
  // `safe-top` / `safe-bottom` classes keep content clear of the notch and
  // the home bar. Next.js already supplies width=device-width,
  // initial-scale=1, and we deliberately do NOT set maximumScale or
  // userScalable: pinch-zoom must keep working for anyone with weak eyesight.
  viewportFit: "cover",
  // The Android keyboard should push content up rather than cover the field
  // being typed into.
  interactiveWidget: "resizes-content",
};
```

- [ ] **Step 4: Change the dashboard shell**

In `src/app/(dashboard)/dashboard-shell.tsx`, replace:

```tsx
    <div className="flex h-screen overflow-hidden bg-background">
```

with:

```tsx
    <div className="app-shell flex flex-col bg-background lg:flex-row">
```

and replace:

```tsx
        <main className="flex-1 overflow-y-auto p-3 pb-6 sm:p-4 sm:pb-6">
```

with:

```tsx
        <main className="app-main safe-bottom flex-1 p-3 pb-6 sm:p-4 sm:pb-6">
```

Also, in the same file, change the focus-mode branch:

```tsx
        <div className="h-screen overflow-y-auto bg-background">
```

to:

```tsx
        <div className="app-shell app-main safe-bottom bg-background">
```

and the expired-subscription branch:

```tsx
      <div className="flex h-screen items-center justify-center bg-background px-4">
```

to:

```tsx
      <div className="app-shell flex items-center justify-center bg-background px-4">
```

- [ ] **Step 5: Make the header sticky below lg**

In `src/components/layout/header.tsx`, replace:

```tsx
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:px-6">
```

with:

```tsx
    <header className="safe-top sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 lg:static lg:px-6">
```

The header must stay reachable once the page scrolls as a whole. At `lg` it returns to `static`, which is what it is today.

- [ ] **Step 6: Give the superadmin shell the same treatment**

`src/app/(superadmin)/admin/admin-shell.tsx` has the same three patterns. Replace, at line 89:

```tsx
    <div className="flex h-screen overflow-hidden bg-background">
```

with:

```tsx
    <div className="app-shell flex flex-col bg-background lg:flex-row">
```

at line 158:

```tsx
      <main className="flex-1 overflow-y-auto p-6">
```

with:

```tsx
      <main className="app-main safe-bottom flex-1 p-4 sm:p-6">
```

and at line 75 (the loading state):

```tsx
      <div className="flex h-screen items-center justify-center bg-background">
```

with:

```tsx
      <div className="app-shell flex items-center justify-center bg-background">
```

Leave the `<nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">` at line 106 alone — that is the sidebar's own list scrolling inside the drawer, which is correct on every size.

- [ ] **Step 7: Run the bottom-control suite and verify it now passes**

```bash
npm run test:responsive -- --project=phone-chromium --project=phone-webkit bottom-control-reachable.spec.ts --reporter=list
```

Expected: PASS on every route, on both engines. Compare with the number from Step 1 and state both in the commit.

- [ ] **Step 8: Run the laptop guard**

```bash
npm run test:responsive:laptop -- --reporter=list
```

Expected: identical to the Task 1 Step 12 baseline. If anything regressed, the `@media (min-width: 64rem)` block is not restoring the locked shell — fix that before committing, because "nothing changes on laptop" is a hard constraint.

- [ ] **Step 9: Look at it**

Open the app in the browser pane at 390×844 and at 1440×900. On the phone size, confirm: the page scrolls as one, the header stays put, the bottom of a long list is reachable, and nothing hides under the address bar. On laptop, confirm it is unchanged. Keep both screenshots for the user.

- [ ] **Step 10: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx "src/app/(dashboard)/dashboard-shell.tsx" src/components/layout/header.tsx "src/app/(superadmin)/admin/admin-shell.tsx"
git commit -m "fix: let pages scroll normally on phones and tablets

The shell was locked to h-screen with overflow hidden. On a phone 100vh is
taller than the visible area, so the bottom strip of every page - pagination,
Save buttons - sat under the browser address bar and could not be scrolled
into view at all.

Below 1024px the page now scrolls as one, with a sticky header and safe-area
padding for the iPhone notch and home bar. At 1024px and up the original
locked shell is restored exactly, and the laptop test baseline is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Thumb-sized controls below 768px

**Files:**
- Modify: `src/components/ui/input.tsx:12`
- Modify: `src/components/ui/textarea.tsx:10`
- Modify: `src/components/ui/button.tsx:22-35` (the `size` variants)
- Modify: `src/components/ui/select.tsx:44` (the trigger)
- Modify: `src/components/ui/checkbox.tsx:19`
- Modify: `src/components/ui/switch.tsx:18`

**Interfaces:**
- Consumes: the `touch-targets.spec.ts` suite from Task 1.
- Produces: no new exports. Two patterns other tasks must follow — (a) form controls grow their height below `md`, written as `h-11 md:h-8`; (b) small controls keep their size and grow their tap area with an `::after` overlay, matching the pattern already in `radio-group.tsx:23`.

- [ ] **Step 1: Confirm the failing state and record the number**

```bash
npm run test:responsive -- --project=phone-chromium touch-targets.spec.ts --reporter=list
```

Expected: FAIL, listing controls at 32px, 28px and 16px. Record the count.

- [ ] **Step 2: Grow the text inputs**

In `src/components/ui/input.tsx`, change `h-8` to `h-11 md:h-8` and `px-2.5` to `px-3 md:px-2.5`. The existing `text-base md:text-sm` already prevents iPhone auto-zoom and must stay.

In `src/components/ui/textarea.tsx`, change `min-h-16` to `min-h-24 md:min-h-16`.

- [ ] **Step 3: Grow the select trigger**

In `src/components/ui/select.tsx`, in the trigger class string, change:

```
data-[size=default]:h-8 data-[size=sm]:h-7
```

to:

```
data-[size=default]:h-11 data-[size=default]:md:h-8 data-[size=sm]:h-11 data-[size=sm]:md:h-7
```

- [ ] **Step 4: Grow the button sizes**

In `src/components/ui/button.tsx`, inside the `size` variants, make each the mobile height first and the current height from `md:` up:

```ts
      size: {
        default:
          "h-11 md:h-8 gap-1.5 px-3 md:px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-11 md:h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-11 md:h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 md:h-9 gap-1.5 px-3 md:px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-11 md:size-8",
        "icon-xs":
          "size-11 md:size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-11 md:size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-11 md:size-9",
      },
```

**Expect this to crowd dense toolbars on phones** — most obviously the table toolbar, which stacks several `size="sm"` and `icon-sm` buttons in one row. That crowding is fixed in Phase 2, which folds those toolbars into a sheet. Do not try to fix it here; the sideways-scroll suite will flag any case where crowding actually breaks the layout, and only those need attention now.

- [ ] **Step 5: Grow the tap area of the checkbox and switch**

These two must keep their visible size — a 44px checkbox looks broken. Use the `::after` overlay already used by `radio-group.tsx:23`.

In `src/components/ui/checkbox.tsx`, change the first class line from:

```
"peer size-4 shrink-0 cursor-pointer rounded-[4px] border border-primary/50 bg-card shadow-sm transition-colors",
```

to:

```
"peer relative size-4 shrink-0 cursor-pointer rounded-[4px] border border-primary/50 bg-card shadow-sm transition-colors",
// Tap area, not visible size: 16px box with a 44px hit region on touch.
// Same pattern as radio-group.tsx. `md:after:hidden` keeps the desktop
// pointer behaviour exactly as it was.
"after:absolute after:-inset-x-3.5 after:-inset-y-3.5 after:content-[''] md:after:hidden",
```

In `src/components/ui/switch.tsx`, change:

```
"inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
```

to:

```
"relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
"after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] md:after:hidden",
```

- [ ] **Step 6: Run the touch-target suite and verify it passes**

```bash
npm run test:responsive -- --project=phone-chromium --project=phone-small-chromium touch-targets.spec.ts --reporter=list
```

Expected: PASS. Any remaining offender is a one-off button in a page rather than a shared component — list those in the commit message; they belong to the Phase 3 batch for their module, not here.

- [ ] **Step 7: Run the sideways-scroll suite to catch new crowding**

```bash
npm run test:responsive -- --project=phone-small-chromium no-horizontal-scroll.spec.ts --reporter=list
```

Expected: no NEW failures versus the Task 1 baseline. If bigger buttons have pushed a toolbar past the window edge, fix that toolbar by letting it wrap (`flex-wrap`), not by shrinking the buttons back.

- [ ] **Step 8: Run the laptop guard and the unit tests**

```bash
npm run test:responsive:laptop -- --reporter=list
npm run typecheck
npm test
```

Expected: the laptop baseline unchanged (every change is `md:`-gated, so desktop output is identical), typecheck clean, unit tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/input.tsx src/components/ui/textarea.tsx src/components/ui/button.tsx src/components/ui/select.tsx src/components/ui/checkbox.tsx src/components/ui/switch.tsx
git commit -m "fix: thumb-sized controls on phones

Inputs were 32px, select triggers 28px and checkboxes 16px - all below the
44px both Apple and Google ask for. Form controls and buttons now start at
44px and drop to the existing compact size from 768px up. Checkbox and switch
keep their visible size and grow only their tap area, the pattern
radio-group.tsx already used.

Six shared files, so it covers all 465 components. Laptop rendering is
unchanged: every rule is md:-gated.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Stop sideways page scroll and fix the fixed-width offenders

**Files:**
- Modify: `src/app/globals.css` (one rule in `@layer base`)
- Modify: `src/app/(dashboard)/field-staff/page.tsx:134`
- Modify: `src/app/(dashboard)/leads/[id]/page.tsx:416`
- Modify: `src/app/(dashboard)/location-tracking/dashboard/page.tsx:738`
- Modify: `src/components/import/import-wizard.tsx:491`

**Interfaces:**
- Consumes: `no-horizontal-scroll.spec.ts` from Task 1.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Confirm the failing state and list the offenders**

```bash
npm run test:responsive -- --project=phone-small-chromium no-horizontal-scroll.spec.ts --reporter=list
```

Expected: FAIL on some routes. Each failure message names the widest element, which is the thing to fix. Record the list — Steps 3 and 4 only cover the ones already known from the audit; the test may well find more.

- [ ] **Step 2: Add the page-level rule**

In `src/app/globals.css`, inside `@layer base`, add to the existing `html` rule block area:

```css
  html,
  body {
    /* `clip`, never `hidden`: overflow:hidden on body breaks position:sticky,
     * which already bit us on the marketing site. `clip` stops sideways
     * scrolling without creating a scroll container. */
    overflow-x: clip;
  }
```

This is a safety net, not the fix. An element wider than the window still gets clipped and its content lost, so the offenders below must still be fixed properly.

- [ ] **Step 3: Fix the known fixed widths**

`src/app/(dashboard)/field-staff/page.tsx:134` — a block with `w-[500px]` / `w-[600px]`. Add `max-w-full` and make the fixed width apply from `sm:` up, e.g. `w-full sm:w-[500px] lg:w-[600px] max-w-full`.

`src/app/(dashboard)/leads/[id]/page.tsx:416` — `min-w-[720px]`. Change to `md:min-w-[720px]` so it only forces that width where there is room, and confirm the surrounding container can scroll sideways if the content genuinely needs it.

- [ ] **Step 4: Fix the two hardcoded four-column grids**

`src/app/(dashboard)/location-tracking/dashboard/page.tsx:738` — `grid grid-cols-4 gap-2` becomes `grid grid-cols-2 gap-2 md:grid-cols-4`.

`src/components/import/import-wizard.tsx:491` — `grid grid-cols-4 gap-2` becomes `grid grid-cols-2 gap-2 md:grid-cols-4`.

- [ ] **Step 5: Fix anything else the test found in Step 1**

For each remaining failure, apply the same pattern: a fixed pixel width becomes `w-full` below the breakpoint where it fits, with `max-w-full` as a guard. Do not add `overflow-hidden` to hide the problem — that loses content.

- [ ] **Step 6: Run the suite on the narrowest size and verify it passes**

```bash
npm run test:responsive -- --project=phone-small-chromium --project=phone-small-webkit no-horizontal-scroll.spec.ts --reporter=list
```

Expected: PASS on every route at 320px, on both engines.

- [ ] **Step 7: Run the laptop guard**

```bash
npm run test:responsive:laptop -- --reporter=list
```

Expected: unchanged from baseline.

- [ ] **Step 8: Commit**

```bash
git add src/app/globals.css "src/app/(dashboard)/field-staff/page.tsx" "src/app/(dashboard)/leads/[id]/page.tsx" "src/app/(dashboard)/location-tracking/dashboard/page.tsx" src/components/import/import-wizard.tsx
git commit -m "fix: no sideways scrolling at 320px

overflow-x: clip at the page level (clip, not hidden, which would break
sticky positioning), plus the real offenders: two fixed-pixel blocks and two
hardcoded four-column grids that could never fit a phone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The old-browser gate

**Files:**
- Create: `src/lib/theme/browser-gate.ts` (the script as an exported string, so it can be unit tested)
- Create: `src/lib/theme/browser-gate.test.ts`
- Modify: `src/app/layout.tsx` (mount the gate script in `<head>`, before the theme boot script)

**Interfaces:**
- Consumes: nothing.
- Produces: `BROWSER_GATE_SCRIPT: string` exported from `src/lib/theme/browser-gate.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/theme/browser-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BROWSER_GATE_SCRIPT } from "./browser-gate";

describe("BROWSER_GATE_SCRIPT", () => {
  it("is plain ES5 so the browsers it judges can actually run it", () => {
    // Arrow functions, const/let, template literals and optional chaining
    // would themselves fail to parse on the browsers this gate exists to
    // catch, leaving a blank page instead of the message.
    expect(BROWSER_GATE_SCRIPT).not.toMatch(/=>/);
    expect(BROWSER_GATE_SCRIPT).not.toMatch(/\b(const|let)\s/);
    expect(BROWSER_GATE_SCRIPT).not.toMatch(/`/);
    expect(BROWSER_GATE_SCRIPT).not.toMatch(/\?\./);
  });

  it("tests the features the app actually needs", () => {
    expect(BROWSER_GATE_SCRIPT).toContain("CSS.supports");
    expect(BROWSER_GATE_SCRIPT).toContain("--x:0"); // custom properties
    expect(BROWSER_GATE_SCRIPT).toContain("display:grid");
    expect(BROWSER_GATE_SCRIPT).toContain("Promise");
  });

  it("never blocks a browser that passes every check", () => {
    expect(BROWSER_GATE_SCRIPT).toContain("if (ok) return");
  });

  it("tells the user what to do, in plain words", () => {
    expect(BROWSER_GATE_SCRIPT).toMatch(/update/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/lib/theme/browser-gate.test.ts
```

Expected: FAIL — `Cannot find module './browser-gate'`.

- [ ] **Step 3: Write the gate**

Create `src/lib/theme/browser-gate.ts`:

```ts
/**
 * Tier 3 gate: a browser too old to run the app gets a plain message instead
 * of a broken grey screen.
 *
 * Deliberately ES5 with no modern syntax: a browser that cannot parse this
 * script would show nothing at all, which is the exact failure the gate
 * exists to prevent. It is injected into <head> and runs before React, for
 * the same reason.
 *
 * It tests capability, not user-agent strings, which lie.
 */
export const BROWSER_GATE_SCRIPT = `
(function () {
  function supports(decl) {
    try {
      return !!(window.CSS && window.CSS.supports && window.CSS.supports(decl));
    } catch (e) {
      return false;
    }
  }

  var ok =
    typeof Promise === 'function' &&
    typeof window.fetch === 'function' &&
    supports('--x:0') &&
    supports('display:grid') &&
    supports('position:sticky');

  if (ok) return;

  var wrap = document.createElement('div');
  wrap.setAttribute('role', 'alert');
  wrap.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:#16181d;color:#fcfcfc;' +
    'font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
    'display:block;padding:32px;text-align:center;';
  wrap.innerHTML =
    '<div style="max-width:420px;margin:15vh auto 0">' +
    '<h1 style="font-size:20px;margin:0 0 12px">Please update your browser</h1>' +
    '<p style="margin:0 0 8px">This app needs a newer browser than the one you are using.</p>' +
    '<p style="margin:0;opacity:.7;font-size:14px">Chrome 111 or newer, Safari 16.4 or newer, ' +
    'Firefox 128 or newer, or Edge 111 or newer.</p>' +
    '</div>';

  function mount() {
    if (document.body) document.body.appendChild(wrap);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
`;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/lib/theme/browser-gate.test.ts
```

Expected: PASS.

- [ ] **Step 5: Mount it in the layout**

In `src/app/layout.tsx`, add the import:

```tsx
import { BROWSER_GATE_SCRIPT } from "@/lib/theme/browser-gate";
```

and in `<head>`, put the gate **before** the existing theme script:

```tsx
      <head>
        <script id="browser-gate" dangerouslySetInnerHTML={{ __html: BROWSER_GATE_SCRIPT }} />
        <script id="theme-boot" dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
```

- [ ] **Step 6: Prove the gate does not fire on a supported browser**

```bash
npm run test:responsive -- --project=laptop-chromium --project=laptop-webkit --project=laptop-firefox no-horizontal-scroll.spec.ts --reporter=list
```

Expected: PASS. A gate firing wrongly would blank every page, so a green run on all three engines is the proof.

- [ ] **Step 7: Prove the gate DOES fire when a feature is missing**

In the browser pane, open the app and run this in the console to simulate an old browser, then reload:

```js
Object.defineProperty(window.CSS, 'supports', { value: () => false });
eval(document.getElementById('browser-gate').textContent);
```

Expected: the "Please update your browser" panel appears. This is a manual check — paste the real result, and if it does not appear, fix the gate before committing.

- [ ] **Step 8: Run the full unit suite and typecheck**

```bash
npm run typecheck
npm test
```

Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add src/lib/theme/browser-gate.ts src/lib/theme/browser-gate.test.ts src/app/layout.tsx
git commit -m "feat: tell users on unsupported browsers to update

A browser below the Tier 3 floor now gets a plain, readable message instead
of a broken grey screen. Capability-tested, not user-agent sniffed, and
written in ES5 so the browsers it judges can actually run it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 1 exit check

Run before reporting Phase 1 complete. Paste real output for each; do not assert a result you have not run.

- [ ] `npm run typecheck` — clean
- [ ] `npm run lint` — clean
- [ ] `npm test` — passing, including the two new guard tests
- [ ] `npm run test:responsive` — the smoke scope across all 18 projects (10 routes × 3 suites × 18). State the pass count and every remaining failure with its route.
- [ ] `npm run test:responsive:all` — every static route at phone, tablet-portrait and laptop on Chromium. This is the one that proves the whole app, and it is slow. State the pass count and every remaining failure with its route; **do not describe a partial run as a pass.**

Note on the per-task verification steps above: they use the default smoke scope, which is the fast feedback loop. Before ticking a task off, re-run that task's suite once with the full scope, e.g. `npx cross-env RESPONSIVE_SCOPE=all playwright test --project=phone-chromium touch-targets.spec.ts`, so a fix is not declared done on ten routes when ninety exist.
- [ ] `npm run test:responsive:laptop` — identical to the Task 1 Step 12 baseline
- [ ] Screenshots at 320, 390, 768 and 1440 wide, sent to the user
- [ ] The user has opened the live app on his iPhone and confirmed the bottom of a long list is reachable — the one thing WebKit cannot prove
- [ ] All six commits pushed to `main`, hashes reported

## What Phase 1 does NOT fix

State this plainly when reporting, so nothing looks more finished than it is:

- Tables are still sideways-scrolling tables on phones. The card view is Phase 2.
- Dialogs can still run off the bottom of a phone screen. The `max-height` fix is Phase 2.
- Dense toolbars will look more crowded on phones than before Task 4, until Phase 2 folds them into a sheet.
- Detail pages (`[id]` routes) are not in the sweep at all, because the suite is read-only and cannot rely on a particular record existing. They are covered per module in Phase 3.
- Tier 2 browsers are not actually tested, only guaranteed to have fallbacks present in the CSS. Real proof needs an old device or BrowserStack.
