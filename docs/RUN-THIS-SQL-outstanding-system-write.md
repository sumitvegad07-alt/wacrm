# Run this SQL — an order would not save once Customer Level is switched on

**Nothing is broken today.** No account has Customer Level (order hierarchy) switched on, and
until one does, this changes nothing. Run it **before** switching Customer Level on for any
tenant.

Open Supabase → SQL Editor → paste each file, Run. Both are safe to run twice.

| File | Fixes |
|------|-------|
| `supabase/migrations/20261104110000_contacts_customer_code_column.sql` | Declares a column that only existed on the live database |
| `supabase/migrations/20261104120000_outstanding_is_a_system_write.sql` | **Lets an order save for a customer who has no Customer Level** |

---

## What went wrong

Switching **Customer Level** on makes the level compulsory on a customer, and the database
enforces it by refusing any change to a customer that has not got one. That is right when a
person is editing a customer. It is wrong for the figures OZZO keeps by itself.

The **outstanding balance** is one of those figures. OZZO recalculates it every time an order
or a payment is saved, and to do that it writes to the customer's row. On an account with
Customer Level switched on, that write was refused for any customer without a level — and
because it happened inside the order's own save, **the order failed**, with:

> Customer Level is required because order hierarchy is enabled for this account.

The salesman was saving an **order**. He had not touched the customer. The same happened when
deleting an order, when recording a payment, and when running "rebuild outstanding".

## Why it did not bite yet

Only an account with Customer Level switched on is affected, and none has it on. Two accounts
(001001 and 001291) already have the levels **defined** — Distributor and Dealer — so the
switch is one click away. It would have failed from the very first order.

## The fix

The November build already had a way to say "this write is OZZO's own, not a person's"
(`is_ozzo_system_write`), and Buying Status uses it. The outstanding balance is older and was
never given it. It has it now, as does the bulk rebuild.

Nothing about who may change what has changed. A **person** editing a customer still has to
set the Customer Level, exactly as before.

## How to check it worked

Switch Customer Level on for a test account, find a customer with no level, and save an order
for them. It should save. Before this, it could not.
