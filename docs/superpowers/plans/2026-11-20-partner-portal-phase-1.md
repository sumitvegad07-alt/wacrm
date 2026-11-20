# Partner Portal — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `partner.ozzo.co.in` as a working app where the founder signs in, creates a staff member with a role, and that staff member signs in and sees only what their role allows — enforced by the database, not the menu.

**Architecture:** A new standalone Next.js app (`C:\Wacrm\ozzo-partner`) against the existing Mumbai Supabase project, built from `ozzo-dms` as the template. Identity is `auth.users` + a new `partner_employees` row (never `profiles`). Rights live in `partner_roles.permissions` as a JSON object and are resolved by `partner_has_right()` in SQL; the TypeScript `can()` is a mirror used only to hide menu items. Screens are copied from the CRM's `team/roles` and `team/employees` with the table names swapped.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19.2.4, TypeScript 6, Tailwind 4, `@supabase/ssr` 0.10.3, `@supabase/supabase-js` 2.107.0, Base UI 1.9, lucide-react 1.29, vitest 4.1.9, Node >= 20.

**Spec:** `docs/superpowers/specs/2026-11-20-partner-portal-design.md`

## Global Constraints

- New app lives at `C:\Wacrm\ozzo-partner`. Dev + start port is **3200** (`wacrm-web` 3000, `ozzo-dms` 3100).
- Dependency versions are pinned to match `ozzo-dms`/`wacrm-web` exactly: `next` `16.2.6`, `react` / `react-dom` `19.2.4`, `eslint-config-next` `16.2.6`, `typescript` `^6`, `vitest` `^4.1.9`, `@supabase/ssr` `^0.10.3`, `@supabase/supabase-js` `^2.107.0`.
- The `service_role` key may appear in **exactly two places**: `lib/auth/partner-service.ts` and files under `app/api/**`. A test enforces this. On Vercel the variable is named `service_role` (not `SUPABASE_SERVICE_ROLE_KEY`) — read it through a helper, never inline.
- Partner staff get **no `profiles` row**, ever.
- Every right is enforced by an RLS policy or by a route-level check that runs **before** the service client is created. Hiding a menu item is never the enforcement.
- All SQL functions are `security definer` with `set search_path = ''` (or `= public` for plpgsql that references unqualified tables), matching `supabase/migrations/20260823120000_hardening_sprint1_permissions.sql`.
- Database migrations go in `wacrm-web/supabase/migrations/` with a paste-ready `wacrm-web/docs/RUN-THIS-SQL-partner-foundation.md`. The Supabase CLI is linked to the stale Singapore project — `db push` must not be used.
- `partner_employees` must carry **only one** foreign key to itself (`manager_id`). A second self-FK makes PostgREST embedding ambiguous and returns 404s on every query — the exact failure recorded in `orders-second-fk-broke-every-order`.
- Commits go straight to `main` in each repo. No branches, no PRs.

---

## File Structure

### New repo: `C:\Wacrm\ozzo-partner`

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.mts`, `.gitignore`, `.env.local.example` | Scaffold, copied from `ozzo-dms` with the port and name changed |
| `app/globals.css` | The CRM's stylesheet, copied verbatim |
| `app/layout.tsx` | Root layout, fonts, theme boot |
| `app/login/page.tsx` | Sign-in screen |
| `app/(portal)/layout.tsx` | **The gate** — resolves the caller's partner employee row or 404s |
| `app/(portal)/page.tsx` | Placeholder home (Phase 5 replaces it with the real dashboard) |
| `app/(portal)/roles/page.tsx` | Employee Roles screen |
| `app/(portal)/employees/page.tsx`, `employees/new/page.tsx`, `employees/[id]/page.tsx` | Employees screens |
| `app/api/employees/route.ts` | Create / update / deactivate staff + their login. The only place that mints a user |
| `middleware.ts` | Session refresh + signed-out redirect |
| `lib/supabase/client.ts`, `lib/supabase/server.ts` | Anon-key clients |
| `lib/auth/partner-service.ts` | The service-role client. One of two files allowed to name the key |
| `lib/auth/partner.ts` | `getPartnerMe`, `requirePartner`, `requirePartnerRight` |
| `lib/auth/rights.ts` | `can(permissions, key)` — pure mirror of the SQL, for menus only |
| `lib/auth/rights-registry.ts` | Every right key this portal defines, grouped by module |
| `lib/nav.ts` | Nav items + `visibleNav(permissions)` |
| `lib/employees/password.ts` | `generatePassword()` |
| `lib/employees/validate.ts` | `validateEmployeeInput()` |
| `lib/employees/privilege-columns.ts` | `stripPrivilegeColumns()` |
| `components/layout/partner-shell.tsx`, `partner-sidebar.tsx`, `partner-header.tsx` | Shell, copied from the CRM's `admin-shell.tsx` |
| `components/ui/**` | Design-system primitives, copied from `wacrm-web/src/components/ui` |
| `lib/supabase/key-containment.test.ts` | Fails the build if the service key escapes its two homes |
| `app/design-system-parity.test.ts` | Fails if the copied stylesheet drifts |
| `COPIED-FROM.md` | Every copied file with the `wacrm-web` commit it came from |
| `README.md` | What this app is, what it may and may not do |

### Existing repo: `C:\Wacrm\wacrm-web`

| File | Responsibility |
|---|---|
| `supabase/migrations/20261120120000_partner_portal_foundation.sql` | Tables, helpers, RLS, seeds |
| `docs/RUN-THIS-SQL-partner-foundation.md` | The same SQL, paste-ready, with verification queries |
| `supabase/migrations/ROLLBACK-partner-portal.md` | How to undo it |

---

## Task 1: Scaffold the app, copy the design system, lock the key in

**Files:**
- Create: `C:\Wacrm\ozzo-partner\package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.mts`, `.gitignore`, `.env.local.example`, `README.md`, `COPIED-FROM.md`
- Create: `app/layout.tsx`, `app/globals.css`, `lib/utils.ts`, `lib/supabase/client.ts`, `lib/supabase/server.ts`, `middleware.ts`
- Create: `components/ui/**` (copied)
- Test: `lib/supabase/key-containment.test.ts`, `app/design-system-parity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `createBrowserSupabase(): SupabaseClient` from `lib/supabase/client.ts`; `createServerSupabase(): Promise<SupabaseClient>` from `lib/supabase/server.ts`; `cn(...inputs)` from `lib/utils.ts`.

- [ ] **Step 1: Create the folder and copy the scaffold from the DMS portal**

Copy these files from `C:\Wacrm\ozzo-dms` to `C:\Wacrm\ozzo-partner`, unchanged:
`tsconfig.json`, `postcss.config.mjs`, `vitest.config.mts`, `next.config.ts`,
`lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/utils.ts`,
`app/globals.css`, and the whole of `components/ui/`.

Do **not** copy `.next/`, `node_modules/`, or anything under `lib/portal/` — that is DMS business logic.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "ozzo-partner",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3200",
    "build": "next build",
    "start": "next start -p 3200",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@base-ui/react": "^1.9.0",
    "@supabase/ssr": "^0.10.3",
    "@supabase/supabase-js": "^2.107.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.4.0",
    "lucide-react": "^1.29.0",
    "next": "16.2.6",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "shadcn": "^4.23.0",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.7.0",
    "tw-animate-css": "^1.4.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^25.9.5",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.6",
    "jsdom": "^26.1.0",
    "tailwindcss": "^4",
    "typescript": "^6",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 3: Write `.gitignore` and `.env.local.example`**

`.gitignore`:
```
node_modules
.next
.env.local
.vercel
tsconfig.tsbuildinfo
```

`.env.local.example`:
```
# Copy to .env.local. Both values come from wacrm-web/.env.local.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only. Named `service_role` to match Vercel, which is where it also lives.
# Needed to create staff logins and to read platform_* tables.
service_role=
```

- [ ] **Step 4: Write the failing key-containment test**

Create `lib/supabase/key-containment.test.ts`. This is `ozzo-dms/lib/supabase/no-privileged-key.test.ts` inverted: the DMS forbids the key everywhere, this app confines it to two homes.

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = ["service_role", "SERVICE_ROLE_KEY", "SUPABASE_SECRET", "supabaseServiceRole"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "out", ".vercel"]);
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) out.push(full);
  }
  return out;
}

// Path SEGMENTS, not a regex over the whole path: the DMS version of this guard
// shipped with a forward-slash-only regex that matched nothing on Windows and
// reported all-clear.
function isAllowed(path: string): boolean {
  const parts = path.split(/[\\/]/);
  const file = parts[parts.length - 1];
  if (file === "key-containment.test.ts") return true;      // names them to forbid them
  if (file === "partner-service.ts") return true;            // the service client itself
  if (parts.includes("app") && parts.includes("api")) return true; // server routes
  return false;
}

describe("the service-role key stays in its two homes", () => {
  const files = walk(ROOT);

  it("has files to scan, so a passing run means something", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("is never named outside partner-service.ts and app/api/**", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (isAllowed(f)) continue;
      const src = readFileSync(f, "utf8");
      for (const needle of FORBIDDEN) {
        if (src.includes(needle)) offenders.push(`${f.replace(ROOT, "")} -> ${needle}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("builds both anon clients with the anon key only", () => {
    for (const name of ["client.ts", "server.ts"]) {
      const src = readFileSync(join(ROOT, "lib", "supabase", name), "utf8");
      expect(src, name).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      expect(src, name).not.toMatch(/process\.env\.(?!NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY))/);
    }
  });
});
```

- [ ] **Step 5: Install dependencies and run the test to watch it pass for the right reason**

Run: `cd C:\Wacrm\ozzo-partner && npm install && npm test`
Expected: the three key-containment assertions PASS (nothing names the key yet). If "has files to scan" fails, the copy in Step 1 did not happen.

- [ ] **Step 6: Copy the design-system parity test and adapt it**

Copy `ozzo-dms/app/design-system-parity.test.ts` to `app/design-system-parity.test.ts`. Change only the `FILES` roots so it walks this app's `app`, `components` and `lib`. Leave every measured value alone — they are measured from `wacrm-web` and are what make the test meaningful.

- [ ] **Step 7: Write `app/layout.tsx`**

Copy `ozzo-dms/app/layout.tsx` and change the metadata only:

```tsx
export const metadata: Metadata = {
  title: "OZZO Partner Portal",
  description: "OZZO's own sales operation.",
};
```

- [ ] **Step 8: Run typecheck and the tests**

Run: `npm run typecheck && npm test`
Expected: both PASS. The design-system test proves the stylesheet arrived whole; the containment test proves the key has not leaked.

- [ ] **Step 9: Write `README.md` and `COPIED-FROM.md`**

`README.md` states: what this app is, that staff are `partner_employees` and never `profiles`, that the key lives in two files, and that `npm run dev` serves port 3200.

`COPIED-FROM.md` begins the manifest the spec's risk 1 requires:

```markdown
# Copied from wacrm-web / ozzo-dms

Porting a fix from the CRM is a diff against the commit named here.

| This file | Source repo | Source path | Source commit |
|---|---|---|---|
| app/globals.css | wacrm-web | src/app/globals.css | <commit> |
| components/ui/* | wacrm-web | src/components/ui/* | <commit> |
| lib/supabase/client.ts | ozzo-dms | lib/supabase/client.ts | <commit> |
```

Fill `<commit>` with the output of `git -C C:\Wacrm\wacrm-web rev-parse --short HEAD`.

- [ ] **Step 10: Initialise the repo and commit**

```bash
cd C:\Wacrm\ozzo-partner
git init -b main
git add .
git commit -m "feat: scaffold the partner portal app

Copied from ozzo-dms, with the CRM design system and a test that
confines the service-role key to partner-service.ts and app/api/**."
```

---

## Task 2: The database foundation

**Files:**
- Create: `C:\Wacrm\wacrm-web\supabase\migrations\20261120120000_partner_portal_foundation.sql`
- Create: `C:\Wacrm\wacrm-web\docs\RUN-THIS-SQL-partner-foundation.md`
- Create: `C:\Wacrm\wacrm-web\supabase\migrations\ROLLBACK-partner-portal.md`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `partner_roles`, `partner_employees`; functions `partner_me() -> uuid`, `partner_has_right(p_key text) -> boolean`, `partner_scope_ids() -> setof uuid`; four seeded roles named exactly `Super Admin`, `Sales Manager`, `Sales Executive`, `Telecaller`.

- [ ] **Step 1: Write the migration — tables**

Create the migration file and begin it with the tables.

```sql
-- =====================================================================
-- Partner Portal foundation: staff, roles, rights, hierarchy.
--
-- A partner employee is an OZZO salesperson. They are auth.users + a row
-- here, and deliberately NOT a profiles row: profiles means "an employee of
-- a tenant account" to 107 web files and 56 database functions, and an OZZO
-- salesperson in there surfaces in a customer's team list.
--
-- Additive and reversible. See ROLLBACK-partner-portal.md.
-- =====================================================================

begin;

create table if not exists public.partner_roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  -- Same shape as employee_roles.permissions: an object of key -> true,
  -- with {"all": true} as the wildcard. Keeping the shape is what lets the
  -- CRM's roles screen and has_permission()'s resolution rules be copied.
  permissions jsonb not null default '{}'::jsonb,
  data_scope  text not null default 'own'
              check (data_scope in ('own', 'team', 'all')),
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists uq_partner_roles_name
  on public.partner_roles (lower(name));

create table if not exists public.partner_employees (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  full_name   text not null,
  email       text not null,
  phone       text,
  designation text,
  role_id     uuid references public.partner_roles(id) on delete restrict,
  manager_id  uuid references public.partner_employees(id) on delete set null,
  status      text not null default 'active'
              check (status in ('active', 'inactive')),
  joined_on   date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Intentionally NOT a foreign key. manager_id is already a self-reference,
  -- and a second one makes every PostgREST embed of this table ambiguous —
  -- which is how a second FK to contacts 404'd every order (88de60d).
  created_by  uuid
);

create unique index if not exists uq_partner_employees_email
  on public.partner_employees (lower(email));
create index if not exists ix_partner_employees_manager
  on public.partner_employees (manager_id);
create index if not exists ix_partner_employees_role
  on public.partner_employees (role_id);
```

- [ ] **Step 2: Write the migration — the three helpers**

Append to the same file. `partner_has_right` carries the CRM's four resolution rules in the CRM's order; `partner_scope_ids` is the hierarchy walk.

```sql
-- ── who am I ─────────────────────────────────────────────────────────
create or replace function public.partner_me()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select e.id
  from public.partner_employees e
  where e.user_id = auth.uid()
    and e.status = 'active'
  limit 1
$$;

-- ── may I ────────────────────────────────────────────────────────────
-- Four rules, same order as public.has_permission(): inactive staff are
-- denied outright, then {"all":true}, then the exact key, then the verb
-- wildcard ('view_leads' is granted by 'view_*').
create or replace function public.partner_has_right(p_key text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.partner_employees e
    left join public.partner_roles r on r.id = e.role_id
    where e.user_id = auth.uid()
      and e.status = 'active'
      and (
        (r.permissions ->> 'all') = 'true'
        or (r.permissions ->> p_key) = 'true'
        or (r.permissions ->> (split_part(p_key, '_', 1) || '_*')) = 'true'
      )
  )
$$;

-- ── whose records may I see ──────────────────────────────────────────
create or replace function public.partner_scope_ids()
returns setof uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me    uuid;
  v_scope text;
begin
  select e.id, coalesce(r.data_scope, 'own')
    into v_me, v_scope
  from partner_employees e
  left join partner_roles r on r.id = e.role_id
  where e.user_id = auth.uid()
    and e.status = 'active'
  limit 1;

  if v_me is null then
    return;                                  -- not a portal user: sees nothing
  end if;

  if v_scope = 'all' then
    return query select e.id from partner_employees e;
  elsif v_scope = 'team' then
    return query
      with recursive down as (
        select v_me as id
        union
        select e.id from partner_employees e join down d on e.manager_id = d.id
      )
      select id from down;
  else
    return query select v_me;
  end if;
end;
$$;

revoke all on function public.partner_me() from public, anon;
revoke all on function public.partner_has_right(text) from public, anon;
revoke all on function public.partner_scope_ids() from public, anon;
grant execute on function public.partner_me() to authenticated;
grant execute on function public.partner_has_right(text) to authenticated;
grant execute on function public.partner_scope_ids() to authenticated;
```

- [ ] **Step 3: Write the migration — the cycle guard**

Append. This is `public.prevent_manager_cycle()` from `106_reporting_hierarchy.sql`, retargeted. Without it, a loop in `manager_id` makes `partner_scope_ids()` recurse until the connection dies.

```sql
create or replace function public.partner_prevent_manager_cycle()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_cur   uuid;
  v_depth int := 0;
  v_name  text;
begin
  if NEW.manager_id is null then return NEW; end if;

  if NEW.manager_id = NEW.id then
    raise exception 'An employee cannot report to themselves.'
      using errcode = '23514';
  end if;

  v_cur := NEW.manager_id;
  while v_cur is not null and v_depth < 10000 loop
    if v_cur = NEW.id then
      select full_name into v_name from partner_employees where id = NEW.id;
      raise exception 'Reporting loop: % would end up reporting to themselves through this manager.',
        coalesce(v_name, NEW.id::text) using errcode = '23514';
    end if;
    select manager_id into v_cur from partner_employees where id = v_cur;
    v_depth := v_depth + 1;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists trg_partner_prevent_manager_cycle on public.partner_employees;
create trigger trg_partner_prevent_manager_cycle
  before insert or update of manager_id on public.partner_employees
  for each row execute function public.partner_prevent_manager_cycle();
```

- [ ] **Step 4: Write the migration — protect the Super Admin role**

Append. Editing the Super Admin role's permissions, or deleting it, locks the founder out of his own portal.

```sql
create or replace function public.partner_roles_protect_system()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.is_system then
      raise exception 'The % role is built in and cannot be deleted.', OLD.name
        using errcode = '23514';
    end if;
    return OLD;
  end if;

  if OLD.is_system and (NEW.permissions is distinct from OLD.permissions
                        or NEW.data_scope is distinct from OLD.data_scope) then
    raise exception 'The % role''s rights are built in and cannot be changed.', OLD.name
      using errcode = '23514';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_partner_roles_protect_system on public.partner_roles;
create trigger trg_partner_roles_protect_system
  before update or delete on public.partner_roles
  for each row execute function public.partner_roles_protect_system();
```

- [ ] **Step 5: Write the migration — RLS**

Append. Note the self-select policy: a Telecaller with no `view_employees` still has to read their own row for the app to boot.

```sql
alter table public.partner_roles     enable row level security;
alter table public.partner_employees enable row level security;

-- Roles: every portal member reads them (to render their own rights and the
-- role dropdown); only manage_roles writes.
drop policy if exists partner_roles_select on public.partner_roles;
create policy partner_roles_select on public.partner_roles
  for select to authenticated
  using (public.partner_me() is not null);

drop policy if exists partner_roles_write on public.partner_roles;
create policy partner_roles_write on public.partner_roles
  for all to authenticated
  using (public.partner_has_right('manage_roles'))
  with check (public.partner_has_right('manage_roles'));

-- Employees: always your own row, plus whatever your scope and
-- view_employees allow, plus everything if you may manage.
drop policy if exists partner_employees_select_self on public.partner_employees;
create policy partner_employees_select_self on public.partner_employees
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists partner_employees_select_scope on public.partner_employees;
create policy partner_employees_select_scope on public.partner_employees
  for select to authenticated
  using (
    public.partner_has_right('view_employees')
    and id in (select public.partner_scope_ids())
  );

drop policy if exists partner_employees_write on public.partner_employees;
create policy partner_employees_write on public.partner_employees
  for all to authenticated
  using (public.partner_has_right('manage_employees'))
  with check (public.partner_has_right('manage_employees'));
```

- [ ] **Step 6: Write the migration — seed the four roles**

Append. `Super Admin` is the only `is_system` role.

```sql
insert into public.partner_roles (name, description, permissions, data_scope, is_system)
values
  ('Super Admin',
   'The platform owner. Every right, every record.',
   '{"all": true}'::jsonb,
   'all', true),

  ('Sales Manager',
   'Runs a sales team. Sees their own work and their team''s.',
   '{"view_dashboard": true,
     "view_leads": true, "create_leads": true, "edit_leads": true,
     "delete_leads": true, "convert_leads": true, "assign_leads": true,
     "import_leads": true, "export_leads": true,
     "view_customers": true, "create_customers": true, "edit_customers": true,
     "export_customers": true,
     "view_activities": true, "create_activities": true,
     "edit_activities": true, "delete_activities": true,
     "view_team_activities": true,
     "view_proposals": true, "create_proposals": true,
     "view_renewals": true, "view_calculator": true,
     "view_discovery": true, "push_discovery_to_leads": true,
     "view_tickets": true, "create_tickets": true, "edit_tickets": true,
     "assign_tickets": true,
     "view_employees": true, "view_roles": true}'::jsonb,
   'team', false),

  ('Sales Executive',
   'Sells. Sees only their own records.',
   '{"view_dashboard": true,
     "view_leads": true, "create_leads": true, "edit_leads": true,
     "convert_leads": true, "export_leads": true,
     "view_customers": true, "create_customers": true, "edit_customers": true,
     "view_activities": true, "create_activities": true, "edit_activities": true,
     "view_proposals": true, "view_calculator": true,
     "view_tickets": true, "create_tickets": true}'::jsonb,
   'own', false),

  ('Telecaller',
   'Calls and qualifies. Leads and activity only.',
   '{"view_dashboard": true,
     "view_leads": true, "create_leads": true, "edit_leads": true,
     "view_activities": true, "create_activities": true, "edit_activities": true,
     "create_tickets": true}'::jsonb,
   'own', false)
on conflict (lower(name)) do nothing;
```

- [ ] **Step 7: Write the migration — seed the founder, then close the transaction**

Append. Matched by email so no UUID is hard-coded; the email is the one already in `src/lib/auth/founder.ts`.

```sql
insert into public.partner_employees (user_id, full_name, email, role_id, status, joined_on)
select u.id, 'Sumit Vegad', u.email, r.id, 'active', current_date
from auth.users u
cross join public.partner_roles r
where lower(u.email) = 'sumitvegad07@gmail.com'
  and r.name = 'Super Admin'
on conflict (user_id) do nothing;

commit;
```

- [ ] **Step 8: Write the paste-ready SQL doc with verification queries**

Create `docs/RUN-THIS-SQL-partner-foundation.md`: a short explanation of what the block does, the whole migration in one fenced `sql` block to paste into the Supabase SQL editor (Mumbai project `ltigfpywdbfilsagtpyd`), then these checks to run afterwards.

```sql
-- 1. Four roles, Super Admin wildcarded and the only system role.
select name, data_scope, is_system, permissions ->> 'all' as wildcard
from public.partner_roles order by is_system desc, name;
-- Expect 4 rows; Super Admin / all / true / true.

-- 2. The founder is in, as Super Admin.
select e.full_name, e.email, e.status, r.name as role
from public.partner_employees e join public.partner_roles r on r.id = e.role_id;
-- Expect exactly 1 row. If 0, the email in auth.users does not match.

-- 3. RLS is on, with policies, on both tables.
select c.relname, c.relrowsecurity, count(p.polname) as policies
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relname in ('partner_roles', 'partner_employees')
group by c.relname, c.relrowsecurity;
-- Expect: partner_employees t 3, partner_roles t 2.

-- 4. Exactly one foreign key from partner_employees to itself.
select count(*) from pg_constraint
where conrelid = 'public.partner_employees'::regclass
  and confrelid = 'public.partner_employees'::regclass
  and contype = 'f';
-- Expect 1. A 2 here means created_by got a foreign key and every
-- PostgREST embed of this table will 404.

-- 5. The cycle guard bites.
do $$
declare v_a uuid; v_b uuid;
begin
  select id into v_a from public.partner_employees limit 1;
  begin
    update public.partner_employees set manager_id = v_a where id = v_a;
    raise exception 'FAIL: self-management was allowed';
  exception when check_violation then
    raise notice 'PASS: self-management refused';
  end;
end $$;
-- Expect the NOTICE "PASS: self-management refused".
```

- [ ] **Step 9: Write the rollback doc**

Create `supabase/migrations/ROLLBACK-partner-portal.md` following the shape of the existing `ROLLBACK-*.md` files: the drops in dependency order (triggers, then functions, then tables), and a one-line warning that dropping `partner_employees` deletes staff records but leaves their `auth.users` rows, which must be removed separately if the portal is being abandoned.

- [ ] **Step 10: Apply it, and verify before believing it**

The founder pastes the block from `docs/RUN-THIS-SQL-partner-foundation.md` into the Supabase SQL editor on the Mumbai project, then runs the five checks. **Do not proceed to Task 3 until check 2 returns one row and check 4 returns 1.**

- [ ] **Step 11: Commit (in wacrm-web)**

```bash
cd C:\Wacrm\wacrm-web
git add supabase/migrations/20261120120000_partner_portal_foundation.sql docs/RUN-THIS-SQL-partner-foundation.md supabase/migrations/ROLLBACK-partner-portal.md
git commit -m "feat(db): partner portal foundation — staff, roles, rights, hierarchy"
```

---

## Task 3: The rights mirror and the gate

**Files:**
- Create: `lib/auth/rights.ts`, `lib/auth/rights-registry.ts`, `lib/auth/partner.ts`, `lib/auth/partner-service.ts`
- Create: `app/(portal)/layout.tsx`, `app/(portal)/page.tsx`, `app/login/page.tsx`, `middleware.ts`
- Test: `lib/auth/rights.test.ts`, `lib/auth/rights-registry.test.ts`

**Interfaces:**
- Consumes: `createServerSupabase()` (Task 1); `partner_me()`, `partner_has_right()` (Task 2).
- Produces:
  - `type Permissions = Record<string, boolean | undefined>`
  - `can(permissions: Permissions | null | undefined, key: string): boolean`
  - `RIGHTS: Record<string, { label: string; keys: { key: string; label: string }[] }>` and `ALL_RIGHT_KEYS: string[]` from `rights-registry.ts`
  - `type PartnerMe = { id: string; fullName: string; email: string; roleName: string | null; dataScope: "own" | "team" | "all"; permissions: Permissions }`
  - `getPartnerMe(): Promise<PartnerMe | null>`, `requirePartner(): Promise<PartnerMe>`, `requirePartnerRight(key: string): Promise<PartnerMe>`
  - `serviceClient(): SupabaseClient` from `partner-service.ts`

- [ ] **Step 1: Write the failing test for `can()`**

Create `lib/auth/rights.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { can } from "./rights";

describe("can()", () => {
  it("grants everything on the wildcard role", () => {
    expect(can({ all: true }, "view_invoices")).toBe(true);
    expect(can({ all: true }, "anything_at_all")).toBe(true);
  });

  it("grants an exact key", () => {
    expect(can({ view_leads: true }, "view_leads")).toBe(true);
  });

  it("grants a verb wildcard, matching the SQL", () => {
    // split_part(key,'_',1) || '_*' — 'view_*' covers every view right.
    expect(can({ "view_*": true }, "view_leads")).toBe(true);
    expect(can({ "view_*": true }, "view_invoices")).toBe(true);
  });

  it("does not let a verb wildcard grant another verb", () => {
    expect(can({ "view_*": true }, "delete_leads")).toBe(false);
  });

  it("denies a missing key, a false key, and no permissions at all", () => {
    expect(can({ view_leads: true }, "edit_leads")).toBe(false);
    expect(can({ view_leads: false }, "view_leads")).toBe(false);
    expect(can(null, "view_leads")).toBe(false);
    expect(can(undefined, "view_leads")).toBe(false);
    expect(can({}, "view_leads")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- rights.test.ts`
Expected: FAIL — `Failed to resolve import "./rights"`.

- [ ] **Step 3: Write `lib/auth/rights.ts`**

```ts
export type Permissions = Record<string, boolean | undefined>;

/**
 * A mirror of public.partner_has_right(), for hiding menu items and buttons.
 *
 * It is NOT the enforcement. The database decides, through RLS policies and
 * requirePartnerRight(); this only spares the user a screen full of things
 * they cannot use. If the two ever disagree, the database is right.
 */
export function can(permissions: Permissions | null | undefined, key: string): boolean {
  if (!permissions) return false;
  if (permissions.all === true) return true;
  if (permissions[key] === true) return true;
  const verb = key.split("_")[0];
  return permissions[`${verb}_*`] === true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- rights.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 5: Write `lib/auth/rights-registry.ts`**

Every key the portal defines, grouped for the Roles screen's tick-boxes. Phase 1 ships the whole registry even though only employees/roles screens exist — the Roles screen must be able to grant Phase 2–5 rights the day those screens land.

```ts
export const RIGHTS: Record<string, { label: string; keys: { key: string; label: string }[] }> = {
  dashboard: { label: "Dashboard", keys: [{ key: "view_dashboard", label: "View dashboard" }] },
  leads: {
    label: "Leads",
    keys: [
      { key: "view_leads", label: "View" },
      { key: "create_leads", label: "Add" },
      { key: "edit_leads", label: "Edit" },
      { key: "delete_leads", label: "Delete" },
      { key: "convert_leads", label: "Convert to customer" },
      { key: "assign_leads", label: "Assign owner" },
      { key: "import_leads", label: "Import" },
      { key: "export_leads", label: "Export" },
    ],
  },
  customers: {
    label: "Customers",
    keys: [
      { key: "view_customers", label: "View" },
      { key: "create_customers", label: "Add" },
      { key: "edit_customers", label: "Edit" },
      { key: "delete_customers", label: "Delete" },
      { key: "import_customers", label: "Import" },
      { key: "export_customers", label: "Export" },
    ],
  },
  activity: {
    label: "My Activity",
    keys: [
      { key: "view_activities", label: "View" },
      { key: "create_activities", label: "Add" },
      { key: "edit_activities", label: "Edit" },
      { key: "delete_activities", label: "Delete" },
      { key: "view_team_activities", label: "See the team's activity" },
    ],
  },
  employees: {
    label: "Employees",
    keys: [
      { key: "view_employees", label: "View" },
      { key: "manage_employees", label: "Add, edit and deactivate" },
    ],
  },
  roles: {
    label: "Employee Roles",
    keys: [
      { key: "view_roles", label: "View" },
      { key: "manage_roles", label: "Create and edit roles" },
    ],
  },
  proposals: {
    label: "Sales Proposals",
    keys: [
      { key: "view_proposals", label: "View" },
      { key: "create_proposals", label: "Add" },
      { key: "edit_proposals", label: "Edit" },
      { key: "delete_proposals", label: "Delete" },
    ],
  },
  invoices: {
    label: "Invoices",
    keys: [
      { key: "view_invoices", label: "View" },
      { key: "create_invoices", label: "Raise an invoice" },
      { key: "edit_invoices", label: "Edit" },
      { key: "manage_invoice_settings", label: "Change invoice settings" },
    ],
  },
  renewals: {
    label: "Renewals",
    keys: [
      { key: "view_renewals", label: "View" },
      { key: "renew_subscription", label: "Renew a subscription" },
    ],
  },
  calculator: { label: "Price Calculator", keys: [{ key: "view_calculator", label: "Use it" }] },
  forecast: { label: "Business Forecast", keys: [{ key: "view_forecast", label: "View" }] },
  discovery: {
    label: "Lead Discovery",
    keys: [
      { key: "view_discovery", label: "View results" },
      { key: "run_discovery", label: "Run a search" },
      { key: "push_discovery_to_leads", label: "Push results into Leads" },
    ],
  },
  outreach: {
    label: "WhatsApp Sender",
    keys: [
      { key: "view_outreach", label: "View campaigns" },
      { key: "send_outreach", label: "Send messages" },
    ],
  },
  tickets: {
    label: "Complaints & Suggestions",
    keys: [
      { key: "view_tickets", label: "View" },
      { key: "create_tickets", label: "Log one" },
      { key: "edit_tickets", label: "Edit" },
      { key: "delete_tickets", label: "Delete" },
      { key: "assign_tickets", label: "Assign" },
      { key: "resolve_tickets", label: "Resolve and close" },
    ],
  },
  settings: {
    label: "Settings",
    keys: [
      { key: "manage_masters", label: "Edit the master lists" },
      { key: "manage_settings", label: "Change portal settings" },
    ],
  },
};

export const ALL_RIGHT_KEYS: string[] = Object.values(RIGHTS).flatMap((g) =>
  g.keys.map((k) => k.key),
);
```

- [ ] **Step 6: Write the registry test**

Create `lib/auth/rights-registry.test.ts`. A duplicated key silently makes one tick-box control two things.

```ts
import { describe, expect, it } from "vitest";
import { ALL_RIGHT_KEYS, RIGHTS } from "./rights-registry";

describe("the rights registry", () => {
  it("has no duplicate keys", () => {
    const dupes = ALL_RIGHT_KEYS.filter((k, i) => ALL_RIGHT_KEYS.indexOf(k) !== i);
    expect(dupes, `duplicated: ${dupes.join(", ")}`).toEqual([]);
  });

  it("names every key verb_noun, so the SQL verb wildcard works", () => {
    for (const key of ALL_RIGHT_KEYS) expect(key, key).toMatch(/^[a-z]+_[a-z_*]+$/);
  });

  it("covers every module in the spec", () => {
    expect(Object.keys(RIGHTS).sort()).toEqual(
      [
        "activity", "calculator", "customers", "dashboard", "discovery",
        "employees", "forecast", "invoices", "leads", "outreach",
        "proposals", "renewals", "roles", "settings", "tickets",
      ].sort(),
    );
  });

  it("never grants anything by default — the seeds decide that", () => {
    expect(ALL_RIGHT_KEYS).not.toContain("all");
  });
});
```

- [ ] **Step 7: Run both tests**

Run: `npm test -- lib/auth`
Expected: PASS.

- [ ] **Step 8: Write `lib/auth/partner-service.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The service-role client. One of two places in this app allowed to name the
 * key (lib/supabase/key-containment.test.ts enforces that).
 *
 * Vercel names the variable `service_role`; .env.local may use either name.
 * Never call this before the caller's right has been checked — see
 * requirePartnerRight() in partner.ts, and wacrm-web's lib/auth/superadmin.ts,
 * which this mirrors.
 */
export function serviceRoleKey(): string | undefined {
  return process.env.service_role ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function serviceClient(): SupabaseClient {
  const key = serviceRoleKey();
  if (!key) {
    throw new Error(
      "Server is missing the service_role key. Add it to .env.local (Supabase → Project Settings → API → service_role) and restart.",
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false },
  });
}
```

- [ ] **Step 9: Write `lib/auth/partner.ts`**

```ts
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { can, type Permissions } from "./rights";

export type DataScope = "own" | "team" | "all";

export type PartnerMe = {
  id: string;
  fullName: string;
  email: string;
  roleName: string | null;
  dataScope: DataScope;
  permissions: Permissions;
};

/**
 * The caller's partner employee row, or null if they are not portal staff.
 *
 * Reads through the caller's own RLS-scoped session on purpose: the
 * partner_employees_select_self policy is what makes this work, and using the
 * service client here would make the gate a second opinion that could drift
 * from the policies. That drift is the lesson of contacts_select.
 */
export async function getPartnerMe(): Promise<PartnerMe | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("partner_employees")
    .select("id, full_name, email, status, partner_roles(name, permissions, data_scope)")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data || data.status !== "active") return null;

  const role = (data.partner_roles ?? null) as {
    name: string;
    permissions: Permissions;
    data_scope: DataScope;
  } | null;

  return {
    id: data.id as string,
    fullName: data.full_name as string,
    email: data.email as string,
    roleName: role?.name ?? null,
    dataScope: role?.data_scope ?? "own",
    permissions: role?.permissions ?? {},
  };
}

/** 404 rather than redirect: a stranger should not learn the portal is here. */
export async function requirePartner(): Promise<PartnerMe> {
  const me = await getPartnerMe();
  if (!me) notFound();
  return me;
}

/** Use in every API route, BEFORE serviceClient(). */
export async function requirePartnerRight(key: string): Promise<PartnerMe> {
  const me = await requirePartner();
  if (!can(me.permissions, key)) notFound();
  return me;
}
```

- [ ] **Step 10: Write `middleware.ts`**

Copy `ozzo-dms/middleware.ts` verbatim. It refreshes the session and bounces signed-out visitors to `/login`, and it deliberately does not decide who may enter — that is the layout's job, asking `partner_employees`.

- [ ] **Step 11: Write the login screen**

Copy `ozzo-dms/app/login/page.tsx`, changing the heading to "OZZO Partner Portal" and the redirect target to `/`. Keep its sign-in error wording helper (`lib/auth/sign-in-message.ts`) — copy that file too and add both to `COPIED-FROM.md`.

- [ ] **Step 12: Write `app/(portal)/layout.tsx` — the gate**

```tsx
import { requirePartner } from "@/lib/auth/partner";
import PartnerShell from "@/components/layout/partner-shell";

// Server-side gate, deciding once. The CRM's /admin layout used to be a client
// component whose only protection was a useEffect redirect, which shipped the
// whole bundle to anyone signed in before bouncing them.
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await requirePartner();
  return <PartnerShell me={me}>{children}</PartnerShell>;
}
```

- [ ] **Step 13: Write a placeholder `app/(portal)/page.tsx`**

Phase 5 replaces this file entirely.

```tsx
import { requirePartner } from "@/lib/auth/partner";

export default async function HomePage() {
  const me = await requirePartner();
  const firstName = me.fullName.trim().split(" ")[0] || "there";

  return (
    <div className="space-y-6 pb-12">
      <header>
        <h1 className="text-2xl font-bold text-foreground">Welcome back, {firstName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {me.roleName ? `Signed in as ${me.roleName}.` : "No role assigned yet."}
        </p>
      </header>
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <h2 className="text-lg font-semibold text-foreground">Your dashboard is on its way</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Use the menu on the left. The dashboard arrives in Phase 5.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 14: Run the whole suite and typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS, including key containment — `partner-service.ts` is on its allow-list, nothing else names the key.

- [ ] **Step 15: Commit**

```bash
git add lib/auth app/\(portal\) app/login middleware.ts COPIED-FROM.md
git commit -m "feat: the gate — rights mirror, partner identity, portal layout"
```

---

## Task 4: The shell

**Files:**
- Create: `components/layout/partner-shell.tsx`, `components/layout/partner-sidebar.tsx`, `components/layout/partner-header.tsx`, `lib/nav.ts`
- Test: `lib/nav.test.ts`

**Interfaces:**
- Consumes: `PartnerMe` (Task 3), `can()` (Task 3), `RIGHTS` keys (Task 3).
- Produces: `NAV_ITEMS: NavItem[]`, `visibleNav(permissions: Permissions): NavItem[]`, where `type NavItem = { href: string; label: string; icon: LucideIcon; right: string; phase: number }`. `PartnerShell` takes `{ me: PartnerMe; children: React.ReactNode }`.

- [ ] **Step 1: Write the failing nav test**

Create `lib/nav.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { NAV_ITEMS, visibleNav } from "./nav";
import { ALL_RIGHT_KEYS } from "./auth/rights-registry";

describe("the sidebar", () => {
  it("gates every item on a right that actually exists", () => {
    for (const item of NAV_ITEMS) {
      expect(ALL_RIGHT_KEYS, `${item.label} -> ${item.right}`).toContain(item.right);
    }
  });

  it("shows a Super Admin everything", () => {
    expect(visibleNav({ all: true })).toHaveLength(NAV_ITEMS.length);
  });

  it("shows a telecaller-ish role only what it holds", () => {
    const visible = visibleNav({ view_dashboard: true, view_leads: true });
    expect(visible.map((i) => i.label)).toEqual(["Dashboard", "Leads"]);
  });

  it("shows nothing to a role with no rights", () => {
    expect(visibleNav({})).toEqual([]);
  });

  it("lists the Phase 1 screens", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(hrefs).toContain("/employees");
    expect(hrefs).toContain("/roles");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- nav.test.ts`
Expected: FAIL — cannot resolve `./nav`.

- [ ] **Step 3: Write `lib/nav.ts`**

All fourteen modules are listed now so the sidebar grows by rights rather than by edits; a screen that does not exist yet is simply not reachable because no role holds its right until its phase lands.

```ts
import {
  LayoutDashboard, Radar, Send, Users, Shield, UserCircle2, Building2,
  FileText, Receipt, CalendarClock, Calculator, BarChart3, MessageSquareWarning,
  CalendarCheck, Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { can, type Permissions } from "./auth/rights";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  right: string;
  phase: number;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/",            label: "Dashboard",               icon: LayoutDashboard,       right: "view_dashboard", phase: 5 },
  { href: "/leads",       label: "Leads",                   icon: UserCircle2,           right: "view_leads",     phase: 2 },
  { href: "/customers",   label: "Customers",               icon: Building2,             right: "view_customers", phase: 2 },
  { href: "/activity",    label: "My Activity",             icon: CalendarCheck,         right: "view_activities",phase: 2 },
  { href: "/proposals",   label: "Sales Proposals",         icon: FileText,              right: "view_proposals", phase: 3 },
  { href: "/invoices",    label: "Invoices",                icon: Receipt,               right: "view_invoices",  phase: 3 },
  { href: "/renewals",    label: "Renewals",                icon: CalendarClock,         right: "view_renewals",  phase: 3 },
  { href: "/calculator",  label: "Price Calculator",        icon: Calculator,            right: "view_calculator",phase: 3 },
  { href: "/forecast",    label: "Business Forecast",        icon: BarChart3,             right: "view_forecast",  phase: 3 },
  { href: "/discovery",   label: "Lead Discovery",          icon: Radar,                 right: "view_discovery", phase: 3 },
  { href: "/outreach",    label: "WhatsApp Sender",         icon: Send,                  right: "view_outreach",  phase: 3 },
  { href: "/tickets",     label: "Complaints & Suggestions",icon: MessageSquareWarning,  right: "view_tickets",   phase: 4 },
  { href: "/employees",   label: "Employees",               icon: Users,                 right: "view_employees", phase: 1 },
  { href: "/roles",       label: "Employee Roles",          icon: Shield,                right: "view_roles",     phase: 1 },
  { href: "/settings",    label: "Settings",                icon: Settings,              right: "manage_settings",phase: 2 },
];

export function visibleNav(permissions: Permissions): NavItem[] {
  return NAV_ITEMS.filter((item) => can(permissions, item.right));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- nav.test.ts`
Expected: PASS, five cases.

- [ ] **Step 5: Write the shell**

Copy `wacrm-web/src/app/(superadmin)/admin/admin-shell.tsx` into `components/layout/partner-shell.tsx` and change exactly these things, nothing else:
- It takes `{ me, children }` instead of reading `useAuth()`; the gate already resolved the user, so there is no loading state and no redirect effect.
- `NAV_ITEMS` and `FOUNDER_NAV_ITEMS` are replaced by one call to `visibleNav(me.permissions)`.
- The footer shows `me.fullName` and `me.roleName`.
- Sign-out calls `createBrowserSupabase().auth.signOut()` then `router.replace("/login")`.

Split the sidebar and the header into `partner-sidebar.tsx` and `partner-header.tsx` as you go — `admin-shell.tsx` is one long file and a straight copy would start this app with a file already too big.

Add all three to `COPIED-FROM.md`.

- [ ] **Step 6: Run the app and look at it**

Run: `npm run dev`
Visit `http://localhost:3200`. Signed out, expect the login screen. Sign in as the founder, expect the shell with all fifteen nav items (Super Admin holds every right) and the placeholder home.

- [ ] **Step 7: Run typecheck, tests, and the design-system test**

Run: `npm run typecheck && npm test`
Expected: PASS. A design-system failure here means the shell copy edited a token instead of using one.

- [ ] **Step 8: Commit**

```bash
git add lib/nav.ts lib/nav.test.ts components/layout COPIED-FROM.md
git commit -m "feat: the portal shell, with a sidebar that follows the role's rights"
```

---

## Task 5: Employee Roles screen

**Files:**
- Create: `app/(portal)/roles/page.tsx`, `app/(portal)/roles/roles-client.tsx`
- Test: covered by `lib/auth/rights-registry.test.ts` (Task 3) plus the manual check in Step 5

**Interfaces:**
- Consumes: `requirePartnerRight` (Task 3), `RIGHTS` (Task 3), `createBrowserSupabase` (Task 1).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the server page**

```tsx
import { requirePartnerRight } from "@/lib/auth/partner";
import { can } from "@/lib/auth/rights";
import RolesClient from "./roles-client";

export default async function RolesPage() {
  const me = await requirePartnerRight("view_roles");
  return <RolesClient canManage={can(me.permissions, "manage_roles")} />;
}
```

- [ ] **Step 2: Copy the CRM's roles screen into `roles-client.tsx`**

Source: `wacrm-web/src/app/(dashboard)/team/roles/page.tsx` (684 lines). Copy it, then change exactly these things:

- `.from("employee_roles")` becomes `.from("partner_roles")` (five call sites: the list read, the update, the insert, the delete, and the reload).
- Its permission-group constant is replaced by an import of `RIGHTS` from `@/lib/auth/rights-registry`; the tick-box grid iterates `Object.entries(RIGHTS)` and renders `group.label` with its `keys`.
- Drop the `account_id` column from every read, insert and filter — this portal has no accounts.
- Add a **Data scope** radio group (Only their own records / Their own and their team's / Everyone's) bound to `data_scope`.
- A role with `is_system` renders read-only, with a line explaining that the built-in role cannot be changed. The database refuses it anyway; this stops the user hitting a raw error.
- Every write is wrapped in `if (!canManage) return;` and the Add/Edit/Delete buttons are hidden when `canManage` is false.

Record the source path and commit in `COPIED-FROM.md`.

- [ ] **Step 3: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 4: Check it in the browser**

Run: `npm run dev`, sign in as the founder, open `/roles`.
Expect: four roles listed; Super Admin read-only; creating a role called "Test Role" with only `view_leads` ticked and scope "own" saves and reappears after a reload. Delete "Test Role" afterwards.

- [ ] **Step 5: Prove the database is the enforcement, not the screen**

In the Supabase SQL editor, confirm a role write is refused for someone without the right. Run as the anon/authenticated role in the editor's impersonation, or simply confirm the policy exists and the system-role trigger bites:

```sql
-- Built-in role's rights cannot be edited, even by the founder.
update public.partner_roles set permissions = '{}'::jsonb where name = 'Super Admin';
-- Expect: ERROR — "The Super Admin role's rights are built in and cannot be changed."
```

- [ ] **Step 6: Commit**

```bash
git add app/\(portal\)/roles COPIED-FROM.md
git commit -m "feat: Employee Roles screen, with per-module rights and data scope"
```

---

## Task 6: Employees screen and staff logins

**Files:**
- Create: `lib/employees/password.ts`, `lib/employees/validate.ts`, `lib/employees/privilege-columns.ts`
- Create: `app/api/employees/route.ts`
- Create: `app/(portal)/employees/page.tsx`, `employees/employees-client.tsx`, `employees/new/page.tsx`, `employees/[id]/page.tsx`
- Test: `lib/employees/password.test.ts`, `lib/employees/validate.test.ts`, `lib/employees/privilege-columns.test.ts`, `app/api/employees/route-shape.test.ts`

**Interfaces:**
- Consumes: `requirePartnerRight` (Task 3), `serviceClient` (Task 3), `createBrowserSupabase` (Task 1).
- Produces:
  - `generatePassword(length?: number): string`
  - `type EmployeeInput = { full_name: string; email: string; role_id: string; phone?: string; designation?: string; manager_id?: string | null; joined_on?: string | null }`
  - `validateEmployeeInput(input: Partial<EmployeeInput>): { ok: boolean; errors: Record<string, string> }`
  - `stripPrivilegeColumns<T extends Record<string, unknown>>(updates: T): Partial<T>`

- [ ] **Step 1: Write the failing password test**

Create `lib/employees/password.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { generatePassword } from "./password";

describe("generatePassword()", () => {
  it("is 12 characters by default", () => {
    expect(generatePassword()).toHaveLength(12);
  });

  it("honours a requested length", () => {
    expect(generatePassword(20)).toHaveLength(20);
  });

  it("refuses a length Supabase would reject", () => {
    expect(() => generatePassword(5)).toThrow(/at least 8/i);
  });

  it("uses no ambiguous characters — these get read down a phone", () => {
    for (const ch of generatePassword(500)) expect("O0ol1I".includes(ch)).toBe(false);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassword()));
    expect(seen.size).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- password.test.ts`
Expected: FAIL — cannot resolve `./password`.

- [ ] **Step 3: Write `lib/employees/password.ts`**

```ts
// No O/0/o/l/1/I: the founder reads these out over the phone when handing a
// new salesperson their login.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";

export function generatePassword(length = 12): string {
  if (length < 8) throw new Error("A password must be at least 8 characters.");
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- password.test.ts`
Expected: PASS, five cases.

- [ ] **Step 5: Write the failing validation test**

Create `lib/employees/validate.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { validateEmployeeInput } from "./validate";

const valid = {
  full_name: "Priya Shah",
  email: "priya@ozzo.co.in",
  role_id: "11111111-1111-1111-1111-111111111111",
};

describe("validateEmployeeInput()", () => {
  it("accepts a complete input", () => {
    expect(validateEmployeeInput(valid)).toEqual({ ok: true, errors: {} });
  });

  it("requires a name, an email and a role", () => {
    const { ok, errors } = validateEmployeeInput({});
    expect(ok).toBe(false);
    expect(Object.keys(errors).sort()).toEqual(["email", "full_name", "role_id"]);
  });

  it("rejects an email that is not one", () => {
    expect(validateEmployeeInput({ ...valid, email: "priya at ozzo" }).errors.email)
      .toMatch(/email/i);
  });

  it("trims before judging, so spaces are not a name", () => {
    expect(validateEmployeeInput({ ...valid, full_name: "   " }).errors.full_name)
      .toMatch(/name/i);
  });

  it("rejects a manager who is the employee themselves", () => {
    const id = "22222222-2222-2222-2222-222222222222";
    expect(validateEmployeeInput({ ...valid, id, manager_id: id }).errors.manager_id)
      .toMatch(/themselves/i);
  });
});
```

- [ ] **Step 6: Run it to verify it fails, then write `lib/employees/validate.ts`**

Run: `npm test -- validate.test.ts` → FAIL.

```ts
export type EmployeeInput = {
  id?: string;
  full_name: string;
  email: string;
  role_id: string;
  phone?: string;
  designation?: string;
  manager_id?: string | null;
  joined_on?: string | null;
};

export function validateEmployeeInput(
  input: Partial<EmployeeInput>,
): { ok: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (!input.full_name?.trim()) errors.full_name = "Enter the employee's name.";
  const email = input.email?.trim() ?? "";
  if (!email) errors.email = "Enter an email address — it is their login.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "That is not a valid email address.";
  if (!input.role_id) errors.role_id = "Choose a role.";

  // The database's cycle trigger catches loops; this catches the common one
  // early so the user sees a field error instead of a 23514.
  if (input.manager_id && input.id && input.manager_id === input.id) {
    errors.manager_id = "An employee cannot report to themselves.";
  }

  return { ok: Object.keys(errors).length === 0, errors };
}
```

Run: `npm test -- validate.test.ts` → PASS, five cases.

- [ ] **Step 7: Write the failing privilege-column test, then the module**

Create `lib/employees/privilege-columns.test.ts`.

```ts
import { describe, expect, it } from "vitest";
import { stripPrivilegeColumns } from "./privilege-columns";

describe("stripPrivilegeColumns()", () => {
  it("keeps the ordinary fields", () => {
    expect(stripPrivilegeColumns({ full_name: "A", phone: "9" }))
      .toEqual({ full_name: "A", phone: "9" });
  });

  it("drops identity columns a request must never set", () => {
    expect(stripPrivilegeColumns({ full_name: "A", id: "x", user_id: "y", created_by: "z" }))
      .toEqual({ full_name: "A" });
  });

  it("keeps role_id — granting a role IS the point of this screen", () => {
    expect(stripPrivilegeColumns({ role_id: "r" })).toEqual({ role_id: "r" });
  });

  it("does not mutate what it was given", () => {
    const input = { id: "x", full_name: "A" };
    stripPrivilegeColumns(input);
    expect(input).toEqual({ id: "x", full_name: "A" });
  });
});
```

Run it → FAIL. Then:

```ts
// This route runs with the service-role key, which ignores RLS and column
// grants. Anything echoed from the request body straight into an update is a
// privilege-escalation path — the same reasoning as PRIVILEGE_COLUMNS in
// wacrm-web's app/api/team/employees/route.ts.
const PRIVILEGE_COLUMNS = ["id", "user_id", "created_by", "created_at"] as const;

export function stripPrivilegeColumns<T extends Record<string, unknown>>(updates: T): Partial<T> {
  const clean: Partial<T> = { ...updates };
  for (const col of PRIVILEGE_COLUMNS) delete clean[col as keyof T];
  return clean;
}
```

Run it → PASS, four cases.

- [ ] **Step 8: Write `app/api/employees/route.ts`**

Three handlers. Every one checks the right **before** touching `serviceClient()`.

```ts
import { NextRequest, NextResponse } from "next/server";
import { requirePartnerRight } from "@/lib/auth/partner";
import { serviceClient } from "@/lib/auth/partner-service";
import { generatePassword } from "@/lib/employees/password";
import { validateEmployeeInput } from "@/lib/employees/validate";
import { stripPrivilegeColumns } from "@/lib/employees/privilege-columns";

export async function POST(req: NextRequest) {
  const me = await requirePartnerRight("manage_employees");
  const body = await req.json();

  const { ok, errors } = validateEmployeeInput(body);
  if (!ok) return NextResponse.json({ errors }, { status: 400 });

  const email = String(body.email).trim().toLowerCase();
  const password = String(body.password || "").trim() || generatePassword();
  const admin = serviceClient();

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr || !created.user) {
    const taken = /already|exists|registered/i.test(authErr?.message ?? "");
    return NextResponse.json(
      { errors: { email: taken ? "That email already has a login." : (authErr?.message ?? "Could not create the login.") } },
      { status: taken ? 409 : 500 },
    );
  }

  const { data: row, error: rowErr } = await admin
    .from("partner_employees")
    .insert({
      user_id: created.user.id,
      full_name: String(body.full_name).trim(),
      email,
      phone: body.phone ?? null,
      designation: body.designation ?? null,
      role_id: body.role_id,
      manager_id: body.manager_id ?? null,
      joined_on: body.joined_on ?? null,
      created_by: me.id,
      status: "active",
    })
    .select("id")
    .single();

  // The auth user is useless without its employee row, and a half-made staff
  // member is worse than none: undo it.
  if (rowErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ errors: { form: rowErr.message } }, { status: 500 });
  }

  // The password is returned exactly once, to be handed over. It is never stored.
  return NextResponse.json({ id: row.id, email, password }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  await requirePartnerRight("manage_employees");
  const { id, ...rest } = await req.json();
  if (!id) return NextResponse.json({ errors: { form: "Which employee?" } }, { status: 400 });

  const updates = stripPrivilegeColumns(rest);
  const { error } = await serviceClient()
    .from("partner_employees")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);

  // 23514 is the cycle trigger. Its message is written for a human, so pass it through.
  if (error) {
    return NextResponse.json({ errors: { form: error.message } }, { status: error.code === "23514" ? 400 : 500 });
  }
  return NextResponse.json({ ok: true });
}

// Deactivate, never delete: their leads, activity and tickets must keep an owner.
export async function DELETE(req: NextRequest) {
  await requirePartnerRight("manage_employees");
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ errors: { form: "Which employee?" } }, { status: 400 });

  const { error } = await serviceClient()
    .from("partner_employees")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ errors: { form: error.message } }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 9: Write the route-shape guard test**

Create `app/api/employees/route-shape.test.ts`. The ordering bug it prevents — service client first, right check second — is invisible in review and catastrophic.

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "app", "api", "employees", "route.ts"), "utf8");

describe("the employees route", () => {
  it("checks the right before it ever builds a service client", () => {
    for (const handler of ["POST", "PATCH", "DELETE"]) {
      const body = src.slice(src.indexOf(`export async function ${handler}`));
      const end = body.indexOf("\n}\n");
      const fn = body.slice(0, end === -1 ? undefined : end);
      const guard = fn.indexOf("requirePartnerRight");
      const service = fn.indexOf("serviceClient(");
      expect(guard, `${handler} has no right check`).toBeGreaterThan(-1);
      if (service > -1) expect(guard, `${handler} builds the service client first`).toBeLessThan(service);
    }
  });

  it("gates all three handlers on manage_employees", () => {
    expect(src.match(/requirePartnerRight\("manage_employees"\)/g) ?? []).toHaveLength(3);
  });

  it("deactivates rather than deletes", () => {
    expect(src).toContain('status: "inactive"');
    expect(src).not.toMatch(/\.from\("partner_employees"\)\s*\.delete\(/);
  });
});
```

Run: `npm test -- route-shape.test.ts`
Expected: PASS, three cases.

- [ ] **Step 10: Write the Employees list screen**

`app/(portal)/employees/page.tsx` is the server page: `const me = await requirePartnerRight("view_employees")`, passing `canManage` down.

`employees-client.tsx` is copied from `wacrm-web/src/app/(dashboard)/team/employees/page.tsx` (735 lines), changed only as follows:
- `.from("profiles")` becomes `.from("partner_employees")`, selecting `id, full_name, email, phone, designation, status, joined_on, role_id, manager_id, partner_roles(name)`.
- Drop every `account_id` filter and the `account_role` column — the spec's `account-role-is-not-a-role` note applies: that flag is not a role and is never printed.
- The Role column reads `partner_roles.name`.
- Add a Reporting Manager column.
- Deactivate posts `DELETE /api/employees?id=…`; edits post `PATCH /api/employees`.
- Add/Edit/Deactivate controls are hidden unless `canManage`.

Record it in `COPIED-FROM.md`.

- [ ] **Step 11: Write the Add Employee screen**

`app/(portal)/employees/new/page.tsx`, copied from the CRM's `team/employees/new/page.tsx` (299 lines), changed as follows:
- Fields: Full name, Email, Phone, Designation, Role (from `partner_roles`), Reporting manager (from active `partner_employees`), Joined on.
- No password field. On submit it posts to `/api/employees`, and on success shows the returned password once in a copyable panel reading "Give this password to {name}. It will not be shown again."
- Client-side errors come from `validateEmployeeInput` so the user sees field errors before a round trip.

- [ ] **Step 12: Write the Edit Employee screen**

`app/(portal)/employees/[id]/page.tsx`: the same form, prefilled, posting `PATCH`. No email field (changing a login's email is a separate concern and out of Phase 1 scope — say so in a comment). A "Reset password" button is **not** in Phase 1.

- [ ] **Step 13: Run the whole suite**

Run: `npm run typecheck && npm test`
Expected: PASS — all of rights, registry, nav, password, validate, privilege columns, route shape, key containment, design-system parity.

- [ ] **Step 14: Walk the acceptance path in the browser**

Run: `npm run dev`
1. Sign in as the founder. Open `/employees` — expect one row, himself, Super Admin.
2. Add "Test Exec", role Sales Executive, no manager. Expect a password panel.
3. Sign out. Sign in as Test Exec.
4. Expect the sidebar to show Dashboard, Leads, Customers, My Activity, Sales Proposals, Price Calculator, Complaints & Suggestions — and **not** Employees, Employee Roles, Invoices, Forecast, Renewals, Lead Discovery, WhatsApp Sender.
5. Visit `/employees` directly. Expect a 404, not a redirect and not a flash of the page.
6. Visit `http://localhost:3000` (the CRM) and sign in as Test Exec. Expect to be refused — no `profiles` row.
7. Back as the founder, set Test Exec's manager to the founder, then try to set the founder's manager to Test Exec. Expect the reporting-loop error.
8. Deactivate Test Exec, then try signing in as them. Expect a 404 at the gate: `partner_me()` ignores inactive staff.

- [ ] **Step 15: Commit**

```bash
git add lib/employees app/api/employees app/\(portal\)/employees COPIED-FROM.md
git commit -m "feat: Employees screen and staff login creation"
```

---

## Task 7: Ship it

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a live `partner.ozzo.co.in`.

**No `vercel.json`.** The only thing in `wacrm-web/vercel.json` is two cron jobs; this
app has none, and Vercel detects Next.js by itself. An empty config file is a file
somebody will later wonder about.

- [ ] **Step 1: Push the repo to a new private GitHub repository**

```bash
cd C:\Wacrm\ozzo-partner
gh repo create ozzo-partner --private --source=. --remote=origin --push
```

- [ ] **Step 2: Create the Vercel project**

In the Vercel dashboard: New Project → import `ozzo-partner` → Framework **Next.js** → deploy. No settings need changing; the build command is the default.

- [ ] **Step 3: Set the three environment variables**

In Vercel → the project → Settings → Environment Variables, for Production, Preview and Development:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | the same value as the `wacrm-web` project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the same value as the `wacrm-web` project |
| `service_role` | the same value as the `wacrm-web` project |

Copy them from the `wacrm-web` Vercel project so they cannot be mistyped. Redeploy after saving — Vercel does not apply new variables to an existing build.

- [ ] **Step 4: Add the domain**

Vercel → the project → Settings → Domains → add `partner.ozzo.co.in`. Add the CNAME it shows at the DNS host for `ozzo.co.in`, exactly as `dms.ozzo.co.in` was done. Wait for Vercel to report the domain as Valid.

- [ ] **Step 5: Verify on the live domain, not on localhost**

1. `https://partner.ozzo.co.in` signed out → the login screen over HTTPS.
2. Sign in as the founder → the shell, all fifteen nav items.
3. `/employees` → his row.
4. Sign in as a test executive → the reduced sidebar, and a 404 on `/employees`.
5. `https://app.ozzo.co.in` as that executive → refused.

If step 2 fails with a missing-key error, the `service_role` variable was saved without a redeploy.

- [ ] **Step 6: Commit and push**

```bash
git add vercel.json README.md
git commit -m "chore: Vercel config and deployment notes for partner.ozzo.co.in"
git push origin main
```

- [ ] **Step 7: Record it**

Append to `README.md`: the live URL, the Vercel project name, that the three environment variables are shared with `wacrm-web`, and that database migrations for this app live in `wacrm-web/supabase/migrations`.

---

## Phase 1 is done when

All of these hold on `https://partner.ozzo.co.in`, not on localhost:

1. The founder signs in with his existing CRM email and password.
2. He creates a Sales Executive and is shown that person's password once.
3. That executive signs in and sees Dashboard, Leads, Customers, My Activity, Sales Proposals, Price Calculator and Complaints & Suggestions — and nothing else.
4. That executive gets a 404 on `/employees`, with no flash of the page first.
5. That executive cannot sign into `app.ozzo.co.in` at all.
6. A reporting loop is refused by the database with a readable message.
7. A deactivated employee cannot sign in.
8. `npm run typecheck && npm test` passes, including key containment and design-system parity.

Phase 2 (Leads, Customers, My Activity) gets its own plan, written when Phase 1 is live.
