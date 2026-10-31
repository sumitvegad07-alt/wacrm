# Run this SQL — the fix for "no difference at all"

This is the third and last block for the new-entry highlight. **Run it and the
highlight will finally show you something.**

## What went wrong

The code was working perfectly. That was the problem.

You asked for an entry to stand out until you open it. I built exactly that — and on
your Leads list, **all 201 records qualified**. Every one of them was created in the
last 30 days, and you had never opened any of them through the new code. So all 201
rows were highlighted.

A list where *every* row is highlighted looks precisely like a list where *none* is.
You said "no difference at all", and you were right.

The second problem: the tint I used was 6% — fine on a white screen, and on your dark
theme it shifted the row colour by about one shade. Invisible.

## What this fixes

**A starting line.** From the moment you first open each list, whatever is already
there counts as "old". Only what arrives *after* that can be highlighted. This is how
unread marks work everywhere — when you install a mail app it doesn't mark ten years
of mail unread.

**A mark you can actually see.** A solid coloured bar down the left edge of the row,
a stronger tint, and bolder text. The bar is the part that works on a dark screen.

## The trade-off, stated plainly

A record created *before* your starting line will never be highlighted, no matter how
long it sits unopened. Your 201 existing leads will not light up.

That is deliberate. The highlight now answers **"what came in since I started
looking?"** instead of **"what have I never clicked?"** — the second question had 201
answers on your account and was no use to you. Your 30-day setting is unchanged.

## How to run it

1. Open <https://supabase.com/dashboard/project/ltigfpywdbfilsagtpyd/sql/new>
2. Paste the block below.
3. Press **Run**. It should say `Success. No rows returned`.

Safe to run twice.

```sql
create table if not exists public.record_view_baselines (
  user_id     uuid not null references auth.users(id)      on delete cascade,
  module_name text not null,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  baseline_at timestamptz not null default now(),
  primary key (user_id, module_name)
);

create index if not exists record_view_baselines_account_idx
  on public.record_view_baselines (account_id);

alter table public.record_view_baselines enable row level security;

drop policy if exists record_view_baselines_own on public.record_view_baselines;
create policy record_view_baselines_own on public.record_view_baselines
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert on public.record_view_baselines to authenticated;

comment on table public.record_view_baselines is
  'The moment each user first opened each list. Records created at or before it are '
  'never highlighted as new for that user, so switching the highlight on does not '
  'light up every row that already existed. Written once per user per module and '
  'never updated. user_id is an auth.users id.';
```

## How to test it — this matters, do it in this order

1. **Open the Leads list once.** Nothing will look different. That is correct — this
   visit is what draws your starting line. Wait for the list to finish loading.
2. **Now create a new lead.**
3. **Go back to the Leads list.** That one lead should have a coloured bar down its
   left edge, a tinted background and bolder text. Everything else stays plain.
4. **Click into it, then come back.** The bar should be gone.

If step 3 shows nothing, tell me and I will dig again — but check you did step 1
first, because without it there is no starting line and the code deliberately
highlights nothing.

To see your starting lines after step 1:

```sql
select module_name, baseline_at from public.record_view_baselines;
```

---

Same content as `supabase/migrations/20261031140000_record_view_baselines.sql`.
