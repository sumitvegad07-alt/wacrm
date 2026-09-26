# Sales Proposal Builder — Design

**Date:** 2026-09-26
**Status:** Approved for planning
**Owner:** Founder (platform owner only)

## Problem

The OZZO SFA sales proposal exists as one hand-edited file, `C:\Wacrm\docs\proposals\proposal.html`
(8 A4 pages, rendered to PDF through headless Chrome). Its `{{...}}` tokens are documentation, not
real placeholders — every value is hardcoded in the page body, most of them in more than one place.
Producing a proposal for a second company therefore means a careful manual search-and-replace, with
no record afterwards of what was quoted to whom.

The founder needs to produce these proposals himself by filling in a form, download the result as a
PDF, and later look up the prices he quoted in the past. The same mechanism must extend to the CRM
and WFA plan proposals once SFA is done.

## Scope

**In:** a founder-only proposal builder inside the CRM portal — form, stored history, duplicate,
and a print view that Chrome saves as PDF. One plan template (SFA), behind a registry that admits
more plans later.

**Out:** win/loss or pipeline tracking (price history is the requirement, not a CRM for OZZO's own
sales); editing of OZZO feature copy, terms or theme (locked so every proposal stays on-brand);
emailing the proposal; tenant-facing access of any kind.

## Decisions

1. **PDF via print route, not a server-side PDF library.** The proposal renders at
   `/print/proposal/[id]` and a Print button calls `window.print()`; Chrome's "Save as PDF" produces
   the file. This is the pattern every other document in the app already uses (`/print/order/[id]`,
   `/print/quotation/[id]`, `/print/payment/[id]`, `/print/dispatch/[id]`) and the app carries no PDF
   dependency at all. The source document is already print-native: `@page { size:A4; margin:0 }` with
   fixed `210mm × 297mm` sections and `page-break-after: always`. Fidelity is identical to the
   existing PDF because it is the same rendering engine.

   *Rejected:* bundling Chromium into a Vercel function (~50MB, multi-second cold starts, pushes the
   function size limit, a dependency that breaks on upgrades) to save one dialog. *Rejected:*
   client-side jsPDF/html2pdf — this design uses gradients, custom fonts, absolutely-positioned
   bands and a full-bleed dark cover, which those libraries mangle.

2. **Platform-level storage, RLS-denied, service-role only.** Proposals are OZZO's own sales records,
   not any tenant's data, so the table carries no `account_id` and no tenant policy. RLS is enabled
   with no policies for `authenticated`; all access goes through `/api/admin/proposals` behind
   `requireFounder()`, using `serviceClient()`. This is the doctrine already documented in
   `src/lib/auth/superadmin.ts`: verify the caller on their own session, then read with the
   service-role key. Consequence: unreachable by any tenant, and unreachable by a second superadmin
   or a compromised superadmin session.

3. **Template registry keyed by plan line.** The stored row keeps `plan` plus a `data` JSON payload.
   A registry maps a plan to its field schema and its page component. Adding the CRM proposal later
   is a new registry entry, not a second builder.

## Architecture

```
src/app/(superadmin)/admin/proposals/
  page.tsx                     server; requireFounder() → 404; renders list
  proposals-client.tsx         list + New + Duplicate + Open PDF
  [id]/page.tsx                server; requireFounder(); loads one row
  [id]/proposal-form.tsx       client; form built from the plan's field schema

src/app/print/proposal/[id]/
  page.tsx                     server; requireFounder() → 404; renders template
  print-button.tsx             mirrors the existing payment print button

src/app/api/admin/proposals/
  route.ts                     GET list, POST create
  [id]/route.ts                GET one, PATCH update, DELETE

src/lib/proposals/
  types.ts                     ProposalData, LineItem, FieldSchema
  registry.ts                  plan → { schema, defaults, component }
  totals.ts                    pure money math (subtotal, GST, grand total, per-month, savings)
  ref.ts                       reference-number generation
  templates/sfa/
    sfa-proposal.tsx           the 8 pages as JSX
    sfa-proposal.css           the document CSS, carried over unchanged
    defaults.ts                field schema + Shaahi Niti wording as starting values

supabase/migrations/
  20260926120000_platform_proposals.sql
```

Navigation: a **Proposals** item is added to `NAV_ITEMS` in `admin-shell.tsx`, rendered only when
`isFounderEmail(user?.email)` — `src/lib/auth/founder.ts` is client-safe by design. Other
superadmins never see the link, and the server gate 404s them if they guess the URL.

## Data model

```sql
create table platform_proposals (
  id             uuid primary key default gen_random_uuid(),
  ref            text not null,
  plan           text not null default 'SFA',
  client_name    text not null,
  proposal_date  date not null,
  gst_enabled    boolean not null default false,
  users_total    integer not null default 0,
  annual_total   numeric(12,2) not null default 0,
  grand_total    numeric(12,2) not null default 0,
  data           jsonb not null default '{}'::jsonb,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table platform_proposals enable row level security;
-- no policies: authenticated has no access; reads/writes go through the
-- service-role key behind requireFounder().
```

The list columns are denormalised out of `data` on write so the history view answers "what did I
quote them" without parsing JSON: `ref`, `client_name`, `proposal_date`, `users_total`,
`annual_total`, `grand_total`, `gst_enabled`. `data` holds the full editable payload.

`data` shape:

```ts
interface ProposalData {
  ref: string;
  proposalDate: string;        // ISO date
  validDays: number;
  client: { name: string; shortName: string; industry: string; website: string; address: string };
  preparedBy: { name: string; phone: string; email: string };
  voice: { built: string; industryPlural: string; builtFor: string };
  lineItems: LineItem[];       // { label, subLabel, users, rate }
  gstEnabled: boolean;
  gstRate: number;             // 18, stored so a future change is data not code
}
```

## Derived values — never typed

Each of these is hardcoded in two or more places in the current file, which is exactly where manual
editing would produce a self-contradicting document. `totals.ts` computes them once:

| Value | Derivation | Appears in |
|---|---|---|
| Annual subtotal | `Σ users × rate` | price table total row, savings/GST panel, "covers everything" heading, terms |
| Total users | `Σ users` | price table total row |
| Per-user per-month | `rate / 12`, rounded | price hero (`≈ ₹300 / user / month`), page-6 bullet ("₹300/user/month, all in") |
| GST amount | `subtotal × gstRate / 100` | savings panel (as the saving) or GST rows (as the charge) |
| Grand total | `subtotal + (gstEnabled ? gst : 0)` | price table, "covers everything" heading, terms |
| Page footers | client full name | 7 inner pages |
| Page-6 heading | client short name | "Why <short name> chooses OZZO" |

## GST switch

Off reproduces today's document exactly. On makes five coordinated changes — any one alone leaves
the proposal arguing with itself:

| Element | GST off | GST on |
|---|---|---|
| Investment heading | "One price. Every module. **No GST to add.**" | "One price. Every module. **Every user.**" |
| Price table | single "Total payable / year" row | Subtotal, `+ GST 18%`, Total payable |
| Panel below table | "No GST — you save 18% … ₹X saving" | "GST at 18% — ₹X — is billed as shown above." |
| "Covers everything" heading | flat total | grand total |
| Terms clause | "No GST is charged on this proposal…" | "GST at 18% is charged as shown on the Investment page." |

## Reference numbers

Format `OZZO/YYYY/MM/<INITIALS>-<NN>`, matching `OZZO/2026/09/SNM-01`. Initials come from the
company name's word initials (max 3, A–Z only); `NN` is the count of proposals already created in
that calendar month plus one, zero-padded. Generated server-side on create, then freely editable —
the founder's numbering is his own.

## Duplicate

Clones a stored proposal's `data` into a new draft with a freshly generated `ref` and today's date,
leaving everything else — company, wording, pricing — for editing. This is the shortest path to the
stated goal of reusing the Shaahi Niti proposal for the next company.

## Template port

The 8 pages move from `docs/proposals/proposal.html` into `sfa-proposal.tsx` with the CSS carried
over intact (it is standalone, not Tailwind, and already print-correct). Two changes only:

- The ~100KB base64 PNG inlined into `--logo` becomes a `/public` asset reference, so the route is
  far lighter than the file.
- The Google Fonts `<link>` moves to the print route's document head.

`docs/proposals/proposal.html` stays in place as the visual reference to diff against.

## Error handling

- **Gating:** `requireFounder()` throws `ForbiddenError`/`UnauthorizedError`; API routes convert via
  the existing `toErrorResponse()`, pages call `notFound()` so the route's existence is not revealed.
- **Missing proposal:** print route and detail page render a plain "Proposal not found", matching
  the existing print routes.
- **Bad input:** users and rate coerce to numbers; a proposal with no line items saves but the price
  table renders empty rather than `NaN` — totals treat missing values as 0.
- **Validation:** company name is required to create; every other field may be left
  blank and simply renders blank, including the line-item table.

## Testing

Unit (vitest, the existing suite):
- `totals.ts` — subtotal, user count, per-month rounding, GST amount, grand total; GST on and off.
- `ref.ts` — initials extraction (single word, three words, punctuation, lowercase), month sequence
  and zero-padding.
- `registry.ts` — the SFA schema's defaults produce a complete, renderable payload.

Route guard:
- `/api/admin/proposals` returns 401 unauthenticated, 403 for a superadmin who is not the founder.

Manual, before calling it done:
- Render all 8 pages in the browser, GST off, against the existing Shaahi Niti PDF — they should be
  indistinguishable apart from the data.
- GST on: confirm all five swaps and that no "no GST" wording survives anywhere.
- Chrome print preview: 8 pages, no blank ninth page, no clipped content.

## Delivery

Migration applied to production manually by the founder (the in-session classifier blocks applying
migrations), then web committed and pushed to `main` for Vercel, per standing project rules. Not
"done" until deployed with a commit hash reported.
