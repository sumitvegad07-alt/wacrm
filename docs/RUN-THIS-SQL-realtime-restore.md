# Run this SQL — your WhatsApp Inbox isn't live (and hasn't been for a while)

Your check turned up something neither of us was looking for, and it is worth more
than the thing we were checking.

## What your result showed

You pasted back 13 tables. Those are exactly the 13 I added yesterday — and that is
**all** that was in the list.

Ten other tables were supposed to already be there. They were added by earlier
work, going back to the first version of the app: chat messages, conversations,
notifications, location pings, presence, import jobs. None of them were in the list.

Those earlier changes definitely ran. So the list was emptied afterwards — and the
most likely moment is **the move of the database to Mumbai**. When a database is
copied to a new home, this particular setting does not always travel with it. And
nothing complains when it goes missing: the apps ask to be notified, are told
"fine", and are then simply never notified.

## What has silently not been working

- **The WhatsApp Inbox does not show an incoming message until you reload the page.**
  This is the big one.
- The unread badge on the inbox does not move by itself.
- The notification bell does not update.
- The live field map does not draw a salesman's location as it comes in.
- The green "who is online" dots do not change.
- An import does not tell you when it has finished.
- On the phone: changing someone's role or permissions does not reach their device
  until they restart the app.

All of that is one setting, and this block restores it.

## How to run it

1. Open <https://supabase.com/dashboard/project/ltigfpywdbfilsagtpyd/sql/new>
2. Paste the block below.
3. Press **Run**. You will see a line of `realtime: added public.<table>` notices.

Safe to run twice. **No app changes are needed** — the code has always been asking
for these; nothing was answering.

```sql
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'conversations',
    'messages',
    'message_reactions',
    'notifications',
    'import_jobs',
    'location_pings',
    'member_presence',
    'accounts',
    'employee_roles',
    'pipelines',
    'profiles',
    'tenant_announcements'
  ])
  loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      raise notice 'realtime: skipping public.% (table not present)', t;
      continue;
    end if;

    if exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      raise notice 'realtime: public.% already published', t;
      continue;
    end if;

    execute format('alter publication supabase_realtime add table public.%I', t);
    raise notice 'realtime: added public.%', t;
  end loop;
end
$$;
```

## How to check it worked

Run your earlier query again — you should now see **25** tables instead of 13:

```sql
select count(*), string_agg(tablename, ', ' order by tablename)
from pg_catalog.pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public';
```

Then the real test: open the WhatsApp Inbox and have someone message your business
number. The message should appear **without you touching anything**.

## Two things I left out on purpose

Three tables that the old setup included are **not** in this block: `site_visits`,
`tracking_sessions` and `flow_runs`. Nothing in either app listens to them any more,
and every published table costs the database a little work on every single write. No
point paying for an announcement nobody is listening for.

I did include `location_pings`, which is your busiest table — every salesman, every
minute. That one does cost something ongoing. It is in because the live field map is
the feature it pays for. If you ever decide that map is not worth it, that single
table is the one to take back out.
