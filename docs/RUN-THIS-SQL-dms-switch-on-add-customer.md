# Run this SQL — switch on "distributors can add their own customers"

Short one. Two things, and you can read the answer to the second yourself.

## Why the Add customer button is not showing

The button only appears when the switch is ON, and it starts off for every
company — including yours. That is deliberate: a company that wants its own team
to own every customer record should not find this switched on underneath them
after an upgrade.

The switch itself lives in **Organisation Settings** in the admin app, but that
screen is in the DMS work that has not been pushed live yet, so today the only
way to turn it on is this paste.

Open Supabase → SQL Editor → paste → Run. Safe to run twice.

```sql
-- 1. Switch it on, for the one account that holds the DMS add-on.
update public.accounts
   set settings = coalesce(settings, '{}'::jsonb)
                  || jsonb_build_object(
                       'dms_settings',
                       coalesce(settings -> 'dms_settings', '{}'::jsonb)
                       || '{"allow_customer_create": true}'::jsonb)
 where 'dms' = any(addon_lines);

-- 2. Show me what is installed, so I know what is left to run.
--    Copy the result back to me.
select p.proname as installed_function
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname like 'portal_%'
 order by 1;
```

## What the second query tells me

There should be **eighteen** functions. If `portal_create_customer` and
`portal_update_my_customer` are missing, the add-customer document has not been
run yet and I will tell you which one to paste. If `portal_place_order`,
`portal_products`, `portal_price_quote`, `portal_apply_schemes` and
`portal_normalize_lines` are all there, the ordering document is fully in.

## What changes for your own team

Nothing. No screen of yours changes, and no customer record changes. A
distributor simply gets a six-field form — name, business name, phone, city,
address, GST number — and the shop files itself under them. The credit limit,
the prices, the area, the territory and the customer code stay yours, and they
can never change or delete a customer your team created.

To switch it off again, run the same block with `false` in place of `true`.
