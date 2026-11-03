# Evidence index

Every screenshot and verification run behind the claims in this knowledge base. If a claim is
labelled VERIFIED IN BROWSER, its evidence is listed here.

## Verification runs

| Date | Tenant | Signed in as | Environment | Scope |
| --- | --- | --- | --- | --- |
| 2026-10-23 | **001288** "Play Console", plan CRM + SFA | the account **owner** (`account_role = owner`, confirmed in the database) | local dev server (`npm run dev`) against the **production** Supabase project | Read-only. 19 screens opened and read; no form submitted, no record created, changed or deleted, no setting altered |
| 2026-10-23 | **001001** — the live account, legacy `Enterprise` plan | signed in by the founder himself; Claude never saw the credentials | same | Read-only. The screens the test tenant could not reach: Stock, Price Lists, Route Management (list, planner, Manager Inbox, Route Monitor), Dispatch, Pending Dispatch, Attendance, Getting Started, Import. **Real customer data on screen: no customer, contact, phone or email from this account is reproduced anywhere in this knowledge base.** |
| **2026-10-27** | **001288** only | the account **owner**, signed in with the admin row of the Play Console closed-test login sheet | **production build** (`npm run build` + `next start`) against the production Supabase project | Read-only. **63 further screens opened**, taking the total examined to 91 of 171 routes. No form submitted, no record created, changed or deleted, no setting altered. Eight defects found, three open questions closed |

### Why the 27 October run was done on a production build

The 23 October run was on `next dev`, and three of its findings turned out to be artefacts of the
dev server rather than product faults — the blank `redirect()` pages (Q-007, closed). A built
server serves every route with no compilation, so a slow or blank page means something.

### Why the 24 October attempt produced nothing

Twenty-one routes were recorded BLOCKED on 24 October with the reason "the Browser pane could not
be un-hidden" — navigation really does hang while the pane is hidden. Showing the pane first
removes the blockage entirely. Five of those routes (the whole WhatsApp suite) were opened on
27 October with no difficulty, and one of them turned out to be crashing (F-016).

### Method

- Pages were read as text (`get_page_text`) rather than judged from screenshots, so the columns,
  actions and empty-state wording quoted in `ui-inventory.md` are the page's own words.
- Where the browser and the database disagreed, the database was queried read-only to settle it.
  This is how the "0 products" reading was traced to the F-005 loading window rather than to
  missing data, and how the raw id on the Add Task form was confirmed to be a real `profiles.id`
  (F-012).
- Where a page looked broken, it was **reproduced on a second direct load** before being written
  up. One candidate defect was dropped this way: `/contacts/new` showed an empty form on its
  first hit after a build and filled in on its own — cold-load slowness, not a fault.
- Console errors were **not** treated as evidence on their own. The console buffer is cumulative
  across navigations (N-006), so the same React error appeared on three pages of which only one
  was actually broken.

## Screenshots

Four, all from the 23 October run. The first is from tenant 001288 (seeded test data); the others
are from the live account 001001 but show **no customer records** — one is a counts-only setup
panel, one an empty page. No screenshot in this knowledge base contains a real customer name,
phone number or email.

**The 27 October run added no screenshots.** It was a text-reading pass; every claim from it
quotes the page's own words and is reproducible by opening the route.

| File | Shows | Supports |
| --- | --- | --- |
| [`evidence/2026-10-23-territories-owner-access-after-load.jpg`](evidence/2026-10-23-territories-owner-access-after-load.jpg) | Territory Master open for the owner: 799 territories, Export / Import / Add Territory, Manage territories + Hierarchy & assignment tabs, Show archived (0), and the "Link old customer locations to this list" backfill helper | **F-005** — the same page that had said "Access Denied" seconds earlier in the same page load. **The defect is fixed as of 2026-10-27 (`9b0a358`); the screenshot now documents history** |
| [`evidence/2026-10-23-customers-list-696-records.jpg`](evidence/2026-10-23-customers-list-696-records.jpg) | The Customers list with the full sidebar, "Total: 696 records", search, Import, Add Customer, the filter row, Active badges, per-row MAP links, MANAGE COLUMN and "1 - 10 of 696" paging | The shared list behaviour in `ui-inventory.md`, and the Customer screen's columns |
| [`evidence/2026-10-23-getting-started-raw-metric-keys.jpg`](evidence/2026-10-23-getting-started-raw-metric-keys.jpg) | The Getting Started health panel: Territories / Roles / Employees labelled properly, and six tiles showing `lead_count`, `deal_count`, `quotation_count`, `product_count`, `price_list_count`, `order_count` | **F-007** — re-confirmed in the browser on a production build on 2026-10-27, still open |
| [`evidence/2026-10-23-custom-fields-blank-redirect-page.jpg`](evidence/2026-10-23-custom-fields-blank-redirect-page.jpg) | `/custom-fields` after a 10-second wait: header and sidebar present, content area completely empty, URL unchanged | **Q-007 — now closed as NOT a product defect.** On a production build the same URL redirects to `/custom-fields/contact` and renders. This screenshot is kept as the record of a dev-server artefact, so the same wrong conclusion is not drawn twice |

## What is not evidenced yet

Stated plainly so nothing here is mistaken for complete.

As of the 2026-10-27 run: **83 PASS · 8 FAIL · 76 BLOCKED · 4 NOT TESTED**, of 171 routes.

- **Four routes are simply outstanding:** `/print/list`, `/print/report`, `/print/quote` and
  `/settings/document-templates/new`.
- **Twenty-nine founder-only `/admin` routes have not been opened.** Reaching them means signing
  in as the founder against the live database, which is deliberately outside a read-only tenant
  pass.
- **Everything transactional is unseen, because tenant 001288 holds no transactions.** No order,
  quotation, payment, dispatch, expense, leave record or visit exists on it, so none of their
  detail or print screens could be opened. **A seeded demo tenant with real transactional data is
  what the next pass needs** — it would also settle Q-008.
- **Schemes and all of FSM still cannot be verified anywhere.** The `scheme` module is off on both
  accounts, and no tenant holds an FSM plan. Both gates were confirmed in the browser (F-001) but
  their screens remain unseen.
- **No screen has been verified for a non-owner role.** Everything above is the owner's view. The
  "why can an admin see it but a rep cannot" questions are still unanswered by observation, and
  that is the single biggest gap for support work.
- **Nothing on mobile has been verified.** The Android app is a separate build and would need an
  APK on a device.
- The screenshots were taken in a narrow browser pane with an emulated viewport, so **they are
  evidence of content, not of layout at a real desktop size.** The 27 October run used an
  emulated 1440×900 viewport for the same reason.
- **Layout claims written on 2026-10-23 predate the design system** (`b82796d` → `d820882`) and
  the header-slot change (`130a9d3`), both of which landed on 26 October. Behaviour still holds;
  wording about where a control sits may not.
