# Run this SQL — Customer mapping (who supplies whom)

One file. **The web screens are already live, but the setting in Organisation Settings does
nothing until the SQL below has been run.**

Open Supabase → SQL Editor → paste the file, Run. It is safe to run twice.

| File | Adds |
|------|------|
| `supabase/migrations/20261103160000_customer_mapping_parent.sql` | A supplier on every customer, by hand or from the beat, plus primary/secondary channel reporting |

---

## What this answers that OZZO could not

Today an order can be called **primary** or **secondary** — that comes from Customer Level.
What it could never say is **through whom** a secondary sale happened, because nothing in OZZO
recorded which distributor serves which dealer. I checked the database column by column before
building this: there was no such field at all.

So this adds nothing to Customer Level and takes nothing away. Levels keep working exactly as
they do. Level says *what kind* of customer somebody is; the supplier says *who stocks them*.

## The two ways to set it

**Settings → Organization Settings → Customer mapping**. Three choices, and **Off** is the
default:

| Choice | What happens |
|---|---|
| **Off** | No supplier is recorded. Exactly how OZZO has always worked. |
| **Set on each customer** | The customer form gets a **Supplied By** box and you pick the distributor yourself. |
| **From the beat** | You give each **beat** a supplying distributor, and every customer permanently on that beat takes it automatically. The box on the customer form becomes read-only. |

### Setting a beat's supplier

Open **Routes**, edit a route, and use the new **Supplied by** box. Every customer permanently
on that beat is re-mapped the moment you save.

**A one-time stop does not change anybody's supplier.** If a beat visits a customer for a
single day, that customer keeps the supplier of the beat they really belong to. That is
deliberate — a one-time visit is a visit, not a change of distributor.

## The rules it will not let you break

These are enforced in the database, so they hold on the web, on the phone, in an import and
through the API alike:

1. **A customer cannot supply themselves.**
2. **A supplier must sit above the customer in the hierarchy.** A dealer cannot be a
   distributor's supplier. If Customer Level is switched off for your account, this rule
   cannot mean anything and is not applied.
3. **No supply loops.** A supplies B supplies A is refused.
4. **A supplier must be a customer of your own account.** I tested this with a real customer in
   a second account: it is refused, and in beat mode the customers are simply left unmapped
   rather than the other company's name appearing anywhere.

In beat mode, a beat whose supplier would break one of these rules leaves those customers
**unmapped** instead of making the beat impossible to save. They then show up in the count of
customers with no supplier, which is a thing you can fix rather than a thing that blocks work.

## Reports — the point of the whole thing

The Order report gains:

- **Channel** — group by or filter on Primary / Secondary / Direct.
- **Supplied By** — group by or filter on the distributor the order went through.
- **Primary Value**, **Secondary Value**, and **Secondary / Primary %**.

That last one is the standard FMCG health check. If primary keeps running ahead of secondary,
stock is going into a distributor's godown rather than out to shops. You could not see that
before.

Customer Ageing also gains **Supplied By**, so you can see outstanding money by distributor.

### Old orders never change their story

Each order remembers the supplier **as it was on the day of the order**. If a dealer moves to a
different distributor next March, last year's orders still report under the distributor who
actually served them. A report that rewrites its own history is worse than no report.

## Importing suppliers

The customer import now accepts a **Supplier Code** column: put the distributor's Customer Code
against each dealer. Unknown codes are reported back to you by name at the end of the import
rather than being silently dropped.

This only applies in **Set on each customer** mode. In **From the beat** mode the beat decides,
so an imported supplier would just be overwritten — so it is skipped, deliberately.

## How to check it worked

1. **Settings → Organization Settings → Customer mapping** → choose **Set on each customer**,
   Save.
2. Open a dealer. There should be a **Supplied By** box. Only customers above him in the
   hierarchy are offered.
3. Pick a distributor and save. The **Customers** list should show a **Supplied By** column,
   and the distributor's own page should say **Supplies N customers**.
4. Place an order for that dealer, then go to **Reports → Orders**, group by **Supplied By**.
   The order should sit under the distributor.
5. To try beat mode: switch the setting to **From the beat**, open a route, set **Supplied by**,
   and check the customers on that beat now read that distributor with "From the beat: …"
   beneath it.

## Two things I did not decide for you

- **How many levels deep.** The data model takes any depth — super-stockist → distributor →
  dealer works as well as two levels. Nothing needs changing if you want three.
- **A customer with no supplier can still order.** That is treated as a direct sale, which is
  what happens today.
