# Run this SQL — correct dashboard money totals

This is the fourth and final SQL block. It is also the most important one, because
it is the only one that fixes numbers that are currently **wrong**, not just missing.

## What is wrong today

Your dashboard adds up money by fetching the rows and adding them up in the browser.
The database silently refuses to hand over more than **1,000 rows at a time** — and
says nothing about it. So on any account past 1,000 orders or payments, the
dashboard has been adding up part of the data and presenting the result as the whole.

Measured on the live **Satyam Ceramics** demo account, and I verified it a second
time independently:

| | Rows that exist | Rows the dashboard saw |
|---|---|---|
| Closed orders | 2,126 | 1,000 |
| Approved payments | 1,068 | 1,000 |

The true outstanding on that account is **₹1,71,88,513**. The tile was showing
**minus ₹3,23,48,000**.

Not just low — *negative*, and wildly so. The orders side lost 1,126 rows while the
payments side lost only 68, so the subtraction flipped: it looked like customers had
paid you far more than they had ever ordered.

Your own account has 53 orders, which is why you have never seen this. Any customer
who grows past a thousand orders would.

## The second fix in the same block

"Today" and "this month" on the dashboard were being worked out from **the clock on
whoever's computer or phone was looking**, not from your company's timezone. On the
phone it was worse — the day started at 05:30 in the morning instead of midnight.
This is why a dashboard figure and a report figure for the same day could disagree.
Both now use your account's own timezone, like the reports do.

## Nothing is broken while you wait

The code is already live and was written to fall back: if it asks the database for
the new calculations and they are not there yet, it quietly goes back to the old
method and shows the old (approximate) numbers. Your dashboards work right now. They
are just still wrong on big accounts until you run this.

## How to run it

The block is long — about 700 lines — so it is a file rather than something to copy
off a page.

1. Open the file `supabase/migrations/20261031120000_dashboard_aggregate_rpcs.sql`
   (it is sent alongside this note).
2. Select all of it and copy.
3. Open <https://supabase.com/dashboard/project/ltigfpywdbfilsagtpyd/sql/new>
4. Paste and press **Run**.

It is safe to run twice.

## How to check it worked

Open the Sales dashboard on one of the bigger demo accounts — Satyam Ceramics. The
Outstanding figure should change from a large negative number to roughly
**₹1.72 crore**.

If it still shows a negative number, the SQL did not take; tell me.

## Why this one needed a whole file

Because the sums now happen inside the database rather than in the browser, which is
the only way to add up 2,126 rows when you are only allowed to see 1,000. Each
calculation became a small named routine in the database, and there are several of
them — today's collection, the month's collection, outstanding, overdue, credit
exceeded, order totals.

They run **as you**, not as an administrator. That distinction matters: it means the
existing rules about who may see whose data keep applying, so a salesman opening his
dashboard still sees only his own figures and not the whole company's.
