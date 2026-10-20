# Rollback — platform invoices (20261020120000)

Founder-only data. Dropping these tables destroys OZZO's own invoice history,
which is accounting data. Export it first:

```sql
\copy (select * from public.platform_invoices order by series, fy, seq) to 'platform_invoices.csv' csv header
```

Then, in order:

```sql
drop trigger if exists platform_invoices_block_delete on public.platform_invoices;
drop trigger if exists platform_invoices_touch_updated_at on public.platform_invoices;
drop trigger if exists platform_invoice_settings_touch_updated_at on public.platform_invoice_settings;
drop function if exists public.block_issued_invoice_delete();
drop function if exists public.touch_platform_invoices_updated_at();
drop table if exists public.platform_invoice_settings;
drop table if exists public.platform_invoices;
```

`touch_platform_invoices_updated_at()` is used by both tables — drop it only
after both tables are gone.
