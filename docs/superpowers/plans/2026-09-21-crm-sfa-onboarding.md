# CRM + SFA Getting Started — line-composed journey

**Approved 2026-09-21.** Model: compose by line (one journey = union of the plan's
lines, deduped). Build CRM + SFA together. Keeps `template_key='wfa_v1'` as the
composite (no re-enrollment of existing accounts).

## Mechanism
- Add `line` column to `impl_steps` + `impl_milestones` (`core|crm|wfa|sfa`).
- One composite template (reuse `wfa_v1`). Loader shows a step when
  `line = 'core'` OR the account's plan grants `line` (via `planLines`).
- Progress/Score/Health already compute over "applicable" steps → line filter
  folds into applicability.
- **Deploy-safe:** loader treats a missing/null `line` as always-applicable, so
  code deployed before the migration behaves exactly like today.

## Gating changes
- Loader: drop the template-level `templateLineAllowed(plan, product_line)` lock
  (would lock CRM-only accounts out of the whole guide); gate per-step by `line`.
- Sidebar "Getting Started": was `line:"wfa"` → show for any plan.
- Fresh-signup redirect to `/getting-started/welcome`: was `hasWFA` → any plan.

## Step groups (step_key · page · resolver)
**core** (every plan): customer_creation `/contacts` customer_count · role_creation
`/team/roles` role_count · employee_creation `/team/employees` employee_count
**crm**: lead_capture `/leads` lead_count · deal_pipeline `/deals` deal_count ·
quotation_first `/quotations` quotation_count · whatsapp_connect (opt) · crm_dashboard `/dashboard` (data-driven)
**wfa** (existing): territory_setup · assignment_method · mobile_login · first_activity · see_live_data
**sfa**: product_setup `/products` product_count · pricing_setup `/price-lists`
price_list_count · order_first `/orders` order_count · scheme_setup (opt) · sales finale

## New resolvers
lead_count(`leads`), deal_count(`deals`), quotation_count(`quotations`),
product_count(`products`), price_list_count(`price_lists`), order_count(`orders`).

## New tours + anchors
leads (add lead), deals (add deal), quotations (new quotation), products (add
product), price-lists (new price list), orders (new order). Data-driven
(markDone:false), reuse the area-wise pattern where relevant.

## Slices
1. **Engine** — `line` column, retag wfa steps (shared→core), loader filter +
   gating/sidebar/redirect changes, resolver stubs. WFA journey unchanged
   (regression). CRM account sees core steps only (valid partial).
2. **CRM** — seed crm steps + milestones, resolvers, tours + anchors.
3. **SFA** — seed sfa steps + milestones, resolvers, tours + anchors.

Each slice: migration file (founder applies — classifier blocks in-session) +
code + tsc/tests/build + commit.
