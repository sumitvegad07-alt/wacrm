# Run this SQL — Buying Status (Buyer / Yet to Buy)

One file. **The web screens are already live, but the switch in Organisation Settings does
nothing until the SQL below has been run.**

Open Supabase → SQL Editor → paste the file, Run. It is safe to run twice.

| File | Adds |
|------|------|
| `supabase/migrations/20261103140000_buying_status.sql` | Buyer / Yet to Buy on every customer, worked out from order history |

---

## What it is

A second status on a customer, beside Active / Inactive:

| | Asks |
|---|---|
| **Active / Inactive** | Is this record still in use? |
| **Buying Status** | Has this customer ever actually bought? |

They are different questions, which is why this is not just another use of Active / Inactive.
A dealer who has never ordered is a perfectly current customer — the rep is calling on him
**because** he has not ordered yet. Marking him Inactive would remove him from the lists of
the very people whose job it is to open him.

"Yet to Buy" is an instruction rather than a label. Inactive tells a rep to ignore someone;
Yet to Buy tells him to go and sell.

## The rule

> A customer is a **Buyer** if they have at least one order that was **not** Cancelled and
> **not** Rejected. Otherwise they are **Yet to Buy**.

- It keeps itself right. Cancel a customer's only order and he goes back to Yet to Buy;
  un-cancel it and he is a Buyer again.
- **First Order** shows the date of the earliest order that counts — the order's own date, so
  a backdated order counts on its day, not on the day it was typed in.
- It is worked out again each time rather than kept as a running total, because this table is
  also written by the importer, the mobile offline queue and the demo seeder.

## Setting it by hand

An admin, or anyone given the new **Manage Buying Status** right, can set it by hand on the
customer page. Doing so **locks** that customer: the automatic rule leaves him alone from then
on, and the page says so.

Only an admin can release the lock, with the "let it follow order history again" link. That
re-runs the rule on the spot.

## Where you will see it

- **Settings → Organization Settings** — "Show Buying Status on customers". **Off by default.**
- **Customers list** — a Buying Status column with a Buyer / Yet to Buy filter, once the
  switch is on.
- **Customer page** — the status, the First Order date, and the override.

Still to come (not in this batch): the Buying Status badge on the mobile Customers list, and
the report dimension and "Buyers opened in period" measure.

## One important thing this file also does

`trg_enforce_contact_hierarchy_level` (from a 2026-08 migration) refuses **any** change to a
customer who has no Customer Level, on accounts where order hierarchy is switched on. That is
deliberate for a person editing a customer — it forces the level to be filled in.

But Buying Status is written by the system when an order is saved. Without a guard, saving an
order for a customer with no Customer Level would have been **rejected — the order would not
have saved at all**, on exactly the accounts that run primary/secondary hierarchy. I
reproduced that on a local copy of the database before writing this.

So a system-written column now marks itself and is let through. **Nothing changes for a
person**: editing a customer with no Customer Level is still refused, exactly as before. Only
the automatic column is exempt, and only for the instant it is being written.

## How to check it worked

1. **Settings → Organization Settings** → switch **Show Buying Status on customers** on, Save.
2. Open **Customers**. A **Buying Status** column should appear. Customers with past orders
   should already read **Buyer** — the file backfills from real history, so it is right on day
   one rather than starting everyone at Yet to Buy.
3. Filter the column by **Yet to Buy**: that is your "shops we have never sold to" list.
4. Open a Yet to Buy customer, place an order for him, and he should turn into a **Buyer**
   with today's date as First Order.
