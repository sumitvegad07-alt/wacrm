# Making the admin portal work on every device and every browser

**Date:** 2026-10-10
**Status:** Awaiting approval
**Scope:** `wacrm-web` only. No database changes. No mobile app changes.

---

## 1. The goal

Today the portal looks right on a laptop in Chrome. Nobody has ever checked it on a phone, a tablet, Safari, or Firefox.

After this work, an admin can do **everything** on a phone, a tablet or a laptop, in any current browser. Not "view only" — everything. Create records, edit them, filter lists, approve things, read reports.

### What success means

A change is done when all three are true:

1. Automated browser tests pass on Chrome, Firefox and Safari's engine, at phone, tablet and laptop sizes.
2. I have looked at the screen myself at each size and it reads well — not just "it fits".
3. Nothing changed at 1024px and above. Your laptop view is untouched.

### Not in scope

- The Android field app (`wacrm-mobile`). Separate repo, separate work.
- The marketing site (`ozzo-site`). Separate repo.
- New features. This is only about the portal working on more screens.
- Printing. The `/print/*` pages are fixed at 900px on purpose, because they render A4 paper. They stay as they are.

---

## 2. What "every browser" actually means

Vague promises cannot be tested, so here is the exact list.

### Tier 1 — must be perfect

Automated tests plus my own visual review.

These are Tailwind v4's own stated minimums (`tailwindcss.com/docs/compatibility`), and the project runs Tailwind 4.3.1.

| Browser | Floor | Why this floor |
| --- | --- | --- |
| Chrome (Android, Windows, Mac) | 111 | First version with `oklch()` and `color-mix()` |
| Safari (iPhone, iPad, Mac) | 16.4 | First version with `@property`. (`oklch()` works from 15.4, `color-mix()` from 16.2) |
| Edge | 111 | Same engine as Chrome |
| Firefox | 128 | First version with `@property`. (`oklch()` and `color-mix()` work from 113) |
| Samsung Internet | 22 | Large share on Indian Android phones |

### Tier 2 — must work, may look plainer

Spot-checked by hand, not fully automated (see the honesty note in section 9).

Chrome and Android WebView 90–110 · Safari 15.0–16.3 · Firefox 100–127 · Samsung Internet 14–21.

What is actually missing varies by browser, and it matters, because only the first group is helped by the colour fallbacks in Phase 1:

| Group | Missing | Effect |
| --- | --- | --- |
| Chrome / Android WebView 90–110, Firefox 100–112, Safari below 15.4 | `oklch()` **and** `color-mix()` | Without the Phase 1 fallbacks, the whole UI loses its colours. **This is the group the fallbacks save**, and on Indian Androids it is the largest of them |
| Safari 15.4–16.1 | `color-mix()` and `@property` | Colours fine. See-through panels render solid or transparent; gradients, some shadows and transforms render plainly |
| Safari 16.2–16.3, Firefox 113–127 | `@property` only | Colours and see-through panels fine. Gradients, some shadows and transforms render plainly |

Differences we accept across all of Tier 2: flat colours instead of wide-gamut ones, no frosted blur behind overlays, plain shadows, plain gradients, and some see-through panels rendering solid. Every button, field and table still works and is readable.

**`@property` cannot be fixed with a fallback.** It is an at-rule Tailwind emits; a browser that does not understand it simply ignores it, and there is no declaration-level trick to stand in. So for Safari 15.4–16.3 and Firefox 113–127 the plainer look is accepted, not engineered around. Trying to fix it would mean leaving Tailwind v4, which is not worth it.

### Tier 3 — blocked politely

Anything older than the Tier 2 floor, and Internet Explorer. These get a plain "your browser is too old, please update" page instead of a broken grey screen, so the user knows what is wrong instead of guessing.

### Screen sizes

These are the Tailwind breakpoints already in the project. No new system.

| Class | Width | What changes |
| --- | --- | --- |
| Phone portrait | 320–479px | Tables become cards, one-column forms, 44px controls, filters move into a sheet, dialogs become bottom sheets |
| Phone landscape / phablet | 480–767px | Same, but built for a short screen. This band breaks most layouts and gets the hardest testing |
| Tablet portrait | 768–1023px | Tables stay tables, with sideways scroll and a frozen Action column. Two-column forms. Sidebar stays a drawer |
| Tablet landscape / small laptop | 1024–1279px | Sidebar returns permanently. Today's desktop layout |
| Laptop / desktop | 1280px and up | **Unchanged** |

### Two rules that hold for the whole programme

1. **Nothing changes at 1024px and above.** Every change is either gated behind a `max-width` condition, or written as "small screen value, then the current value from `md:` up". This is what keeps a 465-file programme from wrecking what already works.
2. **Pinch-zoom stays on.** We will not lock the viewport scale. Blocking zoom is the usual shortcut for faking mobile polish, and it breaks the app for anyone with weak eyesight.

Both portrait and landscape must work. 320px is the narrow floor we test against — iPhone SE and the cheapest Android phones.

---

## 3. What the portal is like today

Honest starting point, measured not guessed:

- 124 pages, 465 components, 26 data tables.
- 201 of 465 files already use responsive classes. There is already a working mobile sidebar drawer. This is not starting from zero.
- Create and edit forms are **already** responsive (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-3`).
- Drag-and-drop already sets `touch-none` on its handles, so the kanban board and the route planner should drag correctly on touch.
- Text inputs already use `text-base md:text-sm`, so iPhone will not auto-zoom when you tap into a field.
- Charts already use Recharts `ResponsiveContainer`, so they resize. Their phone problem is crowded axis labels, not layout.
- 163 vitest tests exist. **No browser-level test tool at all**, so nothing today can catch a layout break on Safari.

And the real problems:

- The app shell is locked to `h-screen` with `overflow-hidden`, and `dvh` is used nowhere in the project.
- 120 `oklch()` colours with no fallback.
- One shared `DataTable` with no phone treatment — sideways scroll only.
- Every control is hardcoded compact: inputs 32px, buttons 32–36px, select triggers 28–32px, checkboxes 16px.
- `DialogContent` sets no maximum height for its normal sizes.

---

## 4. Phase 1 — Foundation

Global work. Mostly invisible, fixes the most. Nothing here is a new screen.

### 1.1 The viewport height bug — the biggest single win

61 places use screen height: 33 `h-screen`, 17 `min-h-screen`, 11 raw `100vh`.

Swapping `100vh` for `100dvh` is only half the fix. The real problem is the **model**. `src/app/(dashboard)/dashboard-shell.tsx` locks the app to `h-screen overflow-hidden` and scrolls an inner `<main>`. On a laptop that is correct and feels good. On a phone it fights the browser: the address bar never collapses, and the bottom strip of every page — pagination, Save buttons — sits underneath it and cannot be scrolled into view.

- Below 1024px: release the lock and let the page scroll normally. The header becomes sticky instead.
- 1024px and up: today's locked shell, untouched.
- Everywhere: a `100vh` then `100dvh` pair, so Tier 2 browsers still get something sensible.
- iPhone notch and home-bar handling via `env(safe-area-inset-*)` on the header, the sidebar drawer, and every sticky bottom bar.
- `interactiveWidget: 'resizes-content'` in the viewport export, so the Android keyboard pushes content up instead of covering the field being typed into.

Next.js already emits `width=device-width, initial-scale=1` by default (confirmed in `node_modules/next/dist/lib/metadata/default-metadata.js`), so that part needs nothing.

**This is the riskiest change in the programme**, because it alters the scroll model of every page below 1024px. It gets its own automated test per route: open the page, assert the bottom-most control is reachable.

### 1.2 Colour fallbacks

120 `oklch()` values across 8 blocks in `src/app/globals.css` — one default, dark, light, and five accent themes (violet, emerald, cobalt, amber, rose).

Two declarations per token, plain colour first:

```css
--background: #16181d;
--background: oklch(0.13 0.01 260);
```

A browser that cannot read `oklch` throws that line away and keeps the hex. A modern browser takes the `oklch`. No duplicated blocks, no `@supports`.

**Who this actually saves.** Chrome and Android WebView 90–110, Firefox 100–112, and Safari below 15.4. On Indian Android phones that is a real slice of users, and without this they see a colourless UI. It does **not** help Safari 15.4–16.3 or Firefox 113–127, which read `oklch` perfectly well — their problem is `@property`, covered in section 2.

**What we are deliberately NOT doing here.** Tailwind v4 compiles every see-through utility such as `bg-primary/10` into `color-mix(in oklab, …)`, which is missing below Chrome 111, Firefox 113 and Safari 16.2. An earlier draft of this spec said we would route those through pre-mixed tokens. That was the wrong call, for two measured reasons:

- There are around 600 such usages across about 40 different token-and-opacity combinations. Rewriting them would churn hundreds of files for a cosmetic gain.
- The failure is mild. When `color-mix()` cannot be read, the browser drops that one declaration, so the panel falls back to its parent surface. It goes flat instead of tinted. The text on it keeps its own solid colour and stays readable.

So flatter tinted panels are an **accepted Tier 2 difference**, not something we engineer around. Only the solid colours get fallbacks, and those are the ones that actually matter — without them the entire UI loses its colour.

**One crash risk, checked and ruled out.** Safari 16.4 crashes on `color-mix()` combined with `currentColor` (fixed in 16.6), and 16.4 is a Tier 1 browser, so this would have been serious. Verified on 2026-10-10: the project generates no `*-current/NN` utilities, so Tailwind never emits that combination. Every `currentColor` in the codebase is an SVG attribute, which is unaffected. Re-check if anyone adds a utility like `text-current/50` or `border-current/50`.

### 1.3 Touch sizes

Inputs 32px, buttons 32–36px, select triggers 28–32px, checkboxes 16px. All too small for a thumb. Apple and Google both target about 44px.

Fixed in six `ui/*` files only — `input`, `button`, `select`, `checkbox`, `radio-group`, `switch` — plus table row height and dropdown menu items. Written as "44px by default, your current compact size from `md:` up". Roughly 40 lines of change covering all 465 files.

The checkbox grows its tappable area with padding, not by growing the visible box, so it does not look clumsy.

### 1.4 Stop sideways page scrolling

`overflow-x: clip` on the page — deliberately **not** `hidden`, because `overflow: hidden` on `body` breaks sticky positioning, which already bit us on the marketing site.

Then fix the real offenders: `w-[500px]` in field-staff, `min-w-[720px]` in the lead detail page, and the rest of the fixed pixel widths found in the audit. The `w-[900px]` print pages are correct and stay.

### 1.5 The Tier 3 "please update" gate

A tiny script in `<head>`, next to the existing theme boot script. It feature-tests what the app genuinely needs and, if anything is missing, paints a plain update message over the page. It must be plain script, not a React component — a browser that old may never get React running at all.

---

## 5. Phase 2 — Shared components

About ten shared files, plus a pass over the 11 hover-only and 14 tooltip files in 2.6. Between them they cover the large majority of the app, which is what makes the module sweep in Phase 3 mostly checking rather than rebuilding.

### 2.1 The table becomes cards on phones

The biggest UX win, because all 26 tables run through one component.

Add an optional field to `ColumnDef`: `priority?: "primary" | "secondary"`. The default needs no edits anywhere — the first visible column becomes the card title and the next three become the summary lines. So all 26 tables get a sensible card view with **zero changes to the 26 pages**, and any screen can refine later by tagging its columns.

A card is:

- Title in bold, with the Action menu on the right.
- Two to four label-and-value rows.
- Tap the card to open the record (the existing `onRowClick`).
- A selection checkbox top-left when the screen has bulk actions.
- A "More" tap that expands every remaining visible column, so nothing is permanently hidden.

The filters are the catch. Today they live inside the header row (`data-table-header.tsx`), and cards have no header row. So a **Filter** button opens a bottom sheet listing every filterable column, reusing those same filter inputs — same state, same saved views, no second code path to drift apart. **Sort** and **Manage columns** sit in the same sheet.

The footer stacks into two rows and Prev/Next become thumb-sized. The saved views bar stays, as a side-scrolling strip.

At tablet portrait (768–1023px) it stays a **real table**, with sideways scroll and the Action column frozen to the left edge so it never scrolls out of reach.

### 2.2 Dialogs — a real bug, not just polish

70 files use `<Dialog>`, and `dialog.tsx` sets no maximum height for the `sm`, `md`, `lg` and `xl` sizes. A tall dialog on a phone runs off the bottom of the screen and, because the shell is `overflow-hidden`, the Save button is **completely unreachable** — not awkward, impossible.

Fix: cap the height, scroll the body, pin the footer. Below 768px, dialogs slide up from the bottom as sheets. One file, 70 screens.

### 2.3 Sheets

Side sheets are `w-3/4`. On a 360px phone that leaves a useless 90px sliver of background. Full width below 640px, with safe-area padding at the bottom.

### 2.4 Forms

The grids are already responsive, so what is left is:

- A sticky Save/Cancel bar on phones in `form-actions.tsx`, safe-area aware.
- Scroll to the first error on submit.
- Check the date and time inputs on iOS, which draws them very differently from Chrome.

### 2.5 Toolbars

`page-toolbar.tsx` and the report filter drawer fold the same way: the primary action stays visible, the rest go into a sheet.

### 2.6 Hover-only controls

11 files reveal buttons only on hover (`group-hover:opacity`), which a finger can never trigger. 14 files use tooltips to carry real information. On touch these become always-visible, or move into the row's Action menu.

---

## 6. Phase 3 — Module sweep

All four module groups were marked first-wave, so there is no priority order to follow. I have ordered them by dependency and risk instead, and here is the reasoning:

1. **Daily lists and approvals first.** They all share the table and dialog components from Phase 2, so they come close to free. They also prove the foundation on the screens used most.
2. **Setup and admin second.** This is what a new customer sees on day one, and the forms are already responsive, so it is mostly tidying.
3. **Dashboards and reports third.** Charts already resize; the work is readability, which needs judgement rather than plumbing.
4. **Field force last**, because the live Leaflet map needs genuine touch work and is the least like anything else.

### Batch 3A — Daily lists and approvals

`contacts` · `leads` · `deals` · `tasks` · `follow-ups` · `orders` · `quotations` · `payments` · `expenses` · `dispatches` · `pending-dispatch` · `stock` · `products` · `price-lists` · `schemes` · `announcements` · `location-tracking/leaves`

Each is a list page plus a detail page plus a create/edit form. The list comes from Phase 2. The work per module is: check the detail page's column layout, check its tabs, check its action buttons reach the thumb, fix what the test flags.

Known specific items: the lead detail page has a `min-w-[720px]` block, and the deal detail page has five fixed `min-w-` columns.

### Batch 3B — Setup and admin

`settings` (and its template, document-template and attendance-location sub-pages) · `team` · `team/employees` · `team/roles` · `territories` · `custom-fields` · `company-profile` · `subscription` · `getting-started` · `import`

Known specific items: the settings rail already uses a mobile hook, so it has a head start. The import wizard has a hardcoded `grid-cols-4` step indicator that will not fit a phone.

### Batch 3C — Dashboards and reports

`dashboard` · `reports` and the 12 report pages · `whatsapp/dashboard`

Charts resize already, so the work is readability: fewer axis ticks on narrow screens, rotated or shortened labels, legends moved below, KPI tiles stacked one or two per row instead of four.

The report viewer (836 lines) is the hard part and is listed in Phase 4, because a pivot table with many columns cannot become cards — it needs its own treatment.

### Batch 3D — Field force

`location-tracking/overview` · `attendance` · `visits` · `executions` · `track-report` · `health` · `all-locations` · `location-tracking/dashboard` · `field-staff` · `routes` · `routes/approvals` · `routes/executions`

Known specific items: `field-staff` has a `w-[500px]`/`w-[600px]` block, and `location-tracking/dashboard` has a hardcoded `grid-cols-4`.

---

## 7. Phase 4 — Screens that need their own design

These cannot be solved by shared components. Each needs a real decision about what it becomes on a phone. **This is the least precise phase in the plan**, and deliberately so — what each one needs depends on how Phases 1 and 2 actually land. I will come back with a short design for each before building it, rather than guess now.

| Screen | Size | Why it is hard | Likely direction |
| --- | --- | --- | --- |
| `inbox` | 3,379 lines | Three columns: list, chat, details | One column at a time with back navigation, like a phone messaging app |
| `flows/[id]` | 2,940 lines | A node canvas (`@xyflow/react`) | Likely read-and-inspect only on phones, with editing kept to tablet and up. Needs your call |
| `reports/*` viewer | 2,287 lines | Wide pivot tables with many columns | Frozen first column, sideways scroll, plus a per-row expand view |
| `pipelines` | Kanban board | Side-by-side stage columns | One stage at a time with a stage switcher; drag already works on touch |
| `routes/planner` | Calendar grid | A month grid plus drag-and-drop | Week or day view on phones |
| `location-tracking` maps | Leaflet | Touch gestures, full-height map | Proper touch gesture setup, sheet for the detail panel |
| `automations/[id]/edit` | Builder | Fixed `w-[320px]`/`w-[400px]` panels | Stacked panels |
| `import/[module]` | Wizard | Column-mapping grid | Stacked mapping rows |

---

## 8. Phase 5 — The cross-browser pass

Everything up to here is about screen size. This phase is about engines.

- Safari-specific: date and time inputs, `appearance` on selects, sticky positioning inside scrolling containers, how `position: fixed` behaves while the keyboard is open, momentum scrolling.
- Firefox-specific: scrollbar styling, form control sizing, `clip` support.
- Samsung Internet: its dark mode override, which can recolour pages on its own.
- Tier 2 verification: confirm the colour fallbacks really do render.
- Audit what Tailwind's `@property` rules are actually used for in this project, and confirm the Tier 2 degradation is cosmetic only — no unreadable text, no invisible buttons.
- Print pages re-checked, since Phase 1 touches global CSS.

### Where the browser facts came from

- Tailwind v4 minimums: <https://tailwindcss.com/docs/compatibility>
- `oklch()` and `color-mix()` versions: <https://developer.chrome.com/docs/css-ui/access-colors-spaces>
- The Safari 16.4 `color-mix()` + `currentColor` crash: <https://github.com/tailwindlabs/tailwindcss/pull/17306>
- `@property` versions: <https://modern-css.com/browser-support/>

These were checked on 2026-10-10. Re-check before relying on them in a year.

---

## 9. How we prove it works

### Automated: Playwright

New dev dependency. Drives real Chrome, real Firefox, and Safari's engine (WebKit), at these sizes:

| Name | Size | Stands for |
| --- | --- | --- |
| phone-small | 320 × 568 | iPhone SE, cheap Androids |
| phone | 390 × 844 | iPhone 14/15, most Androids |
| phone-landscape | 844 × 390 | The short-screen band |
| tablet-portrait | 768 × 1024 | iPad portrait |
| tablet-landscape | 1024 × 768 | iPad landscape |
| laptop | 1440 × 900 | Your current view — the regression guard |

Three engines times six sizes is 18 combinations. Not every test runs on all 18; the layout tests do, the flow tests run on one engine per size.

**What the tests actually assert**, for every one of the 124 routes:

1. No sideways page scroll: the document is never wider than the window.
2. The bottom-most control is reachable and clickable — this is the guard on the Phase 1.1 change.
3. No element overflows its container.
4. Every button and link is at least 44 × 44px below 768px.
5. No text is clipped (`scrollWidth` beyond `clientWidth` on text nodes).
6. The page has no console errors.

Plus real flows on a phone size: log in, open a list, filter it, open a record, edit it, save it. For the top modules, not all 124 routes.

**Where the tests live and when they run:** `tests/responsive/` in the repo, run by `npm run test:responsive`. They need a logged-in session, so they use a seeded test account against a local dev server — not production.

### Automated: the colour fallback test

A plain vitest test that reads `globals.css` and fails if any `oklch()` declaration is missing its plain-colour fallback for the same property. Runs with the normal `npm test`, so a future edit cannot silently drop a fallback.

### Manual: my own review

For each batch I open the screens in my browser pane at each size, look at them, and send you screenshots. Automated tests prove a screen is not broken. Only looking at it proves it reads well.

### Two honest limits

1. **Tier 2 cannot be fully automated.** Playwright's WebKit is the current Safari engine, not Safari 15. The fallback test proves the fallback exists in the CSS; it does not prove Safari 15 renders it. Proving that needs a genuine old device or a paid service such as BrowserStack. If you want real Tier 2 proof, that is a separate decision about paying for BrowserStack.
2. **iPhone and iPad are tested through WebKit, not a real iPhone.** WebKit is the same engine, so layout and CSS behaviour is accurate. What it does not reproduce is iOS-specific chrome: the exact address bar behaviour, the keyboard, and the home-bar area. Those need a real iPhone — yours or a borrowed one — at least once per phase.

### Definition of done, per batch

- `npm run typecheck` clean.
- `npm run lint` clean.
- `npm test` passing, including the colour fallback test.
- `npm run test:responsive` passing for the batch's routes.
- Screenshots at phone, tablet and laptop sizes sent to you.
- The laptop-size test unchanged from before the batch — proof nothing regressed.
- Committed and pushed to `main`, with the commit hash reported.

---

## 10. Risks

| Risk | How bad | What we do about it |
| --- | --- | --- |
| Phase 1.1 changes the scroll model of every page below 1024px | High | Its own per-route test; laptop-size tests prove the desktop view did not move |
| Touch sizing (1.3) touches six files used by all 465 components | High | Written as "mobile value, then current value from `md:` up", so desktop CSS output is byte-identical. Verified by the laptop-size tests |
| The card view hides columns a user relies on | Medium | "More" expands every visible column. Nothing is permanently hidden |
| Tier 2 colour fallbacks look wrong in ways we cannot see | Medium | Stated openly above. Needs a real old device or BrowserStack to close |
| `@property` is missing on Safari 15.4–16.3 and Firefox 113–127, and cannot be polyfilled | Medium | Accepted as a plainer look, not engineered around. Fixing it would mean leaving Tailwind v4 |
| Playwright adds ~200MB of browsers and slows the test run | Low | Separate script from `npm test`; the layout sweep runs on demand and in CI, not on every save |
| Phase 4 screens turn out to need more design than expected | Medium | Each gets its own short design before building, so it cannot quietly expand |

---

## 11. Build order

| Phase | What | Visible result |
| --- | --- | --- |
| 1 | Foundation | Phones stop cutting off the bottom of every page. Controls become thumb-sized. Old browsers stop looking broken |
| 2 | Shared components | All 26 tables become readable on a phone. 70 dialogs become usable |
| 3A | Daily lists and approvals | The screens you use most are phone-complete |
| 3B | Setup and admin | A new customer can be onboarded from a phone |
| 3C | Dashboards and reports | The numbers read well on a phone |
| 3D | Field force | Tracking and routes work on a phone, map included |
| 4 | The eight hard screens | Each gets its own short design first |
| 5 | Cross-browser pass | Safari, Firefox and Samsung Internet specifics closed out |

Each phase is committed and pushed to `main` as it completes, so you can test it live rather than waiting for the whole programme.

---

## 12. Open questions for you

1. **Flows editor on a phone** (Phase 4): is read-only acceptable there, with editing from tablet upwards? Building a touch node editor is a large job on its own.
2. **BrowserStack**: do you want to pay for real Tier 2 and real-iPhone proof, or is "the fallback is present and tested in code" enough?
3. **A real iPhone or iPad**: do you have access to one for the once-per-phase check? It changes how much I can promise about iOS specifically.
