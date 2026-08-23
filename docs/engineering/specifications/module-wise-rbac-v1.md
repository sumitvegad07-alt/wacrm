# Module-wise RBAC v1 — canonical permission catalog + DB enforcement

**Status:** In build (Claude Code, direct). Core modules first.
**Source:** Founder request 2026-08-23, following Hardening Sprint 1. Fixes two live gaps:
(1) no permission for changing a product's price while ordering; (2) delete-customer blocked
in UI despite `delete_contacts` existing (Sprint-1 made contacts/products writes admin-only,
bypassing the key model).

## Problem

`employee_roles.permissions` (JSONB) is the soft business-permission layer. Today it is
inconsistent: dual keys (`add_*` vs `create_*`), a `{"all":true}` wildcard on 13/23 roles,
and **no product-edit keys**. Sprint-1 RLS hardening closed the security holes but did so with
blunt `admin`-only gates on products/contacts/leads, which ignore the role checkboxes.

## Goal

A **module × action** catalog: every module exposes a consistent set of rights
(view/create/edit/delete/import/export + module-specific), rendered grouped-by-module in the
Roles editor and **enforced in the database** for the destructive/financial actions. No
existing role loses access on rollout.

## Two axes (do not conflate — see engineering-handbook "two layers")

- **System role** (`profiles.account_role`: owner/admin/agent/viewer) — hard floor. Viewer is
  read-only *always*; write policies keep an `is_account_member(account_id,'agent')` floor so a
  viewer with a checkbox still cannot write.
- **Action keys** (`employee_roles.permissions`) — module-wise, resolved by `has_permission()`
  (owner/admin bypass; `{"all":true}` bypass; `add_`/`create_` alias; `prefix_*` wildcard).
- **Scope** (own/team/all) — unchanged this pass (payments already uses it).

## Canonical key catalog — core modules (this build)

| Module | Keys (canonical) |
|---|---|
| Catalogue | view_products, **create_products, edit_products, delete_products, import_products, export_products, manage_product_units, manage_product_categories** |
| Customers | view_contacts, create_contacts, edit_contacts, delete_contacts, **import_contacts, export_contacts** |
| Orders | view_orders, create_orders, edit_orders, **delete_orders**, apply_order_discount, **override_order_price**, manage_order_status, **export_orders** |
| Dispatch | **view_dispatch, create_dispatch, edit_dispatch, delete_dispatch** |
| Payments | view/create/edit/cancel/approve/reject/backdate (exist) |
| Stock | view_stock, manage_stock (exist), **import_stock** |

Fast-follow (not this build): Leads (convert/import/export), Deals (create/edit/delete),
Quotations (view/create/edit/delete/print), Expenses (approve/delete), Leave, Schemes, Routes,
Reports (view/export per family). Keys reserved in the registry; policies added later.

## Enforcement (DB) — this build

Replace Sprint-1 admin-only gates with key gates, keeping the agent floor:

```
<table>_<op> USING/CHECK:  is_account_member(account_id,'agent') AND has_permission(auth.uid(), account_id, '<key>')
```

- products: insert→create_products, update→edit_products, delete→delete_products
- contacts: delete→delete_contacts (restores the checkbox)
- leads: delete→delete_leads
- order_dispatches: insert→create_dispatch, update→edit_dispatch
- orders: delete→delete_orders
- `has_permission()` gains the `add_`/`create_` bidirectional alias (mirror the client) so a
  single canonical key in a policy also matches the legacy spelling.

Price-override (`override_order_price`) and discount (`apply_order_discount`) are **UI-gated on
the order form** this pass (the price/discount inputs); DB enforcement of a line-price override
(comparing `locked_price` to catalogue inside `create_order`/`update_order`) is a fast-follow.

## Backfill / non-breaking rollout

- `{"all":true}` roles → pass everything via `has_permission` (no data change needed).
- Legacy `add_*` → resolved by the alias; optional data normalization to `create_*` is
  deferred (both keep resolving).
- Products/contacts were admin-only under Sprint 1, so key-gating only *expands* what an admin
  can grant an agent — it removes nothing. Prove `0` real users lose access before push.

## Definition of Done

- **Functional:** roles editor shows module-grouped rights; ticking a right grants exactly that
  action; viewer stays read-only.
- **Security:** destructive/financial actions enforced in RLS via `has_permission` + agent floor;
  proven live (grant → allowed; no-key → blocked; viewer+key → blocked; `{"all":true}` → all).
- **Non-breaking:** 0 real users locked out (verified on prod data in a rolled-back txn).
- **Production readiness:** migration applied via Supabase; web changes typecheck + pushed to main.
- **Docs:** this spec; registry comments; handbook note on the module-wise model.
