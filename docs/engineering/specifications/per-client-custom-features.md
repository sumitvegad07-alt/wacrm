# Per-client custom features

Built 2026-11-27. The answer to "this one client wants something we do not want
every client to have."

## The rule

**One app in the stores. One portal. One deploy.** A customisation is a switch,
not a second app and not a branch.

- Play Store / App Store: the same listing for everybody, the same link.
- `app.ozzo.co.in`, `dms.ozzo.co.in`: the same URLs for everybody.
- The custom behaviour lives in the same build, **off for everyone**, and is
  switched on for one account.

Why this and not the alternatives:

| Alternative | What it really costs |
| --- | --- |
| A second, white-label app | A second store listing, a second review for every release, a second build to fix every bug — forever. Only worth it when the client insists on their own brand, and then it is charged for separately. |
| An APK sent by hand | Auto-update stops; every update becomes a phone call. |
| The same for iPhone | Not possible for a paying client. Outside the App Store, Apple allows only the Enterprise programme ($299/yr, a registered company, and audited as employee-only) or TestFlight, where every build expires after 90 days. |

## The three pieces

1. **The catalogue — code.** `src/lib/plans/custom-features.ts`. One entry per
   switch: key, label, description, who asked, when, which apps it touches,
   whether it is retired. It is code because a switch with no code behind it
   does nothing; keeping it here means `tsc` and
   `src/lib/plans/custom-features.test.ts` catch a mistyped key, and the
   register can never list something that does not exist.
2. **The grant — data.** `accounts.custom_features text[] NOT NULL DEFAULT
   '{}'`, migration `20261127120000`. Who holds a switch changes without a
   deploy; that is the whole point.
3. **The register — generated.** `/admin/custom-features` lists every switch and
   every company that holds it, plus any key stored on an account that this
   build does not know (typed by hand, or deleted from the code instead of
   retired — it grants nothing, so it is reported rather than ignored).

## Granting one

`/admin/companies/[id]` → **Custom features** → tick → Save. That screen and the
Supabase SQL editor are the only two doors:

- `guard_account_commercial_columns()` refuses the column from an
  `authenticated` or `anon` session, so a tenant admin cannot grant themselves
  one (the same guard that protects plan, add-ons, seats and expiry).
- `/api/admin/accounts/[id]` validates every key against the catalogue and
  writes with the service role. A **retired** key may be removed from an
  account that holds it but never granted to a new one.
- The guard also refuses a key that is not `lower_snake_case`, for every writer
  including the SQL editor — a key with a capital or a space grants nothing and
  cannot be seen on screen.

## Honouring one in code

```ts
// Web — anywhere inside the dashboard
const { hasCustomFeature } = useAuth();
if (hasCustomFeature("acme_crate_label")) { /* … */ }

// Web — a whole screen, in src/lib/plans/surface-gates.ts
{ prefix: "/acme-crates", line: "sfa", customFeature: "acme_crate_label" }

// Web — a menu entry, in src/components/layout/sidebar.tsx
{ href: "/acme-crates", label: "Crates", icon: Boxes, customFeature: "acme_crate_label" }

// Mobile — lib/auth-context.tsx
const { hasCustomFeature } = useAuth();

// DMS portal — lib/portal/api.ts
const keys = await portalCustomFeatures();

// SQL (RLS, definer functions)
select public.account_has_custom_feature(p_account_id, 'acme_crate_label');
```

Everything **fails closed**: not granted, not loaded, context forgot to pass the
callback — all read false. This is the opposite of `hasLine` on mobile, which
fails open so a paid feature is never wrongly hidden. Here the expensive mistake
is the other direction: one client's screen showing up for every tenant.

## Adding a new one

1. Add the entry to `CUSTOM_FEATURES` in the same change as the code that
   honours it. Never in advance.
2. Gate the code on it (`hasCustomFeature`, `customFeature:` on a gate or nav
   item, or `account_has_custom_feature` in SQL).
3. Ship it. If the behaviour is web-only, nothing else is needed. If it touches
   mobile, it needs an APK/iOS release — **one release, for everybody**, with
   the feature hidden for everybody but the account that holds the switch.
4. Tick it on that company. The register then shows who has it.

## Keeping the list short

- Charge for a customisation: one-time to build, yearly to keep working.
- **When a second client asks for the same thing, it stops being custom.** Make
  it an ordinary setting or module for everyone, default OFF, mark the key
  `retired: true` with a `retiredNote`, and leave it on the accounts that
  already hold it until someone unticks it on purpose.
- Most requests need no switch at all: an extra field is **Custom Fields**, a
  different print format is **Document Templates**, a different rule is usually
  an **account setting**.

## Known limits

- `/admin/view-as` does not evaluate `customFeature` (it already ignores
  `line` and `anyLine`), so it shows a custom screen as visible. Read the
  register instead.
- Nothing in the catalogue yet, by design. The machinery changes no behaviour
  for any tenant until the first entry is added.

Tests: `src/lib/plans/custom-features.test.ts`,
`src/lib/plans/surface-gates.test.ts` (the `customFeature gates` block),
`src/lib/auth/account-select.test.ts` (the column ladder),
`supabase/tests/88_custom_features.sql` (the guard, cross-tenant isolation, key
shape, and the portal read).
