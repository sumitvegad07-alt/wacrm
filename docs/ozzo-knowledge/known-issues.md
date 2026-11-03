# Known issues, limitations and open questions

Findings log for the knowledge-base project. Nothing here has been fixed — discovery records,
it does not repair. Each entry carries a verification label and the evidence it rests on.

Severity is about customer impact, not code tidiness:

- **high** — a customer hits it and something they paid for does not work
- **medium** — confusing or unexplained behaviour that generates support calls
- **low** — dead configuration, cosmetic, or invisible to customers

---

## F-001 — A plan-blocked URL bounces to the dashboard with no explanation

**Severity:** medium · **Label:** VERIFIED IN BROWSER (2026-10-23, account 001001) · **Opened:** 2026-10-23

> **Confirmed twice, for the two different kinds of gate:**
>
> | Opened | Gate that blocked it | What happened |
> | --- | --- | --- |
> | `/schemes` | module `scheme` is OFF in Organization Settings | URL silently became `/dashboard`. No toast, no message. |
> | `/service/assets` | the FSM product line is not granted to this plan | The tab title flashed "Assets" as the page began to render, then the URL silently became `/dashboard`. |
>
> In both cases the user is left looking at the dashboard with nothing on screen explaining why.
> The second case also confirms that a **legacy `Enterprise` plan does not include FSM** —
> `planLines()` returns `{crm, wfa, sfa}` and deliberately withholds `fsm` from legacy tenants.

When a signed-in user opens a screen their plan or module toggle does not allow, the shell
redirects them to `/dashboard` silently. No toast, no message, no "this is not part of your
plan" page.

**Evidence:** `src/app/(dashboard)/dashboard-shell.tsx:93` —
`if (featureRestricted || isRouteRestricted(...)) router.replace("/dashboard")`.

The gate table's own header comment states the intent differently: *"these gates stop a user
wandering into a screen that cannot work for them, with a clear reason, instead of letting it
load and fail"* (`src/lib/plans/surface-gates.ts`, top of file). The clear reason is not
implemented at the redirect.

**Why it matters for support:** a customer following an old bookmark, a shared link, or a
screenshot from a different plan lands on the dashboard and reports "the link is broken" or "the
app logged me out of that page". There is nothing on screen to tell them, or you, that it was a
plan gate.

**Open question:** does any surface show a reason? To be checked in the browser.

---

## F-002 — The Tasks list has no menu entry

**Severity:** medium · **Label:** VERIFIED IN CODE — REQUIRES BROWSER VERIFICATION · **Opened:** 2026-10-23

`/tasks`, `/tasks/new` and `/tasks/[id]` exist and are not plan-gated, but `getMenuStructure`
contains no entry for `/tasks`. The menu offers *My Activity* (`/follow-ups`), *Task Reports*
(`/reports/tasks`), *Task Settings* (`/settings?tab=tasks`) and the Task custom-field editor —
not the Tasks module itself.

**Evidence:** `_generated/nav.json` has no `/tasks` item; `src/components/layout/sidebar.tsx:740`
lists `/tasks` among the rows that get an inline "+" quick-create button, but that button can
only render on a nav row, and there is no Tasks nav row for it to sit on.

**Known ways in:** the notification bell deep-links task notifications to `/tasks`
(`src/components/layout/notification-bell.tsx:28`), and `/tasks` has a page title registered
(`src/components/layout/header.tsx:29`).

**To verify in browser:** whether My Activity, the dashboard or the command palette offers a
route to the Tasks list, or whether it is genuinely URL-only. Do not report this as a defect
until that check is done — the module may be reachable by a path that is not a menu entry.

---

## F-003 — Four dead entries in the header page-title map

**Severity:** low · **Label:** VERIFIED IN CODE · **Opened:** 2026-10-23

`pageTitles` in `src/components/layout/header.tsx` maps these paths to titles, and none of them
is a route in this app: `/team/attendance`, `/activities`, `/approval-queue`,
`/monthly-planner`.

**Evidence:** cross-check of `header.tsx:23-58` against the 168 page routes in
`_generated/routes.json`.

Harmless — an unmatched key is never read — but it is a trace of removed or never-built screens,
and it misleads anyone reading the file to learn what screens exist.

---

## F-004 — Twenty screens have no path through the sidebar

**Severity:** medium (varies per screen) · **Label:** VERIFIED IN CODE — REQUIRES BROWSER VERIFICATION · **Opened:** 2026-10-23

These dashboard routes have no menu entry for themselves **or for any ancestor path**, so the
sidebar alone cannot reach them:

`/custom-fields`, `/custom-fields/[module]`, `/deals`, `/deals/[id]`, `/deals/[id]/edit`,
`/deals/new`, `/field-staff`, `/location-tracking/track-report`, `/reports`, `/routes`,
`/routes/[id]`, `/routes/approvals`, `/routes/executions`, `/routes/new`, `/routes/planner`,
`/tasks`, `/tasks/[id]`, `/tasks/new`, `/team`, `/territories`.

Several are intentional and documented in code:

- **`/routes/*`** — Route Management deliberately has no top-level entry (commit `9e9e213`).
  Creation and approval live in Team → Employees → an employee → Routes tab; monitoring is
  Location Tracking → Route Monitor (`/location-tracking/executions`).
- **`/deals/*`** — the menu's "Deal" row points at `/pipelines` (the board). `/deals` is the
  list view, and the sidebar's "+" on the Deal row routes to `/deals/new`
  (`sidebar.tsx:757`).
- **`/custom-fields` and `/reports`** — hub pages; the menu links the individual children
  instead.
- **`/territories`** — the menu offers Territory Master at `/settings?tab=territories`; the
  standalone `/territories` page is a second surface for the same master.

That leaves genuinely unexplained: **`/field-staff`**, **`/location-tracking/track-report`**,
**`/team`**, and `/tasks` (see F-002).

**To verify in browser:** the real entry point for each of the four, and whether each hub page
is linked from somewhere a customer would find.

---

## F-007 — Getting Started shows raw database keys instead of labels on six tiles

**Severity:** medium · **Label:** VERIFIED IN BROWSER (2026-10-23, account 001001) · **Opened:** 2026-10-23

> **FIXED 2026-10-27 — commit `8341d46`, on `main` and deployed.** Verified in the browser on a
> production build: all nine tiles now read Territories, Roles, Employees, Leads, Deals,
> Quotations, Products, Price lists, Orders.
>
> **Not fixed by adding six entries.** The cause was *two* hand-written label maps, neither tied
> to the resolver list, so the next metric would have broken it again. There is now one map
> beside the resolvers, used by both panels, and **a test that fails if any resolver has no
> label** — so this breaks `npm test` rather than a customer's first impression.

The Getting Started health panel labels three tiles properly and shows **raw metric keys** on the
other six:

| Labelled correctly | Showing a raw key |
| --- | --- |
| Territories, Roles, Employees | `lead_count`, `deal_count`, `quotation_count`, `product_count`, `price_list_count`, `order_count` |

Evidence: [`evidence/2026-10-23-getting-started-raw-metric-keys.jpg`](evidence/2026-10-23-getting-started-raw-metric-keys.jpg)

**Cause — a label map that did not keep up with the metrics:**

- `src/components/getting-started/HealthPanel.tsx:18` defines labels for exactly four keys:
  `territory_count`, `customer_count`, `employee_count`, `role_count`.
- Line 23 renders `{label[m.key] ?? m.key}` — anything missing falls back to the raw key.
- `src/lib/implementation/resolvers.ts` defines many more metrics than those four, including all
  six above.

The rule already exists elsewhere in the same feature: `StepPanel.tsx:37` carries the comment
*"Customer-facing labels for validation metrics — never show raw source_keys"* and its own
`VALIDATION_LABELS` map. `HealthPanel` has a second, shorter map that was never extended.

**Why it matters:** this is the onboarding screen — often the first thing a new customer sees
after signing up, and the screen that is supposed to mean "no support call needed". Showing
`price_list_count` there makes a finished product look unfinished.

**Fixed 2026-10-27** — see the banner at the top of this finding. The six entries were never the
real fix; one map tied to the resolvers, with a test, was.

---

## N-001 — `module:` on a nav item is a permission, not a module toggle (note, not a defect)

**Label:** VERIFIED IN CODE · **Opened:** 2026-10-23

A trap worth knowing before answering any "why can't they see it" question. On a nav item:

- `module: "orders"` → checked as the **permission** `view_orders`
- `configModule: "payment"` → checked as the **admin module toggle** `payment`

**Evidence:** `src/hooks/use-nav-items.ts` — `if (item.module && !hasPermission("view_" + item.module)) return false;`

So a row can disappear for two completely different reasons that look identical on screen: a
missing role right, or a module switched off in Organization Settings. The diagnosis differs
entirely, and the field name does not hint at which is which.

---

## N-002 — `?tab=deals` cannot open the section whose id is `deals` (note, not a defect)

**Label:** VERIFIED IN CODE · **Opened:** 2026-10-23

`SECTION_META.deals` is labelled "Currency" and sits in the `hidden` rail group, but
`resolveSection()` rewrites the incoming value `deals` to `deal_pipelines`, so the id is
unreachable from the URL.

**Evidence:** `src/components/settings/settings-sections.ts` — `if (raw === 'deals') return 'deal_pipelines';`

Per the code comment this is intended: the currency control renders inside the Deals panel,
above the pipelines. The vestigial id is listed here so nobody files it as a missing settings
tab, and so nobody "fixes" the redirect and breaks the live links in `sidebar.tsx`.

---

## F-005 — While the profile loads, the app tells the owner "Access Denied" and shows empty lists

**Severity:** high · **Label:** VERIFIED IN BROWSER — reproduced and timed · **Opened:** 2026-10-23

> **FIXED 2026-10-27 — commit `9b0a358`, on `main` and deployed.** A gate now has three
> states, not two: "I don't know yet" is no longer treated as "no". `src/lib/auth/permission-gate.ts`
> + `src/hooks/use-permission-gate.ts` hold the rule, 5 unit tests cover it, and all sixteen
> full-page gates that rendered a refusal into the profile-load window were converted. Measured
> before the fix: a 674ms false "Access Denied" on every cold load of `/team/roles`.
>
> The two other symptoms of the same window — the header showing "User"/"Company" and a list
> saying "Total: 0 records" — were NOT part of that commit. **Still open.** The record below is
> kept because it is the explanation to give a customer who saw this before 2026-10-27, and
> because the empty-list symptom is still live.

> **Confirmed by a controlled test on 2026-10-23.** Signed in fresh as the owner of tenant
> 001288, then loaded `/territories` and read the page three times in one page load:
>
> | When | What the page said |
> | --- | --- |
> | immediately | **Access Denied** — "You do not have permission to view this page. Ask an admin to grant it in Team → Employee Roles." |
> | a moment later | **Access Denied** (unchanged) |
> | after ~5 seconds | **Territory Master** — 799 territories, Export / Import / Add Territory, hierarchy tabs |
>
> No refresh, no permission change, same user, same page load. Evidence:
> [`evidence/2026-10-23-territories-owner-access-after-load.jpg`](evidence/2026-10-23-territories-owner-access-after-load.jpg)
> shows the page the owner reaches once the profile has landed.
>
> **This answers Q-006: the panel does self-heal.** It is a visible, several-second lie, not a
> permanent lockout.

### The same window produces three different symptoms

Everything that depends on the profile is wrong during that window, each in its own way:

| Surface | What the customer sees while the profile loads | What it really is |
| --- | --- | --- |
| A permission-guarded page | **"Access Denied"** | They have the right |
| Any list screen | **"Total: 0 records"** / "No data found." | The query ran with no `accountId` |
| The sidebar / header | Placeholder "Company" and "User" | Not yet loaded |

Observed on `/territories`, `/team/employees` ("Access Denied"),
`/location-tracking/attendance` ("No access to User Attendance — Ask an admin to grant 'View
attendance'") and `/products` ("Total: 0 records" while the database held **25 active
products**).

**So an empty list and an Access Denied panel can both mean "wait a second", and nothing on
screen says so.** That makes them the most misleading states in the product: the words say
"you lack permission" and "there is no data", when the truth is "not loaded yet".

Every permission guard in the app reads `hasPermission()` without first checking whether the
profile has arrived. Until it does, the signed-in user has no role and no rights, so the guard
renders the **Access Denied** panel — to the account owner, who is entitled to everything.

**What was observed:** signed in to tenant 001288 as `testplayconsole@gmail.com`, whose
`profiles.account_role` is **`owner`** (read from the database). Opening `/territories` showed:

> **Access Denied** — You do not have permission to view this page. Ask an admin to grant it in
> Team → Employee Roles.

**Why it happens:**

- `src/components/auth/require-permission.tsx` — `const allowed = isSuperadmin || keys.some(k => hasPermission(k));`
  There is no `loading` / `profileLoading` branch, so "not yet known" is treated as "no".
- `src/hooks/use-auth.tsx:544` — `isOwner: role === "owner"` where `role = profile?.account_role ?? null`.
  While `profile` is null, `isOwner` is false, so the owner/admin bypass at
  `src/hooks/use-auth.tsx:582` does not fire.
- `use-auth.tsx:251-255` documents exactly this window: *"The session settles fast (one local
  cookie read); the profile fetch crosses the network and settles later. Callers that gate on
  `profile.*` need to know which window they're in."* These callers do not.

**Blast radius — all seven permission-guarded surfaces share the pattern:**

| Surface | Guard |
| --- | --- |
| `/territories` | `RequirePermission permission="edit_territories"` |
| `/company-profile` | `RequirePermission` |
| `/subscription` | `RequirePermission` |
| `/custom-fields/[module]` | `RequirePermission` |
| `/team/roles` | inline — `src/app/(dashboard)/team/roles/page.tsx:302` |
| `/team/employees` | inline — `src/app/(dashboard)/team/employees/page.tsx:475` |
| Route approval queue | inline — `src/components/routes/approval-queue.tsx` |

None of the seven consults a loading flag. The pattern is consistent, so this is one cause with
seven symptoms, not seven bugs.

**What the customer experiences:** on a fast connection, a flash of Access Denied that becomes
the real page. On a cold load, a slow network, or a phone on mobile data, the panel sits there
long enough to be read, screenshotted and reported — **measured at roughly 5 seconds** in the
test above. A refresh usually "fixes" it, which is why it looks intermittent.

**A second cause produces the identical symptoms: an expired session.** Also seen on 2026-10-23
— after about an hour, guarded pages showed Access Denied and lists showed zero rows, and only
then did the app redirect to `/login`. So the same two symptoms mean *either* "still loading"
*or* "your session expired", and the screen distinguishes neither.

**What to tell a customer who reports it** (this is the single most useful support script in
this knowledge base):

1. **Wait five seconds without touching anything.** If the page appears, nothing is wrong — it
   was still loading.
2. If it does not, **refresh once.** If it appears, same thing.
3. If Access Denied survives a refresh **and** the sidebar shows their real name and company,
   it is a genuine missing right — grant it at Team → Employee Roles.
4. If the sidebar still says "Company" and "User", or lists everywhere read zero, their
   **session has expired** — sign out and back in.

The same script covers "my data has disappeared": an empty list plus a placeholder sidebar is a
loading or session problem, not lost data.

**Not fixed.** Discovery only. The fix would be a loading branch in the guard (render the splash
or nothing until `profileLoading` is false), applied in one place for `RequirePermission` and in
three inline guards.

---

## Q-007 — RESOLVED: the blank `redirect()` pages were the dev server, not the product

> **Closed 2026-10-27.** Re-checked on a PRODUCTION BUILD, signed in on tenant 001288:
> `/custom-fields` redirects to `/custom-fields/contact` and renders the editor; `/team`
> redirects to `/team/roles`; `/location-tracking/track-report` redirects to
> `/location-tracking/health`. All three VERIFIED IN BROWSER. Nothing is wrong with these pages.
> The 2026-10-23 blank page was a `next dev` artefact. This also closes Q-004 and Q-005, and the
> FAIL recorded against `/custom-fields` in `test-matrix.md` is withdrawn.
>
> **The lesson is the one in README.md:** a `redirect()` page must be judged on a production
> build. On the dev server it compiles the target route while holding the request, and what you
> see is the compile, not the page.

### Original record (2026-10-23)

**Severity:** medium **if confirmed** · **Label:** OBSERVED IN BROWSER (dev server only) — **REQUIRES VERIFICATION ON A PRODUCTION BUILD** · **Opened:** 2026-10-23

Three pages exist purely to forward old links somewhere useful. Each is a server component whose
whole body is a `redirect()`:

| Page | Should forward to | Why it exists (from its own code comment) |
| --- | --- | --- |
| `/custom-fields` | `/custom-fields/contact` | "there is no bare index … instead of 404-ing" |
| `/team` | `/team/roles` | "Team is split into /team/roles and /team/employees" |
| `/location-tracking/track-report` | `/location-tracking/health` | "Track Report was merged into Tracking Health … bookmarks still land somewhere useful" |

**What was observed instead:** the URL does not change and the content area renders blank — the
sidebar and the page title are there, the body is empty. Confirmed for `/custom-fields` with a
screenshot after a 10-second wait, and for `/team` and `/location-tracking/track-report` by
repeated reads.

At the HTTP level, `/custom-fields` and `/location-tracking/track-report` answer **HTTP 200 with
no `Location` header**, where a server `redirect()` would normally produce a 307.

**Why this is not yet filed as a defect.** Everything above was measured on the **dev server**,
which in this session has compiled single routes for up to 4.8 minutes and is a plausible source
of this behaviour. A production build would settle it in one minute — and the production build
is currently blocked by an unparsed file in the working tree
(`src/components/settings/pricing-schemes-settings.tsx`, unclosed `<div>` at line 455).

**If it is confirmed**, the customer impact is precisely the case these pages were written to
prevent: an old bookmark to `/team` or `/custom-fields` lands on a blank screen rather than the
page it was meant to reach.

**Distinct from this:** `/reports` is a *client-side* forwarder (`useRouter` in an effect, gated
on `moduleSettingsLoaded`) that picks the first report the plan includes. It shows a proper
"Opening reports…" message. It also had not completed after 8 seconds on the dev server, most
likely because its destination route was still compiling. Re-test it on a production build too.

---

## N-003 — The edge middleware protects nine path prefixes; the rest rely on the client guard

**Label:** VERIFIED IN BROWSER / BY HTTP PROBE (2026-10-23) · **Opened:** 2026-10-23

An unauthenticated request behaves two different ways depending on the path:

| Behaviour | Which paths | Observed |
| --- | --- | --- |
| **307 redirect to `/login`** | the nine prefixes hardcoded in `src/proxy.ts:73` — `/dashboard`, `/follow-ups`, `/inbox`, `/contacts`, `/pipelines`, `/broadcasts`, `/automations`, `/settings`, `/admin` | `/contacts`, `/dashboard`, `/inbox`, `/pipelines`, `/automations`, `/broadcasts`, `/follow-ups` all returned **307** |
| **200 with the app shell**, then a client-side redirect | everything else — `/orders`, `/payments`, `/leads`, `/tasks`, `/expenses`, `/location-tracking/*`, `/team/*`, `/subscription`, … | `/orders`, `/payments`, `/orders/new`, `/location-tracking/overview`, `/location-tracking/visits` and 30+ others returned **200** |

**Evidence:** `src/proxy.ts:72-78` — `const protectedPaths = ['/dashboard', '/follow-ups', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/settings', '/admin']`, then `if (!user && protectedPaths.some(p => pathname.startsWith(p)))` → redirect. Confirmed by probing all 90 static dashboard routes over HTTP with no session.

**This is not a data leak.** The pages are client-rendered, every query is behind RLS, and
`dashboard-shell.tsx` pushes an unauthenticated visitor to `/login`. What a logged-out visitor
gets is an empty shell, not records.

It is recorded because it is a **hardcoded list that did not grow with the app** — the same
pattern that produced the plan-gating leak the `surface-gates.ts` header describes, where three
copies of a gate list drifted. If a server component is ever added under an unprotected path, the
middleware will not stop it reaching the server.

---

## X-001 — Withdrawn: the HTTP 500s seen on 2026-10-23 were a local edit, not a product defect

**Label:** INVESTIGATED AND DISMISSED · **Opened and closed:** 2026-10-23

While probing routes, nine returned **HTTP 500**: `/products`, `/products/new`, `/price-lists`,
`/quotations`, `/quotations/new`, `/reports`, `/reports/ageing`, `/reports/deals`, `/reports/dsr`.

That looks like a serious defect and is not one. Fetching the response body showed the real cause:

> `Error: ./src/components/settings/pricing-schemes-settings.tsx:455:27 Expected '</', got 'jsx text'`

A JSX syntax error in an **uncommitted work-in-progress file** in the working tree. The dev
server's module graph shares client chunks, so one unparseable component turns unrelated routes
into 500s. The committed code at `569fc14` built cleanly minutes earlier (171/171 pages).

Recorded so that nobody re-files these as product bugs. **Lesson for this knowledge base: never
log a defect from a dev-server status code alone — read the error body first.**

---

## F-012 — Open Add Task by its own URL and every dropdown on the form is empty for good

**Severity:** high · **Label:** VERIFIED IN BROWSER (2026-10-27, tenant 001288, production build) ·
**Opened:** 2026-10-27

Load `/tasks/new` directly — a bookmark, a typed URL, a refresh, or a link from a notification —
and the **Assigned To** field shows a raw database id instead of a name:

| Reached by | Assigned To shows |
| --- | --- |
| Typing `/tasks/new`, or refreshing it | `64a7d488-ea4f-416e-aacd-7f88afd21b4b` |
| Clicking **New Task** on the Tasks list (same URL) | **Play Console Admin** |

Same URL, same user, same page. Checked against the database: that id is the real
`profiles.id` of "Play Console Admin" on this tenant, so the value is right and only the
label is missing.

**The visible label is the small half of it.** `src/components/tasks/task-form.tsx:292` loads
*fourteen* lists in one effect — profiles, contacts, deals, products, conversations, custom
fields, quotations, leads, expenses, orders, dispatches, payments, leaves and schemes. It opens
with

```ts
if (!open || !accountId) return;          // line 293
...
}, [open, task, supabase]);               // line 353 — accountId is NOT a dependency
```

On a cold load `accountId` is still null (the profile-load window — the same window as F-005), so
the effect returns early, and because `accountId` is not in its dependency list it **never runs
again** once the account arrives. Every list on the form stays empty for the life of the page:
nothing to link the task to, no customers, no leads, no custom fields. Coming from the Tasks list
the account is already known at mount, so the effect runs and the form is complete.

The raw id surfaces through `src/components/ui/multi-select.tsx:84`, `{option?.label || val}` —
the same "fall back to the raw value" pattern as F-007's `{label[m.key] ?? m.key}`. The fallback
is not the bug, but it is what turns the bug into something the customer sees.

**Why it matters:** a task notification links to this page. The one path a rep is most likely to
arrive by is the broken one.

**The fix:** add `accountId` to the dependency array at line 353. Same rule as F-005 — a value
that is not loaded yet is not a value.

---

## F-008 — Report tiles count records the table underneath refuses to show

**Severity:** medium · **Label:** VERIFIED IN BROWSER (2026-10-27, tenant 001288) ·
**Opened:** 2026-10-27

`/reports/tasks` on this tenant:

| Tiles | Table |
| --- | --- |
| # task **2** · # done 0 · # overdue **2** · Done % 0.00 | **No records found.** Period: 2026-10-01 to 2026-10-31 |

The tenant's two tasks were created outside October, so the rows are filtered by the period and
the tiles are not. A customer reading this sees "2 overdue tasks" and an empty list, and the
obvious conclusion is that records are missing.

Not seen on the other eleven engine reports, because every one of those reads 0 on this tenant —
**they could be doing the same thing and it would not show.** Re-check each on a tenant that has
data outside the current month before clearing them.

---

## F-009 — Two tiles on the Ageing report print no number at all

**Severity:** low · **Label:** VERIFIED IN BROWSER (2026-10-27, tenant 001288) ·
**Opened:** 2026-10-27

`/reports/ageing` renders its measure tiles as bare labels — `# customer` and `# never ordered`
with the value area **empty**. Not `0`: nothing. Every other engine report prints a figure.
It is also the only engine report with no Period chip, while its empty state still names a
period (2026-10-01 to 2026-10-31).

---

## F-010 — The Visits list has no heading and no empty state

**Severity:** low · **Label:** VERIFIED IN BROWSER (2026-10-27, tenant 001288) ·
**Opened:** 2026-10-27

`/location-tracking/visits` with no records shows the filter row and then the pager, with blank
space between them. Every other list prints "No data found." The screen also prints no page
heading. A customer cannot tell an empty list from a list that failed to load.

---

## F-011 — Document Templates settings cannot be opened from its own URL

**Severity:** medium · **Label:** VERIFIED IN BROWSER + IN CODE (2026-10-27) · **Opened:** 2026-10-27

`/settings/document-templates` redirects to `/settings?tab=document`, which renders the
**Overview** panel — the module toggles — not Document Templates. The section's id is
`document_templates` (`settings-sections.ts:106`), and `resolveSection()` aliases only `tags`,
`custom-fields` and `deals` (`settings-sections.ts:145`), so `document` falls through to
`DEFAULT_SECTION`.

The sister route works: `/settings/templates` → `?tab=templates` renders WhatsApp Templates,
because `templates` happens to be a real section id.

This is the third instance of the same trap, after N-002 (`?tab=deals`) and Q-007. The fix is one
alias, or changing the redirect to `?tab=document_templates`.

---

## N-004 — `/deals` and `/pipelines` are the same screen (note, not a defect)

**Label:** VERIFIED IN BROWSER (2026-10-27, tenant 001288) · **Opened:** 2026-10-27

Both URLs render "Deal Pipelines" with the same six tiles and the same ten columns. The sidebar
links `/pipelines`; `/deals` is the one people type. Worth knowing before answering "which page
is the customer actually on" — the answer is: it does not matter.

---

## F-013 — The account owner cannot open Add Product by its URL

**Severity:** high · **Label:** VERIFIED IN BROWSER (2026-10-27, tenant 001288, production build,
reproduced twice with an 8-second wait) · **Opened:** 2026-10-27

Type `/products/new`, or refresh it, and the **owner of the account** is thrown back to
`/products`. Click **New Product** on that list and the same URL renders the full form.

`src/app/(dashboard)/products/new/page.tsx`:

```ts
const { hasPermission, loading } = useAuth();
const canCreateProducts = hasPermission("create_products");
useEffect(() => {
  if (!loading && !canCreateProducts) router.replace("/products");
}, [loading, canCreateProducts, router]);
```

This is F-005 again. `loading` goes false as soon as the *session* is known, before the profile
row lands, and in that window `hasPermission()` returns false for everyone — the owner included.
The gate reads that false as "no" and navigates away. The guard is correct in intent; it is
gating on the wrong flag.

**Commit `9b0a358` did not cover this one.** That commit converted sixteen gates that *render* a
refusal. This gate *redirects*, so it did not match the pattern that was searched for, and the
same `permissionGateState` rule applies: gate on `profileLoading`, not `loading`.

**Worth sweeping for:** any other `router.replace`/`router.push` guarded by `!loading &&
!hasPermission(...)`. That sweep has not been done.

---

## F-014 — The customer detail page lists every predefined field a second time, empty

**Severity:** medium · **Label:** VERIFIED IN BROWSER (2026-10-27, tenant 001288) ·
**Opened:** 2026-10-27

> **FIXED 2026-10-27 — commit `6d28edc`, on `main` and deployed.** Verified in the browser on a
> production build: the thirteen dashes are gone, replaced by the two predefined fields nothing
> else on the page showed — Customer Code and WhatsApp Number — with their real values.
>
> Fixed with the shape the **product detail page** already used for the same problem: drop the
> system keys drawn above, read the rest from the row, hide the empty ones.

On `/contacts/[id]`, after **Customer Details** and **Address & Location** have shown the real
values, an **Other Details** block repeats thirteen of the same fields — Area/Locality, City,
Company Name, Contact Person, Country, Customer Code, Customer Level, Email Address, Phone
Number, Pincode/ZIP, State, Street Address, WhatsApp Number — every one of them showing `—`.

Checked on a customer with a full address, a phone number and coordinates: the data is there, and
the first two blocks print it correctly. The repeat block is reading the `custom_fields` rows for
the predefined fields, which carry no `contact_custom_values` because those values live in the
contacts table's own columns.

**Why it matters:** this is the screen a support call lands on. A customer looking at thirteen
dashes concludes their data was lost.

---

## F-015 — An employee's email is title-cased on the detail page

**Severity:** low · **Label:** VERIFIED IN BROWSER (2026-10-27, tenant 001288) ·
**Opened:** 2026-10-27

`/team/employees/[id]` prints the Login Details email as `Testplayconsole@Gmail.Com`. The same
address is correct in the page header. A `capitalize` text transform is being applied to a value
that must never be transformed — someone reading the screen to type a login in will type the
wrong thing, and it makes the record look wrong next to the header.

---

## N-005 — Import module keys are plural, custom-field module keys are singular (note, not a defect)

**Label:** VERIFIED IN BROWSER (2026-10-27) · **Opened:** 2026-10-27

The same module is spelled two different ways depending on the screen:

| Screen | Key | Example |
| --- | --- | --- |
| Import | **plural** | `/import/contacts`, `/import/products`, `/import/leads` |
| Custom fields | **singular** | `/custom-fields/contact` |

`/import/contact` — the singular form — is not an unknown-page error. It renders the generic
panel: *"This module import is coming soon. The Universal Import engine is live and this module
is next in line."* So a mistyped URL reads as a feature that has not been built yet. Before
telling a customer that import is not available for their module, check the spelling of the key.

The registered import keys are `contacts`, `products`, `product_categories`, `product_units`,
`leads`, `territories`, `tasks`, `price_lists`, `outstanding`, `stock`, `customer_assets`.

---

## F-016 — The Broadcasts page crashes for every tenant

**Severity:** high · **Label:** VERIFIED IN BROWSER (2026-10-27, tenant 001288, production build,
reproduced twice) · **Opened:** 2026-10-27

> **FIXED 2026-10-27 — commit `372802b`, on `main` and deployed.** The two early returns now
> sit below every hook, so the hook count is the same on every render. Verified in the browser on
> a production build: the page renders its list and its empty state.
>
> **The sweep that came with it:** every component in the codebase was checked for
> `react-hooks/rules-of-hooks`, and this was the **only** violation — so no other page is
> crashing this way.
>
> **The uncomfortable part:** `npm run lint` already caught this, naming it exactly ("Did you
> accidentally call a React Hook after an early return?"). It shipped because lint was not clean.

`/broadcasts` does not render. It shows the error-boundary card:

> **This page couldn’t load** — Reload to try again, or go back. [Reload] [Back]

The console throws **React error #310 — "Rendered more hooks than during the previous render"**,
from a `useMemo`.

**Cause, in one file.** `src/app/(dashboard)/broadcasts/page.tsx`:

| Line | What |
| --- | --- |
| 131 | `if (loading) return <spinner/>` |
| 139 | `if (error) return <retry/>` |
| **218** | `const visibleBroadcasts = useMemo(...)` |

`loading` starts `true`, so the first render takes the early return and runs *N* hooks. The next
render gets past both returns and reaches the `useMemo`, running *N+1*. React refuses, and the
error boundary catches it.

**This is not tenant-specific and not data-dependent.** `loading` always starts true, so every
first paint of this page takes that path. Any account that can reach Broadcasts sees the crash.

**The fix is to move the `useMemo` above the two early returns** — hooks must run in the same
order on every render, so no hook may sit below a conditional `return`.

**Why nobody reported it:** Broadcasts needs the `whatsapp` module *and* a Meta-approved
template. Tenants that have neither never open the page.

**Found by opening the page** — it had been recorded on 2026-10-24 as "code read only, route
compiles and serves". It does serve; it is the client render that dies. A route that answers
HTTP 200 has not been verified.

---

## N-006 — The browser console buffer is cumulative; errors follow you between pages

**Label:** VERIFIED IN BROWSER (2026-10-27) · **Opened:** 2026-10-27

While confirming F-016 the same React #310 trace appeared in the console on `/inbox` and then on
`/products`, neither of which is broken — both render correctly. The console reader returns the
session’s accumulated messages, not the current page’s.

**So never attribute a console error to a page by reading the console alone.** Confirm it the way
F-016 was confirmed: the page itself visibly fails, and the failure reproduces on a direct load.
`/inbox` was nearly recorded as broken on this evidence.

---

## Open questions

| # | Question | Status |
| --- | --- | --- |
| Q-001 | Does any screen tell the user *why* a plan-gated route bounced them? | Open — see F-001 |
| Q-002 | How is the Tasks list meant to be reached? | **Answered**: it is not reachable from the menu. `/tasks` itself works — VERIFIED IN BROWSER, 2 records, Import / New Task / Hide Completed / Manage Column / paging all present. Entry is by URL or a task notification. Founder decision needed: add a nav row, or leave it to notifications. |
| Q-003 | What is `/field-staff` for, and how does a customer reach it? | **Partly answered**: it renders "Active Sessions" + "Live Map", both empty on this tenant — VERIFIED IN BROWSER. It overlaps Location Tracking → Live Feed (`/location-tracking/dashboard`). No menu entry anywhere. Founder decision needed: is it superseded? |
| Q-004 | Is `/location-tracking/track-report` live? | **CLOSED 2026-10-27**: it redirects to `/location-tracking/health` — Track Report was merged into Tracking Health. VERIFIED IN BROWSER on a production build. |
| Q-005 | Does `/team` render anything? | **CLOSED 2026-10-27**: it redirects to `/team/roles`. VERIFIED IN BROWSER on a production build. |
| Q-007 | Do the three `redirect()` index pages serve a blank page? | **CLOSED 2026-10-27**: no. All three redirect correctly on a production build; the blank page was the dev server. |
| Q-008 | Are the other eleven engine reports counting outside the period like `/reports/tasks` does? | Open — every one of them reads 0 on tenant 001288, so F-008 could not be ruled out. Needs a tenant with records outside the current month. |
| Q-009 | Which other permission gates `router.replace` during the profile-load window? | Open — F-013 found one that commit `9b0a358` missed. No sweep has been done. |
| Q-006 | Does an owner's Access Denied panel self-heal once the profile arrives, or does it stick? | **Answered: it self-heals.** Timed on 2026-10-23 at roughly 5 seconds on `/territories`. See F-005. |
