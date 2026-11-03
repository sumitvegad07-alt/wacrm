# Run this SQL — Automatic codes

One file. **The Settings screen is already live, but switching a record type on does nothing
until the SQL below has been run.**

Open Supabase → SQL Editor → paste the file, Run. It is safe to run twice.

| File | Adds |
|------|------|
| `supabase/migrations/20261103130000_automatic_master_codes.sql` | Automatic Customer, Employee and Product codes |

---

## What this does

**Organisation Settings → Automatic codes** now has a row for each of three record types:

| | Starts with | Digits | Start from | Next code |
|---|---|---|---|---|
| Customer | `CUST-` | 4 | 1 | `CUST-0001` |
| Employee | `EMP-` | 4 | 1 | `EMP-0001` |
| Product | `SKU-` | 4 | 1 | `SKU-0001` |

**All three are off.** Nothing changes for anybody until you switch one on.

Lead code is not here — you said you do not need it, so leads get no code column.

## The rules it follows

1. **It only ever fills an empty box.** A code you type yourself is kept, exactly as it is.
2. **Switching it on does not renumber anything already saved.** Your existing customers keep
   whatever codes they have, including none.
3. **A separate button fills in the blanks.** When you switch a type on, the card tells you how
   many records have no code — "157 records have no Customer Code" — with a **Fill in 157**
   button beside it. It numbers the oldest record first. Nothing is written until you press it.
4. **The box stays editable.** You can still type over a generated code.
5. **It never hands out a code that is already taken.** If someone typed `CUST-0005` by hand
   three years ago, the generator skips past it and uses the next free number.
6. **Two people saving at the same second cannot get the same code.** Tested with six people
   saving at once: 240 customers, 240 different codes, no gaps.

## Changing the numbering later

- **Start from** jumps the numbering forward. Set it to 500 and the next customer is
  `CUST-0500`.
- It will **not** go backwards onto codes already issued. If you have reached 501 and set
  Start from back to 2, the next code is still `CUST-0502`. This is deliberate — winding it
  back would mint duplicates.
- The card shows the real **Next code**, not just what you typed, so it cannot mislead you on
  an account that has already generated codes.

## One thing the SQL will tell you

The file tries to add a safety rule that stops two records in your account ever sharing a
code. It only adds that rule where your data already allows it.

If you have duplicate codes today — and you may, because duplicate protection on Customer
Code has always been optional — you will see a message like:

```
NOTICE: Skipped unique index contacts_customer_code_uniq — contacts.customer_code
        already holds 3 duplicated value(s) on live data. Automatic codes still work ...
```

That is not an error and nothing is broken. Automatic codes work either way, because the
generator checks before it issues a code. If you want the extra safety rule, clear those
duplicate codes and run the file again.

Without this handling, a plain "no duplicates allowed" rule would have **aborted the whole
file** on live data.

## How to check it worked

1. Open **Settings → Organization Settings → Automatic codes**.
2. Switch **Customer** on, leave `CUST-` and 4 digits, press Save.
3. Add a customer and leave Customer Code empty — the box should read
   **Auto (CUST-0001)** while you type the rest.
4. Save. The customer should come back with `CUST-0001`.
5. Add another with the code typed in by hand — it must keep your code, untouched.
