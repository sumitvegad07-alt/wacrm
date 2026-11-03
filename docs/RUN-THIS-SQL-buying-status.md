# Run this SQL — Buying Status (Buyer / Yet to Buy / Blacklisted)

**Two files, in this order.** The web screens are already live, but the switch in
Organisation Settings does nothing until both have been run.

Open Supabase → SQL Editor → paste one file, Run, then the other. Both are safe to run twice.

| # | File | Adds |
|---|------|------|
| 1 | `supabase/migrations/20261103140000_buying_status.sql` | Buyer / Yet to Buy, worked out from order history |
| 2 | `supabase/migrations/20261103150000_buying_status_blacklist_and_reports.sql` | Blacklisted (reason required), plus the report dimension and measure |

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

## The three statuses

| Status | Who sets it |
|---|---|
| **Buyer** | worked out from order history |
| **Yet to Buy** | worked out from order history |
| **Blacklisted** | only ever a person, and always with a reason |

## The rule

> A customer is a **Buyer** if they have at least one order that was **not** Cancelled and
> **not** Rejected. Otherwise they are **Yet to Buy**.

- It keeps itself right. Cancel a customer's only order and he goes back to Yet to Buy;
  un-cancel it and he is a Buyer again.
- **First Order** shows the date of the earliest order that counts — the order's own date, so
  a backdated order counts on its day, not on the day it was typed in.
- It is worked out again each time rather than kept as a running total, because this table is
  also written by the importer, the mobile offline queue and the demo seeder.

## Blacklisting a customer

Choose **Blacklisted** on the customer page and a box opens asking **why**. You cannot save
without a reason — the **Blacklist this customer** button stays disabled until you type one.

Three things make a blacklist stick:

1. **The reason is required by the database itself**, not just by the form. I tested going
   round the form with a direct database update and it was refused. That matters because the
   mobile app, the importer and any future API would otherwise each get their own chance to
   skip it.
2. **An order does not undo it.** If a blacklisted customer somehow gets invoiced, he stays
   blacklisted — that is the whole point of blacklisting him.
3. **"Let it follow order history again" is not offered** on a blacklisted customer, and the
   database refuses it too. To stop blacklisting someone you set him back to **Buyer** or
   **Yet to Buy** — a decision somebody makes on purpose, and one that records who made it.
   Releasing the lock instead would let the next invoice quietly un-blacklist him.

The reason is cleared automatically when you move him off Blacklisted, so a stale reason
cannot sit on a customer who is trading again.

**One thing I did not do, because you did not ask:** blacklisting does **not** currently stop
anyone placing an order for that customer. It is a label and a warning, not a block. Say the
word if you want the order form to refuse them.

## Setting it by hand

An admin, or anyone given the new **Manage Buying Status** right, can set it by hand on the
customer page. Doing so **locks** that customer: the automatic rule leaves him alone from then
on, and the page says so.

Only an admin can release the lock, with the "let it follow order history again" link. That
re-runs the rule on the spot. It is not offered on a blacklisted customer — see above.

## Where you will see it

- **Settings → Organization Settings** — "Show Buying Status on customers". **Off by default.**
- **Customers list** — a Buying Status column with a Buyer / Yet to Buy / Blacklisted filter,
  once the switch is on. Hovering a Blacklisted badge shows the reason.
- **Customer page** — the status, the reason when blacklisted, the First Order date, and the
  override.
- **Mobile Customers list** — a Buyer / Yet to Buy / Blacklisted badge on each card, so a rep
  walking a beat can see which shops he has never sold to and which he must not sell to.
  **Needs a new APK** — the code is pushed, the build is not triggered.
- **Reports** — "Buying Status" is now something you can group by and filter on in the Order
  and Customer Ageing reports, plus a **Buyers Opened** measure: how many customers bought for
  the very first time in the period. Group by Month with that measure to see new shops opened
  per month.

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
