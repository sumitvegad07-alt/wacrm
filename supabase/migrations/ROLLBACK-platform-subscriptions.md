# Rollback — platform subscriptions (20261020130000)

Founder-only data, typed by hand and held nowhere else — there is no `accounts`
column to rebuild it from. Export both tables first:

```sql
\copy (select * from public.platform_subscriptions order by end_date) to 'platform_subscriptions.csv' csv header
\copy (select * from public.platform_subscription_periods order by subscription_id, start_date) to 'platform_subscription_periods.csv' csv header
```

Then, in order:

```sql
drop trigger if exists platform_subscriptions_touch_updated_at on public.platform_subscriptions;
drop function if exists public.renew_platform_subscription(uuid, text, text, integer, numeric, date, date, uuid);
drop function if exists public.touch_platform_subscriptions_updated_at();
drop table if exists public.platform_subscription_periods;
drop table if exists public.platform_subscriptions;
```

`platform_subscription_periods` goes first: it carries the foreign key.
