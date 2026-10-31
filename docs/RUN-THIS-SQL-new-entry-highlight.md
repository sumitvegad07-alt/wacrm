# Run this SQL in Supabase — the "new entry" highlight

**What it turns on:** on Orders, Payments, Expenses, Leads, Deals, Customers,
Quotations, Tasks and Products, an entry nobody has opened yet is drawn **bolder and
slightly tinted** on the web, and with a **coloured bar down its left edge** on the
phone. It goes back to normal the moment *you* open it.

"New" means new **to you**, not new to the company. If you and a salesman both look
at the Orders list, each of you sees your own unopened rows highlighted. Your opening
an order does not clear it for him, and his does not clear it for you.

This block creates the one small table that remembers who has opened what.

## Until you run it

Nothing breaks and nothing looks different — the apps ask the database for the table,
are told it does not exist, and quietly draw the lists exactly as they do today. The
code is already deployed and waiting.

## How to run it

1. Open <https://supabase.com/dashboard/project/ltigfpywdbfilsagtpyd/sql/new>
2. Paste the whole block below.
3. Press **Run**. It should say `Success. No rows returned`.

It is safe to run twice.

## The SQL

```sql
create table if not exists public.record_views (
  user_id     uuid not null references auth.users(id)       on delete cascade,
  module_name text not null,
  record_id   uuid not null,
  account_id  uuid not null references public.accounts(id)  on delete cascade,
  viewed_at   timestamptz not null default now(),
  primary key (user_id, module_name, record_id)
);

create index if not exists record_views_account_idx
  on public.record_views (account_id);

alter table public.record_views enable row level security;

drop policy if exists record_views_own on public.record_views;
create policy record_views_own on public.record_views
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.record_views to authenticated;

comment on table public.record_views is
  'Which records a user has already opened, so a list can highlight entries that '
  'user has not seen yet. user_id is an auth.users id. module_name uses the same '
  'singular vocabulary as custom_fields.module_name. record_id is polymorphic — it '
  'points into the table named by module_name — so it has no foreign key.';
```

## How to check it worked

Open any Orders or Customers list. Anything created in the last 30 days that you have
not opened should now stand out. Open one, come back, and it should look normal.

To see the marks being recorded:

```sql
select module_name, count(*) as opened
from public.record_views
group by module_name
order by opened desc;
```

## Two decisions worth knowing about

**A record is only highlighted for 30 days after it was created.** There has to be a
limit. Without one, "an entry you have never opened" means every entry in the account
the first time a new employee logs in — thousands of bold rows, and a highlight that
tells them nothing. Thirty days is long enough that a week away loses nothing. If you
want it longer or shorter, it is one number — `NEW_FOR_DAYS` in
`src/lib/record-views/unseen.ts` in both apps.

**Each person's reading is private.** There is no way for anyone, including you, to
see whether a colleague has opened a record. That is not information the highlight
needs, so the database refuses to hand it over.

**On the phone it needs a signal.** Offline, nothing is highlighted rather than
everything — a list that marks every row unread the moment the signal drops would
train your team to ignore the highlight. The mobile app also needs a new APK build
before any of this appears on a device.

---

Same content as `supabase/migrations/20261031130000_record_views.sql`, which is the
copy kept in the repository.
