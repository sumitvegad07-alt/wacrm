# Run this SQL — Area is not mandatory on a customer

One file. **The website is already updated, but this change does nothing until the SQL below
has been run.**

Open Supabase → SQL Editor → paste the file, Run. It is safe to run twice.

| File | Fixes |
|------|-------|
| `supabase/migrations/20261103120000_territory_coverage_both_directions.sql` | A salesman who holds an Area can now see customers recorded with only a City |

---

## What you reported

> "Agar salesman ko area assign kia he or customer ko khali City assign kia he than wo
> customers unassigned rahenge. It is not a bug, it is an implementation error."

You were right, and it was an implementation error. Here is exactly what was happening.

When you assign a territory to a salesman, the app worked out which customers that covers by
looking **downward** only — the territory you gave him, and everything inside it.

So if Dhaval holds the area **150 Feet Ring Road**, he covers:

- 150 Feet Ring Road
- anything inside it

A customer saved with only the city **Rajkot** is not inside 150 Feet Ring Road. Rajkot is
the level **above** it. So that customer was in neither list, and nobody covered him.

The only way to fix that by hand was to go back and give every customer an Area. That is the
mandatory-Area rule you are removing.

## What changes

A salesman now covers a customer when the two are **on the same line** in the hierarchy —
whether the customer sits below his territory or above it.

Dhaval holds **150 Feet Ring Road**. He now covers:

| Territory | Covered? | Why |
|---|---|---|
| 150 Feet Ring Road | Yes | his own area, as before |
| Shop Lane (inside his area) | Yes | below him, as before |
| **Rajkot (city)** | **Yes — this is the fix** | above him, on the same line |
| **Gujarat (state)** | **Yes** | above him, on the same line |
| **India (country)** | **Yes** | above him, on the same line |
| Amin Marg (another area of Rajkot) | **No** | a different line — not his |

That last row matters: this does **not** turn an area salesman into a city salesman. Give
150 Feet Ring Road to Dhaval and Amin Marg to someone else, and each still sees only his own
area. Only the levels **above** an area open up, never the ones beside it.

## One thing to know before you run it

A customer saved with only **India** will now be visible to **every** salesman in India. A
customer saved with only **Gujarat** will be visible to every salesman in Gujarat.

That is simply what "no Area needed" means — a customer tagged only "India" has not told us
anything more precise, so anybody whose patch is inside India covers him.

Those customers are invisible to every salesman **today**, so nothing gets taken away from
anyone. But if you have customers saved with only a Country or State and you do not want
them shared that widely, give them a City. That is a data fix, not a code fix.

## Two older problems fixed in the same file

While checking this I found that the batch from **2 November** rebuilt the customer
visibility rule from an older copy and quietly dropped three things that had been added on
**5 October**:

1. **"Also Assigned To" granted nothing.** You could add extra employees to a customer and
   they still could not see him.
2. **Direct-assignment mode was broken again.** An employee handed a customer could not see
   him unless he happened to have created him. This was a bug fixed on 5 October that came
   back.
3. The directional data-scope rule was dropped.

All three are restored in this file. If you noticed "Also Assigned To" not working over the
last day, that is why.

## How to check it worked

1. Pick a salesman who holds an **Area**, not a city.
2. Find a customer in that city who has **no Area** filled in.
3. Open **Customers** on the web: the **Assigned To** column should now show that salesman's
   name instead of being blank.
4. Log in on his phone: that customer should now appear in his Customers list, and you should
   be able to add him to that salesman's beat.

The web part of this is already live. Only the SQL is waiting.
