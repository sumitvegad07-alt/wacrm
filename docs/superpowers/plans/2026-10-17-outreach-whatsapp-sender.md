# WhatsApp Outreach Sender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a personalised cold WhatsApp message to prospects harvested by Lead Discovery, from the founder's own WhatsApp Web session, at a rate that does not get his business number banned.

**Architecture:** A founder-only page in the existing Next.js superadmin area creates a campaign and materialises one row per recipient in Postgres. An unpacked Chrome extension drives `web.whatsapp.com` through WA-JS. Every policy decision — cap, window, warm-up, gap, variant choice, suppression — is made by the server in `/next`; the extension is a dumb executor told one number and one rendered message at a time.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase/Postgres, vitest, Chrome MV3 extension, `@wppconnect/wa-js` (Apache-2.0, vendored).

**Spec:** [`docs/engineering/specifications/outreach-whatsapp-sender-v1.md`](../../engineering/specifications/outreach-whatsapp-sender-v1.md)

## Global Constraints

- **Founder-only.** Every route calls `requireFounder()` from `@/lib/auth/superadmin`, except `/next` and `/result`, which authenticate by agent token. Pages call `requireFounder()` and `notFound()` on throw, matching `src/app/(superadmin)/admin/revenue/discover/page.tsx`.
- **Phone matching uses `normalisePhone()` from `@/lib/revenue/discovery-query`** — never `normalizePhone()` from `@/lib/whatsapp/phone-utils`. The former wrote every `re_discovery_leads.phone` value; the latter only strips non-digits. Mixing them makes dedupe and suppression silently miss.
- **Timezone is `Asia/Kolkata`**, via `zonedClock()` and the existing `resolvePeriod`/`localRangeToUtc` from `@/lib/mcp/periods`. **Never `toISOString()` for a day boundary.**
- **New tables have RLS enabled with no policies** — platform-owner data reached only through `serviceClient()` after `requireFounder()`, exactly like `re_discovery_*`.
- **Migrations are applied by hand by the founder.** The Supabase MCP cannot reach the Mumbai project. A task is not done because the migration file exists; the plan says where to stop and hand it over.
- **Commit message style is the repo's**, not conventional commits: a sentence-case imperative line saying what changed and why it mattered. End every commit with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Push to `main` directly.** No branches, no PRs — Vercel deploys `main`.
- **Tests live beside the code** as `src/**/*.test.ts` and run with `npm test`. `environment: node`; there is no database or browser test harness.
- **Never expose this to a tenant, and never resell it.** No plan gating, no rights registry entry, no mobile surface, no nav link outside `/admin`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261017100000_revenue_outreach.sql` | Five tables, indexes, the claim RPC, RLS |
| `src/lib/revenue/outreach-policy.ts` | **All throttle maths.** Pure. No Supabase import |
| `src/lib/revenue/outreach-policy.test.ts` | Tests for the above |
| `src/lib/revenue/outreach-eligibility.ts` | Pure set logic: which leads become recipients, and the funnel counts |
| `src/lib/revenue/outreach-eligibility.test.ts` | Tests for the above |
| `src/lib/revenue/outreach-agents.ts` | Agent token mint / hash |
| `src/lib/revenue/outreach-agents.test.ts` | Tests for the above |
| `src/lib/revenue/outreach-store.ts` | The only module that talks to Supabase for outreach. Reads the counters `decide()` needs, writes results |
| `src/app/api/admin/revenue/outreach/route.ts` | Founder actions: preview, create, state, status, suppress, agents, test-send |
| `src/app/api/admin/revenue/outreach/next/route.ts` | Agent: claim one recipient or be told to wait |
| `src/app/api/admin/revenue/outreach/result/route.ts` | Agent: report the outcome |
| `src/app/(superadmin)/admin/revenue/outreach/page.tsx` | Founder guard + shell |
| `src/app/(superadmin)/admin/revenue/outreach/outreach-client.tsx` | Campaign builder and progress UI |
| `extension/ozzo-sender/` | The Chrome extension (5 files + vendored WA-JS) |

The founder actions share one route file with an `action` discriminator, following `src/app/api/admin/revenue/discover/route.ts`. The two agent routes are separate files because they authenticate differently and must not accidentally inherit `requireFounder()`.

`outreach-policy.ts` imports nothing from Supabase on purpose: it is the one module where a mistake blasts 20,000 messages, so it has to be testable without a database.

---

## Task 1: Migration

**Files:**
- Create: `supabase/migrations/20261017100000_revenue_outreach.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `re_outreach_campaigns`, `re_outreach_recipients`, `re_outreach_sent_phones`, `re_outreach_agents`, `re_suppressions`; function `re_outreach_claim_next(p_campaign_id uuid, p_agent_id uuid, p_stale_before timestamptz) returns public.re_outreach_recipients`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261017100000_revenue_outreach.sql`:

```sql
-- ============================================================
-- 20261017100000_revenue_outreach.sql
--
-- WhatsApp outreach for Lead Discovery prospects.
--
-- WHAT SENDS, AND WHY THAT SHAPES THIS
--
-- Not the Meta Cloud API. A Chrome extension drives the founder's own
-- WhatsApp Web session, because the numbers harvested from Google Maps never
-- opted in and the official API would reject the templates and tank the
-- number's quality rating before it rejected them.
--
-- The extension is deliberately stupid. It holds no cap, no window, no ramp
-- and no template: it asks `/next` for one number and one finished message,
-- sends it, and reports back. So every brake lives here and in
-- outreach-policy.ts, where it can be tested without loading an extension.
--
-- RLS IS ON WITH NO POLICIES
--
-- Platform-owner data, like re_discovery_* and retention_runs. Reachable only
-- through the service role after requireFounder() has passed. A policy here
-- would be a way in, not a protection.
-- ============================================================

-- ── Campaigns ──
create table if not exists public.re_outreach_campaigns (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  -- Two to four wordings, rotated per recipient. One message sent 20,000 times
  -- byte-identical is what bulk-send fingerprinting looks for.
  variants       text[] not null,
  attachment_path text,
  status         text not null default 'draft'
                 check (status in ('draft','running','paused','done','stopped')),
  daily_cap      integer not null default 80 check (daily_cap between 1 and 500),
  gap_min_sec    integer not null default 45 check (gap_min_sec >= 5),
  gap_max_sec    integer not null default 120,
  window_start   time not null default '10:00',
  window_end     time not null default '18:30',
  weekdays_only  boolean not null default true,
  -- Why the dead-man switch stopped it, shown on the page so a paused campaign
  -- is never a mystery.
  paused_reason  text,
  -- The number this campaign has been sending from. A mismatch against the
  -- extension's logged-in number pauses rather than silently switching.
  sender_phone   text,
  -- WHY A RESET MARKER AND NOT JUST COUNTING THE LAST FEW ROWS
  --
  -- The dead-man switch counts consecutive `failed` recipients. Those rows
  -- are still there after the founder fixes whatever broke, so pressing Start
  -- would recount the same three failures and re-pause instantly — a campaign
  -- that can never be resumed. Resuming stamps this, and only failures
  -- claimed after it count.
  failure_streak_reset_at timestamptz not null default now(),
  owner_id       uuid not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint re_outreach_variants_count
    check (array_length(variants, 1) between 2 and 4),
  constraint re_outreach_gap_order check (gap_max_sec >= gap_min_sec)
);

-- ── Agents (installed extensions) ──
--
-- Declared before the recipients table, which references it.
create table if not exists public.re_outreach_agents (
  id                   uuid primary key default gen_random_uuid(),
  label                text not null default '',
  -- sha256 hex. The token itself is shown once, at mint, and never stored.
  token_hash           text not null unique,
  -- Reported by the extension on every call: the number WhatsApp Web is
  -- actually logged in as. The ramp and the cap are counted against THIS, not
  -- the campaign, so switching to a fresh number starts at day one.
  sender_phone         text,
  sender_first_sent_on date,
  last_seen_at         timestamptz,
  revoked_at           timestamptz,
  owner_id             uuid not null,
  created_at           timestamptz not null default now()
);

-- ── Recipients ──
create table if not exists public.re_outreach_recipients (
  id            bigserial primary key,
  campaign_id   uuid not null
                references public.re_outreach_campaigns (id) on delete cascade,
  place_id      text not null default '',
  -- Normalised by normalisePhone() in discovery-query.ts: 91XXXXXXXXXX.
  phone         text not null,
  -- Snapshotted, not joined. re_discovery_leads is purged after 90 days and a
  -- campaign at 80/day runs for weeks; a reference would start failing
  -- halfway through.
  name          text not null default '',
  city          text not null default '',
  district      text not null default '',
  state         text not null default '',
  industry      text not null default '',
  status        text not null default 'queued' check (status in (
                  'queued','in_flight','sent','failed',
                  'skipped_not_on_whatsapp','skipped_blocked',
                  'skipped_suppressed','skipped_already_sent')),
  -- Written when the row is claimed, not at creation: the variant is only
  -- chosen once suppression and already-sent have agreed it is really going.
  variant_index integer,
  rendered_text text,
  -- Test sends jump the queue and skip the cap, the window and the
  -- already-sent list, but go down every other inch of the same path.
  is_test       boolean not null default false,
  claimed_by    uuid references public.re_outreach_agents (id),
  claimed_at    timestamptz,
  sent_at       timestamptz,
  attempts      integer not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  unique (campaign_id, phone)
);

create index if not exists re_outreach_recipients_claim_idx
  on public.re_outreach_recipients (campaign_id, status, is_test desc, id);

create index if not exists re_outreach_recipients_sent_idx
  on public.re_outreach_recipients (campaign_id, sent_at);

-- ── Permanent: everyone ever messaged ──
--
-- A later campaign for a different industry in the same district re-finds the
-- same companies. This is what stops one switchboard getting the same pitch
-- twice. re_discovery_seen_places' job, one layer up.
create table if not exists public.re_outreach_sent_phones (
  phone         text primary key,
  first_sent_at timestamptz not null default now(),
  campaign_id   uuid,
  place_id      text not null default ''
);

-- ── Do-not-contact ──
--
-- Named, columned and vocabularied exactly as Revenue Engine R1 section 6.13
-- specifies, so that when the rest of R1 lands there is one suppression list
-- rather than two that disagree.
create table if not exists public.re_suppressions (
  id         uuid primary key default gen_random_uuid(),
  channel    text not null check (channel in ('email','phone','whatsapp','sms','domain','all')),
  value      text not null,
  reason     text not null default 'opt_out' check (reason in (
               'opt_out','bounce','complaint','competitor',
               'existing_customer','manual')),
  note       text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (channel, value)
);

alter table public.re_outreach_campaigns   enable row level security;
alter table public.re_outreach_recipients  enable row level security;
alter table public.re_outreach_sent_phones enable row level security;
alter table public.re_outreach_agents      enable row level security;
alter table public.re_suppressions         enable row level security;

-- ── Claiming one recipient ──
--
-- WHY THIS IS A FUNCTION AND NOT A SELECT THEN AN UPDATE
--
-- Two callers must never get the same recipient: a retried request, two Chrome
-- windows, a reloaded extension. Reading then writing from the route leaves
-- exactly that gap, and the bug it produces is a prospect messaged twice —
-- which is both the thing that gets a number reported and invisible in any
-- log until someone complains.
--
-- `for update skip locked` is what makes two concurrent callers take two
-- different rows instead of one row twice.
create or replace function public.re_outreach_claim_next(
  p_campaign_id  uuid,
  p_agent_id     uuid,
  p_stale_before timestamptz
)
returns public.re_outreach_recipients
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.re_outreach_recipients;
begin
  -- A laptop that closed mid-send leaves a row claimed for ever. Releasing it
  -- risks a rare double-send; leaving it strands the recipient permanently.
  -- The first is recoverable, the second is not.
  update public.re_outreach_recipients
     set status = 'queued', claimed_by = null, claimed_at = null
   where campaign_id = p_campaign_id
     and status = 'in_flight'
     and claimed_at < p_stale_before;

  update public.re_outreach_recipients
     set status     = 'in_flight',
         claimed_by = p_agent_id,
         claimed_at = now(),
         attempts   = attempts + 1
   where id = (
           select id
             from public.re_outreach_recipients
            where campaign_id = p_campaign_id
              and status = 'queued'
            order by is_test desc, id
            limit 1
              for update skip locked
         )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.re_outreach_claim_next(uuid, uuid, timestamptz) is
  'Claims one queued recipient for an agent, test rows first, releasing stale in_flight claims as it goes. Null when nothing is queued.';

revoke all on function public.re_outreach_claim_next(uuid, uuid, timestamptz)
  from anon, authenticated;
```

- [ ] **Step 2: Check the file parses as SQL**

Run: `npx prettier --check supabase/migrations/20261017100000_revenue_outreach.sql`

Expected: either a pass, or a formatting complaint only. Prettier does not validate SQL, so this is a typo net, not a guarantee. If prettier rewrites it, re-read the diff and confirm nothing inside the `$$ ... $$` body changed meaning.

- [ ] **Step 3: Check the declaration order**

Postgres creates tables in file order, so a `references` to a table declared later fails with `relation "…" does not exist`. Confirm the order is: `re_outreach_campaigns`, `re_outreach_agents`, `re_outreach_recipients` (which references agents), `re_outreach_sent_phones`, `re_suppressions`.

Run: `grep -n 'create table' supabase/migrations/20261017100000_revenue_outreach.sql`

Expected: `re_outreach_agents` appears above `re_outreach_recipients`, and each table appears exactly once.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261017100000_revenue_outreach.sql
git commit -m "Add the outreach tables and the single-statement recipient claim

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: STOP and hand the migration to the founder**

The Supabase MCP cannot reach the Mumbai project, so this cannot be applied from here. Tell the founder: "Migration `20261017100000_revenue_outreach.sql` is committed and needs running on prod before Task 5 can be tested." Do not start Task 5 until he confirms it ran.

Tasks 2, 3 and 4 need no database and can proceed meanwhile.

---

## Task 2: Throttle policy

This is the task that matters. Everything that decides whether the founder's business number survives lives here, and none of it touches a database.

**Files:**
- Create: `src/lib/revenue/outreach-policy.ts`
- Test: `src/lib/revenue/outreach-policy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `OUTREACH_TIMEZONE: "Asia/Kolkata"`, `DEFAULT_DAILY_CAP: 80`, `DEFAULT_GAP_MIN_SEC: 45`, `DEFAULT_GAP_MAX_SEC: 120`, `WARMUP_STEP: 20`, `LONG_BREAK_EVERY: 20`, `LONG_BREAK_MIN_SEC: 300`, `LONG_BREAK_MAX_SEC: 720`, `MAX_POLL_WAIT_SEC: 600`, `CLAIM_STALE_MINUTES: 15`, `MAX_CONSECUTIVE_FAILURES: 3`, `OPT_OUT_LINE: string`, `MERGE_FALLBACKS: Record<string,string>`
  - `zonedClock(now: Date, timezone: string): ZonedClock` where `ZonedClock = { ymd: string; minutes: number; weekday: number }`
  - `parseHhMm(value: string): number`
  - `isInSendWindow(clock: ZonedClock, window: SendWindow): boolean` where `SendWindow = { windowStart: string; windowEnd: string; weekdaysOnly: boolean }`
  - `requiredGapSeconds(sentCount: number, minSec: number, maxSec: number): number`
  - `isLongBreakDue(sentToday: number): boolean`
  - `daysBetween(fromYmd: string, toYmd: string): number`
  - `daysSending(firstSentOn: string | null, todayYmd: string): number`
  - `warmUpCap(day: number, dailyCap: number): number`
  - `pickVariant(recipientId: number, variantCount: number): number`
  - `renderMessage(variant: string, fields: Record<string, string>): string`
  - `decide(input: DecideInput): Decision`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/revenue/outreach-policy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_DAILY_CAP,
  LONG_BREAK_MAX_SEC,
  LONG_BREAK_MIN_SEC,
  MAX_POLL_WAIT_SEC,
  OPT_OUT_LINE,
  OUTREACH_TIMEZONE,
  daysBetween,
  daysSending,
  decide,
  isInSendWindow,
  isLongBreakDue,
  parseHhMm,
  pickVariant,
  renderMessage,
  requiredGapSeconds,
  warmUpCap,
  zonedClock,
  type DecideInput,
  type SendWindow,
} from "./outreach-policy";

const WINDOW: SendWindow = {
  windowStart: "10:00",
  windowEnd: "18:30",
  weekdaysOnly: true,
};

/** 2026-10-19 is a Monday. Helper builds an IST instant. */
function ist(ymd: string, hhmm: string): Date {
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

describe("zonedClock", () => {
  it("reads the date and time in India, not UTC", () => {
    // 19:30 UTC on the 19th is 01:00 IST on the 20th.
    const clock = zonedClock(new Date("2026-10-19T19:30:00Z"), OUTREACH_TIMEZONE);
    expect(clock.ymd).toBe("2026-10-20");
    expect(clock.minutes).toBe(60);
  });

  it("reports midnight as 0 minutes, not 1440", () => {
    // Intl with hour12:false renders midnight as hour "24" in some runtimes.
    const clock = zonedClock(ist("2026-10-19", "00:00"), OUTREACH_TIMEZONE);
    expect(clock.minutes).toBe(0);
  });

  it("numbers Sunday 0 through Saturday 6", () => {
    expect(zonedClock(ist("2026-10-18", "12:00"), OUTREACH_TIMEZONE).weekday).toBe(0);
    expect(zonedClock(ist("2026-10-19", "12:00"), OUTREACH_TIMEZONE).weekday).toBe(1);
    expect(zonedClock(ist("2026-10-24", "12:00"), OUTREACH_TIMEZONE).weekday).toBe(6);
  });
});

describe("parseHhMm", () => {
  it("turns a clock string into minutes since midnight", () => {
    expect(parseHhMm("10:00")).toBe(600);
    expect(parseHhMm("18:30")).toBe(1110);
  });
});

describe("isInSendWindow", () => {
  const at = (ymd: string, hhmm: string) =>
    isInSendWindow(zonedClock(ist(ymd, hhmm), OUTREACH_TIMEZONE), WINDOW);

  it("treats the end of the window as exclusive", () => {
    expect(at("2026-10-19", "18:29")).toBe(true);
    expect(at("2026-10-19", "18:30")).toBe(false);
    expect(at("2026-10-19", "18:31")).toBe(false);
  });

  it("opens exactly on the hour and not a minute before", () => {
    expect(at("2026-10-19", "09:59")).toBe(false);
    expect(at("2026-10-19", "10:00")).toBe(true);
  });

  it("never sends at the weekend when weekdaysOnly", () => {
    expect(at("2026-10-18", "12:00")).toBe(false); // Sunday
    expect(at("2026-10-24", "12:00")).toBe(false); // Saturday
  });

  it("sends at the weekend when weekdaysOnly is off", () => {
    const clock = zonedClock(ist("2026-10-18", "12:00"), OUTREACH_TIMEZONE);
    expect(isInSendWindow(clock, { ...WINDOW, weekdaysOnly: false })).toBe(true);
  });
});

describe("requiredGapSeconds", () => {
  it("stays inside the range for every counter", () => {
    for (let n = 0; n < 1000; n++) {
      const gap = requiredGapSeconds(n, 45, 120);
      expect(gap).toBeGreaterThanOrEqual(45);
      expect(gap).toBeLessThanOrEqual(120);
    }
  });

  it("is the same every time for one counter", () => {
    // Repeated /next polls during a single wait must compute the same
    // deadline, or the wait never ends.
    expect(requiredGapSeconds(7, 45, 120)).toBe(requiredGapSeconds(7, 45, 120));
  });

  it("varies between consecutive messages", () => {
    // A fixed gap is the clearest bot signature there is.
    const seen = new Set<number>();
    for (let n = 0; n < 100; n++) seen.add(requiredGapSeconds(n, 45, 120));
    expect(seen.size).toBeGreaterThan(20);
  });

  it("collapses to the floor when the range is empty", () => {
    expect(requiredGapSeconds(3, 60, 60)).toBe(60);
  });
});

describe("isLongBreakDue", () => {
  it("fires on the 20th send and not the 21st", () => {
    expect(isLongBreakDue(19)).toBe(false);
    expect(isLongBreakDue(20)).toBe(true);
    expect(isLongBreakDue(21)).toBe(false);
    expect(isLongBreakDue(40)).toBe(true);
  });

  it("does not fire before anything has been sent", () => {
    expect(isLongBreakDue(0)).toBe(false);
  });
});

describe("daysBetween / daysSending", () => {
  it("counts calendar days without a timezone sneaking in", () => {
    expect(daysBetween("2026-10-19", "2026-10-21")).toBe(2);
    expect(daysBetween("2026-02-27", "2026-03-01")).toBe(2); // 2026 is not a leap year
  });

  it("calls a number that has never sent day one", () => {
    expect(daysSending(null, "2026-10-19")).toBe(1);
  });

  it("calls the first day of sending day one", () => {
    expect(daysSending("2026-10-19", "2026-10-19")).toBe(1);
  });

  it("counts the third day as three", () => {
    expect(daysSending("2026-10-19", "2026-10-21")).toBe(3);
  });
});

describe("warmUpCap", () => {
  it("opens at 20 and climbs 20 a day", () => {
    expect(warmUpCap(1, DEFAULT_DAILY_CAP)).toBe(20);
    expect(warmUpCap(2, DEFAULT_DAILY_CAP)).toBe(40);
    expect(warmUpCap(3, DEFAULT_DAILY_CAP)).toBe(60);
  });

  it("never exceeds the cap the founder set", () => {
    expect(warmUpCap(4, DEFAULT_DAILY_CAP)).toBe(80);
    expect(warmUpCap(99, DEFAULT_DAILY_CAP)).toBe(80);
    expect(warmUpCap(99, 30)).toBe(30);
  });
});

describe("pickVariant", () => {
  it("spreads evenly across a thousand recipients", () => {
    const counts = [0, 0, 0];
    for (let id = 1; id <= 999; id++) counts[pickVariant(id, 3)]++;
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("stays in range for two variants", () => {
    expect(pickVariant(1, 2)).toBeLessThan(2);
    expect(pickVariant(5000, 2)).toBeLessThan(2);
  });
});

describe("renderMessage", () => {
  it("substitutes the merge fields", () => {
    const out = renderMessage("Hello {name} in {city}", {
      name: "Shah Industries",
      city: "Hubballi",
      industry: "seeds",
    });
    expect(out).toContain("Hello Shah Industries in Hubballi");
  });

  it("falls back rather than leaving a hole when Google gave us nothing", () => {
    // Google returns blank city constantly, and "Hello ," reads as a bot.
    const out = renderMessage("Hello {name} in {city}", {
      name: "",
      city: "",
      industry: "",
    });
    expect(out).not.toContain("{");
    expect(out).not.toContain("Hello  in");
    expect(out).toContain("Hello there");
  });

  it("strips a merge field nobody defined", () => {
    const out = renderMessage("Hi {name}, about {nonsense} today", { name: "A" });
    expect(out).not.toContain("{nonsense}");
    expect(out).not.toContain("  ");
  });

  it("appends the opt-out line exactly once", () => {
    const withIt = renderMessage(`Hi {name}. ${OPT_OUT_LINE}`, { name: "A" });
    expect(withIt.split(OPT_OUT_LINE)).toHaveLength(2);
    const without = renderMessage("Hi {name}.", { name: "A" });
    expect(without).toContain(OPT_OUT_LINE);
  });
});

describe("decide", () => {
  const base: DecideInput = {
    now: ist("2026-10-19", "11:00"),
    timezone: OUTREACH_TIMEZONE,
    window: WINDOW,
    dailyCap: DEFAULT_DAILY_CAP,
    sentToday: 0,
    firstSentOn: "2026-10-01",
    lastSentAt: null,
    gapMinSec: 45,
    gapMaxSec: 120,
    queuedRemaining: 100,
    consecutiveFailures: 0,
  };

  it("sends the first message of the day immediately", () => {
    expect(decide(base)).toEqual({ kind: "send" });
  });

  it("pauses after three failures in a row, before anything else", () => {
    // Checked first on purpose: a campaign failing every send must stop even
    // if it is inside the window with plenty queued.
    const d = decide({ ...base, consecutiveFailures: 3 });
    expect(d.kind).toBe("paused");
  });

  it("is done when nothing is queued", () => {
    expect(decide({ ...base, queuedRemaining: 0 }).kind).toBe("done");
  });

  it("waits outside the window instead of sending", () => {
    const d = decide({ ...base, now: ist("2026-10-19", "21:00") });
    expect(d).toEqual({
      kind: "wait",
      waitSeconds: MAX_POLL_WAIT_SEC,
      reason: "Outside the send window",
    });
  });

  it("waits once the warmed-up cap for today is reached", () => {
    // Day 1 of a new number: the ceiling is 20, not the campaign's 80.
    const d = decide({ ...base, firstSentOn: "2026-10-19", sentToday: 20 });
    expect(d.kind).toBe("wait");
    if (d.kind === "wait") expect(d.reason).toContain("20");
  });

  it("still sends at 20 when the number is warm", () => {
    expect(decide({ ...base, sentToday: 19, firstSentOn: "2026-10-01" }).kind).toBe("send");
  });

  it("spaces messages out when the last one was too recent", () => {
    const d = decide({
      ...base,
      sentToday: 1,
      lastSentAt: new Date(base.now.getTime() - 10_000),
    });
    expect(d.kind).toBe("wait");
    if (d.kind === "wait") {
      expect(d.waitSeconds).toBeGreaterThan(0);
      expect(d.waitSeconds).toBeLessThanOrEqual(120);
    }
  });

  it("sends once the gap has elapsed", () => {
    const d = decide({
      ...base,
      sentToday: 1,
      lastSentAt: new Date(base.now.getTime() - 121_000),
    });
    expect(d).toEqual({ kind: "send" });
  });

  it("takes a long break on the 20th, not a short gap", () => {
    const d = decide({
      ...base,
      sentToday: 20,
      firstSentOn: "2026-10-01",
      lastSentAt: new Date(base.now.getTime() - 130_000),
    });
    expect(d.kind).toBe("wait");
    if (d.kind === "wait") {
      expect(d.waitSeconds).toBeGreaterThan(LONG_BREAK_MIN_SEC - 130 - 1);
      expect(d.waitSeconds).toBeLessThanOrEqual(LONG_BREAK_MAX_SEC);
      expect(d.reason).toContain("break");
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/revenue/outreach-policy.test.ts`

Expected: FAIL — `Failed to resolve import "./outreach-policy"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/revenue/outreach-policy.ts`:

```ts
// ============================================================
// Outreach throttle policy — every brake on the sender, in one pure module.
//
// WHY THIS FILE IMPORTS NOTHING
//
// The Chrome extension that does the sending is the least reviewable code in
// the system: unpacked, unversioned by any registry, run by nobody but Chrome.
// It must not be the component holding the brakes. So it holds none of them —
// it asks `/next` for one number and one finished message — and everything it
// would otherwise have decided lives here, where it is ordinary TypeScript
// with ordinary tests.
//
// There is no database harness in this repo, which is the other reason: a
// mistake in this file sends 20,000 messages from the founder's business
// WhatsApp number, and "we'll check it by watching" is not a test.
// ============================================================

/**
 * India time. The founder's day, his prospects' day, and the day boundary the
 * cap resets on. Never derived from the server's clock zone, which is UTC on
 * Vercel and would start the day 5.5 hours late.
 */
export const OUTREACH_TIMEZONE = "Asia/Kolkata";

export const DEFAULT_DAILY_CAP = 80;
export const DEFAULT_GAP_MIN_SEC = 45;
export const DEFAULT_GAP_MAX_SEC = 120;

/** How much further a number may send each day of its warm-up. */
export const WARMUP_STEP = 20;

export const LONG_BREAK_EVERY = 20;
export const LONG_BREAK_MIN_SEC = 300;
export const LONG_BREAK_MAX_SEC = 720;

/**
 * The longest the extension is ever told to sleep.
 *
 * Out-of-window and cap-reached waits could be computed exactly, which means
 * multi-day calendar arithmetic for a wait nobody is watching. Capping the
 * poll instead costs one HTTP request every ten minutes and buys something
 * better: a window or cap the founder edits mid-campaign takes effect within
 * ten minutes instead of at the end of a wait computed under the old numbers.
 */
export const MAX_POLL_WAIT_SEC = 600;

/** An in_flight claim older than this is a laptop that closed mid-send. */
export const CLAIM_STALE_MINUTES = 15;

export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Appended to every message that does not already carry it.
 *
 * Nothing in V1 reads replies, so this is honoured by hand — the founder sees
 * the reply on his phone and pastes the number into the suppression box. It is
 * still not optional: bulk messages with no way out are what get a number
 * reported, and being reported is what actually ends in a ban.
 */
export const OPT_OUT_LINE = "Reply STOP and I won't message you again.";

/**
 * What a blank merge field becomes.
 *
 * Google Maps returns an empty city constantly, and "Hello , in " reads as a
 * bot to a human and as a template to WhatsApp.
 */
export const MERGE_FALLBACKS: Record<string, string> = {
  name: "there",
  city: "your area",
  industry: "your line of work",
};

export interface SendWindow {
  /** "10:00" */
  windowStart: string;
  /** "18:30", exclusive. */
  windowEnd: string;
  weekdaysOnly: boolean;
}

export interface ZonedClock {
  /** yyyy-mm-dd in the zone. */
  ymd: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function zonedClock(now: Date, timezone: string): ZonedClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(now);

  const got: Record<string, string> = {};
  for (const part of parts) got[part.type] = part.value;

  // Intl renders midnight as hour "24" under hour12:false in some runtimes,
  // which would read as 1440 minutes and fall outside every window.
  const hour = Number(got.hour) % 24;

  return {
    ymd: `${got.year}-${got.month}-${got.day}`,
    minutes: hour * 60 + Number(got.minute),
    weekday: WEEKDAY_INDEX[got.weekday] ?? 0,
  };
}

export function parseHhMm(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function isInSendWindow(clock: ZonedClock, window: SendWindow): boolean {
  if (window.weekdaysOnly && (clock.weekday === 0 || clock.weekday === 6)) {
    return false;
  }
  // End exclusive: comparing against 18:30 inclusive would let a message start
  // at the moment the window closes.
  return (
    clock.minutes >= parseHhMm(window.windowStart) &&
    clock.minutes < parseHhMm(window.windowEnd)
  );
}

/**
 * How long this particular message must sit behind the last one.
 *
 * Deterministic in `sentCount`, deliberately. The gap has to look random to
 * WhatsApp but be stable to us: `/next` is polled repeatedly during one wait,
 * and a fresh random number each poll would move the deadline every time and
 * the wait would never end.
 */
export function requiredGapSeconds(
  sentCount: number,
  minSec: number,
  maxSec: number,
): number {
  if (maxSec <= minSec) return minSec;
  let hash = Math.imul(sentCount + 1, 2654435761) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822519) >>> 0;
  hash ^= hash >>> 13;
  return minSec + ((hash >>> 0) % (maxSec - minSec + 1));
}

export function isLongBreakDue(sentToday: number): boolean {
  return sentToday > 0 && sentToday % LONG_BREAK_EVERY === 0;
}

/**
 * Calendar days between two yyyy-mm-dd strings.
 *
 * Arithmetic is done on the parsed numbers through Date.UTC, never by parsing
 * the string into a local Date, so no timezone can re-enter after the clock
 * has already been read in the right zone.
 */
export function daysBetween(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000,
  );
}

/** Which day of this number's sending life today is. Never less than 1. */
export function daysSending(firstSentOn: string | null, todayYmd: string): number {
  if (!firstSentOn) return 1;
  return Math.max(1, daysBetween(firstSentOn, todayYmd) + 1);
}

export function warmUpCap(day: number, dailyCap: number): number {
  return Math.min(dailyCap, Math.max(1, day) * WARMUP_STEP);
}

/**
 * Which wording this recipient gets.
 *
 * Recipient ids are sequential within a campaign, so a modulo spreads the
 * variants evenly without having to count anything.
 */
export function pickVariant(recipientId: number, variantCount: number): number {
  if (variantCount <= 1) return 0;
  return recipientId % variantCount;
}

export function renderMessage(
  variant: string,
  fields: Record<string, string>,
): string {
  const filled = variant.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = (fields[key] ?? "").trim();
    if (value) return value;
    // A defined-but-blank field falls back; an undefined one disappears.
    return MERGE_FALLBACKS[key] ?? "";
  });

  const tidied = filled.replace(/[ \t]{2,}/g, " ").replace(/ +([,.])/g, "$1").trim();

  return tidied.includes(OPT_OUT_LINE) ? tidied : `${tidied}\n\n${OPT_OUT_LINE}`;
}

export interface DecideInput {
  now: Date;
  timezone: string;
  window: SendWindow;
  dailyCap: number;
  /** Sends from THIS NUMBER today, across every campaign. */
  sentToday: number;
  /** First day this number ever sent, yyyy-mm-dd. Null = it never has. */
  firstSentOn: string | null;
  lastSentAt: Date | null;
  gapMinSec: number;
  gapMaxSec: number;
  queuedRemaining: number;
  consecutiveFailures: number;
}

export type Decision =
  | { kind: "send" }
  | { kind: "wait"; waitSeconds: number; reason: string }
  | { kind: "paused"; reason: string }
  | { kind: "done"; reason: string };

/**
 * The whole policy, in the order the checks have to happen.
 *
 * Failures are checked before anything else: a campaign failing every send
 * must stop even when it is mid-window with thousands queued, because the
 * most likely cause is a logged-out or restricted WhatsApp session and
 * carrying on is how a restriction becomes a ban.
 */
export function decide(input: DecideInput): Decision {
  if (input.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return {
      kind: "paused",
      reason: `${input.consecutiveFailures} sends failed in a row`,
    };
  }

  if (input.queuedRemaining <= 0) {
    return { kind: "done", reason: "Every recipient has been dealt with" };
  }

  const clock = zonedClock(input.now, input.timezone);

  if (!isInSendWindow(clock, input.window)) {
    return {
      kind: "wait",
      waitSeconds: MAX_POLL_WAIT_SEC,
      reason: "Outside the send window",
    };
  }

  const cap = warmUpCap(
    daysSending(input.firstSentOn, clock.ymd),
    input.dailyCap,
  );
  if (input.sentToday >= cap) {
    return {
      kind: "wait",
      waitSeconds: MAX_POLL_WAIT_SEC,
      reason: `Reached today's cap of ${cap}`,
    };
  }

  const longBreak = isLongBreakDue(input.sentToday);
  const needed = longBreak
    ? requiredGapSeconds(input.sentToday, LONG_BREAK_MIN_SEC, LONG_BREAK_MAX_SEC)
    : requiredGapSeconds(input.sentToday, input.gapMinSec, input.gapMaxSec);

  if (input.lastSentAt) {
    const elapsed = Math.floor(
      (input.now.getTime() - input.lastSentAt.getTime()) / 1000,
    );
    if (elapsed < needed) {
      return {
        kind: "wait",
        waitSeconds: needed - elapsed,
        reason: longBreak ? "Taking a long break" : "Spacing messages out",
      };
    }
  }

  return { kind: "send" };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/revenue/outreach-policy.test.ts`

Expected: PASS, all tests.

If `renderMessage`'s "Hello there" test fails, check the whitespace tidy: `"Hello {name} in {city}"` with blanks becomes `"Hello there in your area"`, so the assertion `not.toContain("Hello  in")` holds because the fallback filled the gap.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: no errors in `outreach-policy.ts`. Pre-existing errors elsewhere in the repo are not yours — `ts_errors.log` exists in the repo root, so compare against it before chasing anything.

- [ ] **Step 6: Commit**

```bash
git add src/lib/revenue/outreach-policy.ts src/lib/revenue/outreach-policy.test.ts
git commit -m "Put every outreach brake in one pure, tested module

The extension that does the sending holds no cap, no window, no ramp and
no gap, so all of it is here where it can be tested without loading an
extension. The gap is deterministic in the send count rather than random
because /next is polled repeatedly during one wait, and a fresh random
number each poll would move the deadline and the wait would never end.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Eligibility

**Files:**
- Create: `src/lib/revenue/outreach-eligibility.ts`
- Test: `src/lib/revenue/outreach-eligibility.test.ts`

**Interfaces:**
- Consumes: `normalisePhone` from `@/lib/revenue/discovery-query`.
- Produces:
  - `DiscoveryLeadRow = { place_id: string; phone: string; name: string; city: string; district: string; state: string; industry: string }`
  - `EligibleRecipient` — same shape, phone normalised
  - `Funnel = { matched: number; unusablePhone: number; duplicate: number; alreadySent: number; suppressed: number; toSend: number }`
  - `selectEligible(leads: DiscoveryLeadRow[], sentPhones: string[], suppressedValues: string[]): { recipients: EligibleRecipient[]; funnel: Funnel }`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/revenue/outreach-eligibility.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selectEligible, type DiscoveryLeadRow } from "./outreach-eligibility";

function lead(over: Partial<DiscoveryLeadRow> = {}): DiscoveryLeadRow {
  return {
    place_id: "p1",
    phone: "9876543210",
    name: "Shah Industries",
    city: "Hubballi",
    district: "Dharwada",
    state: "Karnataka",
    industry: "seeds",
    ...over,
  };
}

describe("selectEligible", () => {
  it("normalises the phone the same way the harvest did", () => {
    // The harvest wrote 91XXXXXXXXXX via normalisePhone. Matching on anything
    // else compares 9180… against 080… and finds nothing.
    const { recipients } = selectEligible([lead({ phone: "098765 43210" })], [], []);
    expect(recipients[0].phone).toBe("919876543210");
  });

  it("drops a row whose phone cannot be normalised", () => {
    const { recipients, funnel } = selectEligible([lead({ phone: "n/a" })], [], []);
    expect(recipients).toHaveLength(0);
    expect(funnel.unusablePhone).toBe(1);
  });

  it("keeps one row when a company lists several branches on one number", () => {
    const { recipients, funnel } = selectEligible(
      [lead({ place_id: "a" }), lead({ place_id: "b" })],
      [],
      [],
    );
    expect(recipients).toHaveLength(1);
    expect(funnel.duplicate).toBe(1);
  });

  it("never returns a number that has already been messaged", () => {
    const { recipients, funnel } = selectEligible([lead()], ["919876543210"], []);
    expect(recipients).toHaveLength(0);
    expect(funnel.alreadySent).toBe(1);
  });

  it("matches the already-sent list through normalisation too", () => {
    // The stored list is normalised, but a hand-pasted one may not be.
    const { funnel } = selectEligible([lead()], ["+91 98765 43210"], []);
    expect(funnel.alreadySent).toBe(1);
  });

  it("never returns a suppressed number", () => {
    const { recipients, funnel } = selectEligible([lead()], [], ["919876543210"]);
    expect(recipients).toHaveLength(0);
    expect(funnel.suppressed).toBe(1);
  });

  it("counts suppression before already-sent so the funnel adds up", () => {
    const { funnel } = selectEligible([lead()], ["919876543210"], ["919876543210"]);
    expect(funnel.suppressed).toBe(1);
    expect(funnel.alreadySent).toBe(0);
    expect(funnel.matched).toBe(1);
    expect(funnel.toSend).toBe(0);
  });

  it("reports a funnel that accounts for every matched row", () => {
    const { funnel } = selectEligible(
      [
        lead({ place_id: "a", phone: "9876543210" }),
        lead({ place_id: "b", phone: "9876543210" }),
        lead({ place_id: "c", phone: "bad" }),
        lead({ place_id: "d", phone: "9123456780" }),
        lead({ place_id: "e", phone: "9123456781" }),
      ],
      ["919123456780"],
      [],
    );
    expect(funnel.matched).toBe(5);
    expect(
      funnel.unusablePhone + funnel.duplicate + funnel.alreadySent +
        funnel.suppressed + funnel.toSend,
    ).toBe(5);
    expect(funnel.toSend).toBe(2);
  });

  it("carries the snapshot fields through", () => {
    const { recipients } = selectEligible([lead()], [], []);
    expect(recipients[0]).toMatchObject({
      name: "Shah Industries",
      city: "Hubballi",
      district: "Dharwada",
      state: "Karnataka",
      industry: "seeds",
      place_id: "p1",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/revenue/outreach-eligibility.test.ts`

Expected: FAIL — cannot resolve `./outreach-eligibility`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/revenue/outreach-eligibility.ts`:

```ts
// ============================================================
// Which harvested leads actually become recipients.
//
// WHY THIS IS A PURE FUNCTION OVER ARRAYS
//
// There is no database test harness in this repo — vitest runs
// environment: node and there is no local Supabase stack. The rule that
// matters most here ("never message someone who asked you not to, and never
// message anyone twice") therefore cannot be left in SQL, because nothing
// would be testing it. The route fetches three lists and this decides; at the
// ~1,200 rows a district selection produces, the cost of doing it in memory is
// nothing.
//
// EVERY COMPARISON GOES THROUGH normalisePhone
//
// Not normalizePhone from whatsapp/phone-utils, which only strips non-digits.
// normalisePhone in discovery-query.ts is the India-aware one that adds 91,
// drops the trunk 0 and leaves 1800/1860/1600 alone — and it is what wrote
// every re_discovery_leads.phone value. Comparing a 91-prefixed stored number
// against a bare 10-digit one finds nothing and re-messages the lot.
// ============================================================

import { normalisePhone } from "./discovery-query";

export interface DiscoveryLeadRow {
  place_id: string;
  phone: string;
  name: string;
  city: string;
  district: string;
  state: string;
  industry: string;
}

export interface EligibleRecipient extends DiscoveryLeadRow {
  /** Normalised: 91XXXXXXXXXX. */
  phone: string;
}

export interface Funnel {
  matched: number;
  unusablePhone: number;
  duplicate: number;
  alreadySent: number;
  suppressed: number;
  toSend: number;
}

export function selectEligible(
  leads: DiscoveryLeadRow[],
  sentPhones: string[],
  suppressedValues: string[],
): { recipients: EligibleRecipient[]; funnel: Funnel } {
  const sent = new Set(sentPhones.map(normalisePhone).filter(Boolean));
  const suppressed = new Set(suppressedValues.map(normalisePhone).filter(Boolean));

  const recipients: EligibleRecipient[] = [];
  const seen = new Set<string>();
  const funnel: Funnel = {
    matched: leads.length,
    unusablePhone: 0,
    duplicate: 0,
    alreadySent: 0,
    suppressed: 0,
    toSend: 0,
  };

  for (const lead of leads) {
    const phone = normalisePhone(lead.phone ?? "");

    if (!phone) {
      funnel.unusablePhone++;
      continue;
    }
    // One company with a Google listing per branch, all on the head-office
    // switchboard. Same pattern re_discovery_seen_places handles upstream.
    if (seen.has(phone)) {
      funnel.duplicate++;
      continue;
    }
    seen.add(phone);

    // Suppression is counted first so a number that is both suppressed and
    // already-sent appears once, and the funnel sums to `matched`.
    if (suppressed.has(phone)) {
      funnel.suppressed++;
      continue;
    }
    if (sent.has(phone)) {
      funnel.alreadySent++;
      continue;
    }

    recipients.push({ ...lead, phone });
  }

  funnel.toSend = recipients.length;
  return { recipients, funnel };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/revenue/outreach-eligibility.test.ts`

Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/revenue/outreach-eligibility.ts src/lib/revenue/outreach-eligibility.test.ts
git commit -m "Decide eligibility in memory so suppression is actually tested

There is no database harness here, so leaving \"never message a suppressed
number twice\" in SQL would leave the one rule that matters untested. Every
comparison goes through normalisePhone from discovery-query, which is what
wrote the stored phones; the phone-utils one only strips non-digits and
would compare 9180... against 080... and match nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Agent tokens

**Files:**
- Create: `src/lib/revenue/outreach-agents.ts`
- Test: `src/lib/revenue/outreach-agents.test.ts`

**Interfaces:**
- Consumes: `node:crypto`.
- Produces: `mintToken(): { token: string; tokenHash: string }`, `hashToken(token: string): string`, `AGENT_TOKEN_HEADER: "x-ozzo-agent-token"`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/revenue/outreach-agents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashToken, mintToken } from "./outreach-agents";

describe("mintToken", () => {
  it("returns a token and its hash, never the same twice", () => {
    const a = mintToken();
    const b = mintToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("mints something long enough not to be guessed", () => {
    expect(mintToken().token.length).toBeGreaterThanOrEqual(32);
  });

  it("mints a token safe to paste into a header", () => {
    // base64url: no +, /, = or whitespace to mangle in transit.
    expect(mintToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes the token it returns", () => {
    const { token, tokenHash } = mintToken();
    expect(hashToken(token)).toBe(tokenHash);
  });
});

describe("hashToken", () => {
  it("is deterministic, so a presented token can be looked up", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("is sha256 hex", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not collide on a one-character change", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/revenue/outreach-agents.test.ts`

Expected: FAIL — cannot resolve `./outreach-agents`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/revenue/outreach-agents.ts`:

```ts
// ============================================================
// The extension's credential.
//
// WHY A TOKEN AND NOT THE FOUNDER'S SESSION
//
// The extension's background service worker cannot borrow the logged-in
// session: Supabase's auth cookies are SameSite=Lax and a fetch from a
// chrome-extension:// origin is cross-site, so they are never sent. And a
// service-role key must not sit in an unpacked extension folder on a laptop.
//
// So: one row per installed extension, holding a random token's hash. Shown
// once at mint. Revoking the row stops that extension dead without touching
// anything else — the same narrow, individually revocable shape as
// re_discovery_runs.worker_token, but multi-use, because the extension comes
// back eighty times a day.
// ============================================================

import { createHash, randomBytes } from "node:crypto";

export const AGENT_TOKEN_HEADER = "x-ozzo-agent-token";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintToken(): { token: string; tokenHash: string } {
  // base64url so it survives being pasted into a header and an options field
  // without any +, / or = to mangle.
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/revenue/outreach-agents.test.ts`

Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/revenue/outreach-agents.ts src/lib/revenue/outreach-agents.test.ts
git commit -m "Give the extension a revocable token of its own

It cannot use the founder's session: Supabase's cookies are SameSite=Lax
and a fetch from a chrome-extension:// origin is cross-site, so they are
never sent. Storing the hash means a token is shown once and a lost laptop
is one row to revoke.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Store layer

**Prerequisite:** Task 1's migration must be applied on prod. Do not start otherwise.

**Files:**
- Create: `src/lib/revenue/outreach-store.ts`

**Interfaces:**
- Consumes: `serviceClient` from `@/lib/auth/superadmin`; `localRangeToUtc`, `resolvePeriod` from `@/lib/mcp/periods`; `CLAIM_STALE_MINUTES`, `OUTREACH_TIMEZONE` from `./outreach-policy`; `hashToken` from `./outreach-agents`.
- Produces:
  - `type Admin = SupabaseClient`
  - `CampaignRow` — the campaign columns the routes read
  - `authenticateAgent(admin: Admin, token: string | null): Promise<{ id: string; sender_phone: string | null; sender_first_sent_on: string | null } | null>`
  - `readCounters(admin: Admin, campaignId: string, senderPhone: string, failureStreakResetAt: string): Promise<{ sentToday: number; lastSentAt: Date | null; queuedRemaining: number; consecutiveFailures: number }>`
  - `claimNext(admin: Admin, campaignId: string, agentId: string): Promise<RecipientRow | null>`
  - `releaseClaim(admin: Admin, recipientId: number, agentId: string): Promise<void>`

- [ ] **Step 1: Write the implementation**

Create `src/lib/revenue/outreach-store.ts`:

```ts
// ============================================================
// The only module that reads or writes outreach rows.
//
// Keeping Supabase out of outreach-policy.ts is what makes the policy
// testable, so the counters it needs are gathered here and handed to it as
// plain numbers.
//
// WHY THE DAY BOUNDARY GOES THROUGH mcp/periods
//
// The cap resets at midnight in India. Doing that in UTC starts the day 5.5
// hours late, which on this codebase is the DSR bug in another costume — see
// the comment on localRangeToUtc. resolvePeriod("today", "Asia/Kolkata")
// gives the local date; localRangeToUtc turns it into the two instants to
// compare created_at against, with `to` exclusive.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { localRangeToUtc, resolvePeriod } from "@/lib/mcp/periods";
import { hashToken } from "./outreach-agents";
import {
  CLAIM_STALE_MINUTES,
  MAX_CONSECUTIVE_FAILURES,
  OUTREACH_TIMEZONE,
} from "./outreach-policy";

export type Admin = SupabaseClient;

export interface CampaignRow {
  id: string;
  name: string;
  variants: string[];
  attachment_path: string | null;
  status: string;
  daily_cap: number;
  gap_min_sec: number;
  gap_max_sec: number;
  window_start: string;
  window_end: string;
  weekdays_only: boolean;
  paused_reason: string | null;
  sender_phone: string | null;
  failure_streak_reset_at: string;
}

export const CAMPAIGN_COLUMNS =
  "id, name, variants, attachment_path, status, daily_cap, gap_min_sec, gap_max_sec, window_start, window_end, weekdays_only, paused_reason, sender_phone, failure_streak_reset_at";

export interface RecipientRow {
  id: number;
  campaign_id: string;
  phone: string;
  name: string;
  city: string;
  industry: string;
  is_test: boolean;
  place_id: string;
}

export interface AgentRow {
  id: string;
  sender_phone: string | null;
  sender_first_sent_on: string | null;
}

/**
 * Null for a missing, unknown or revoked token. The caller returns 401 and
 * says nothing about which of the three it was.
 */
export async function authenticateAgent(
  admin: Admin,
  token: string | null,
): Promise<AgentRow | null> {
  if (!token) return null;

  const { data } = await admin
    .from("re_outreach_agents")
    .select("id, sender_phone, sender_first_sent_on, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!data || data.revoked_at) return null;

  await admin
    .from("re_outreach_agents")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    id: data.id,
    sender_phone: data.sender_phone,
    sender_first_sent_on: data.sender_first_sent_on,
  };
}

/**
 * Everything decide() needs, counted at the moment of asking.
 *
 * `sentToday` is counted for the SENDING NUMBER across every campaign, not for
 * this campaign: it is the number that gets banned, so it is the number that
 * carries the cap.
 */
export async function readCounters(
  admin: Admin,
  campaignId: string,
  senderPhone: string,
  failureStreakResetAt: string,
): Promise<{
  sentToday: number;
  lastSentAt: Date | null;
  queuedRemaining: number;
  consecutiveFailures: number;
}> {
  const today = localRangeToUtc(resolvePeriod("today", OUTREACH_TIMEZONE));

  const senderCampaigns = await admin
    .from("re_outreach_campaigns")
    .select("id")
    .eq("sender_phone", senderPhone);

  const ids = (senderCampaigns.data ?? []).map((row) => row.id as string);
  // A campaign that has not recorded a sender yet is still this one.
  if (!ids.includes(campaignId)) ids.push(campaignId);

  const [sentTodayRes, lastSentRes, queuedRes, recentRes] = await Promise.all([
    admin
      .from("re_outreach_recipients")
      .select("id", { count: "exact", head: true })
      .in("campaign_id", ids)
      .eq("status", "sent")
      .eq("is_test", false)
      .gte("sent_at", today.from)
      .lt("sent_at", today.to),
    admin
      .from("re_outreach_recipients")
      .select("sent_at")
      .in("campaign_id", ids)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1),
    admin
      .from("re_outreach_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .in("status", ["queued", "in_flight"]),
    // Only `sent` and `failed` count; a skip is not a failure. Read a few more
    // than the threshold so the run of failures can be measured, not guessed.
    //
    // Scoped to after the last resume: the rows that paused this campaign are
    // still here once the founder has fixed whatever broke, and recounting
    // them would re-pause the moment he pressed Start.
    admin
      .from("re_outreach_recipients")
      .select("status")
      .eq("campaign_id", campaignId)
      .in("status", ["sent", "failed"])
      .gt("claimed_at", failureStreakResetAt)
      .order("claimed_at", { ascending: false })
      .limit(MAX_CONSECUTIVE_FAILURES + 1),
  ]);

  let consecutiveFailures = 0;
  for (const row of recentRes.data ?? []) {
    if (row.status !== "failed") break;
    consecutiveFailures++;
  }

  const lastSentAt = lastSentRes.data?.[0]?.sent_at
    ? new Date(lastSentRes.data[0].sent_at as string)
    : null;

  return {
    sentToday: sentTodayRes.count ?? 0,
    lastSentAt,
    queuedRemaining: queuedRes.count ?? 0,
    consecutiveFailures,
  };
}

export async function claimNext(
  admin: Admin,
  campaignId: string,
  agentId: string,
): Promise<RecipientRow | null> {
  const staleBefore = new Date(
    Date.now() - CLAIM_STALE_MINUTES * 60_000,
  ).toISOString();

  const { data, error } = await admin.rpc("re_outreach_claim_next", {
    p_campaign_id: campaignId,
    p_agent_id: agentId,
    p_stale_before: staleBefore,
  });

  if (error) throw error;
  return (data as RecipientRow | null) ?? null;
}

/** Put a claimed row back when the send never happened. */
export async function releaseClaim(
  admin: Admin,
  recipientId: number,
): Promise<void> {
  await admin
    .from("re_outreach_recipients")
    .update({ status: "queued", claimed_by: null, claimed_at: null })
    .eq("id", recipientId)
    .eq("status", "in_flight");
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: no new errors. If `admin.rpc(...)` complains about the generated types not knowing `re_outreach_claim_next`, regenerate or cast — the repo has `generate_typescript_types` available, but a `as unknown as RecipientRow | null` with a one-line comment is acceptable here and is what the discovery code does for its own RPC.

- [ ] **Step 3: Commit**

```bash
git add src/lib/revenue/outreach-store.ts
git commit -m "Gather the counters the throttle needs, in India time

sentToday is counted for the sending NUMBER across every campaign, not per
campaign: it is the number that gets banned, so it is the number that
carries the cap. The day boundary goes through mcp/periods rather than UTC,
which would start an Indian day 5.5 hours late.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Founder routes

**Files:**
- Create: `src/app/api/admin/revenue/outreach/route.ts`

**Interfaces:**
- Consumes: `requireFounder`, `serviceClient`; `toErrorResponse` from `@/lib/auth/account`; `selectEligible`; `mintToken`; `CAMPAIGN_COLUMNS`; `normalisePhone`.
- Produces: `POST` accepting `{ action: "preview" | "create" | "state" | "suppress" | "mintAgent" | "revokeAgent" | "testSend" }`, and `GET` returning campaigns + the active campaign's progress.

- [ ] **Step 1: Write the route**

Create `src/app/api/admin/revenue/outreach/route.ts`:

```ts
// ============================================================
// Outreach — founder actions.
//
// One route with an `action` discriminator, following the discover route next
// door. The two the extension calls live in their own files so they cannot
// accidentally inherit requireFounder().
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { normalisePhone } from "@/lib/revenue/discovery-query";
import { mintToken } from "@/lib/revenue/outreach-agents";
import { selectEligible, type DiscoveryLeadRow } from "@/lib/revenue/outreach-eligibility";
import { CAMPAIGN_COLUMNS, type Admin } from "@/lib/revenue/outreach-store";
import { DEFAULT_DAILY_CAP } from "@/lib/revenue/outreach-policy";

export const dynamic = "force-dynamic";

interface Filters {
  runId?: string;
  states?: string[];
  districts?: string[];
  industries?: string[];
}

/** The lead rows a selection matches. Read through the service role only. */
async function readLeads(admin: Admin, filters: Filters): Promise<DiscoveryLeadRow[]> {
  let query = admin
    .from("re_discovery_leads")
    .select("place_id, phone, name, city, district, state, industry")
    .neq("phone", "");

  if (filters.runId) query = query.eq("run_id", filters.runId);
  if (filters.states?.length) query = query.in("state", filters.states);
  if (filters.districts?.length) query = query.in("district", filters.districts);
  if (filters.industries?.length) query = query.in("industry", filters.industries);

  const { data, error } = await query.limit(20_000);
  if (error) throw error;
  return (data ?? []) as DiscoveryLeadRow[];
}

async function readLists(admin: Admin) {
  const [sent, suppressed] = await Promise.all([
    admin.from("re_outreach_sent_phones").select("phone"),
    admin
      .from("re_suppressions")
      .select("value")
      .in("channel", ["whatsapp", "phone", "all"]),
  ]);
  return {
    sentPhones: (sent.data ?? []).map((r) => r.phone as string),
    suppressedValues: (suppressed.data ?? []).map((r) => r.value as string),
  };
}

export async function GET() {
  try {
    await requireFounder();
    const admin = serviceClient();

    const [campaigns, agents] = await Promise.all([
      admin
        .from("re_outreach_campaigns")
        .select(CAMPAIGN_COLUMNS + ", created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      admin
        .from("re_outreach_agents")
        .select("id, label, sender_phone, sender_first_sent_on, last_seen_at, revoked_at")
        .order("created_at", { ascending: false }),
    ]);

    const active = (campaigns.data ?? []).find(
      (c) => c.status === "running" || c.status === "paused",
    );

    let progress = null;
    if (active) {
      const { data: rows } = await admin
        .from("re_outreach_recipients")
        .select("status")
        .eq("campaign_id", active.id);

      const counts: Record<string, number> = {};
      for (const row of rows ?? []) {
        counts[row.status as string] = (counts[row.status as string] ?? 0) + 1;
      }

      const { data: recent } = await admin
        .from("re_outreach_recipients")
        .select("phone, name, status, error, sent_at")
        .eq("campaign_id", active.id)
        .not("claimed_at", "is", null)
        .order("claimed_at", { ascending: false })
        .limit(10);

      progress = { counts, recent: recent ?? [] };
    }

    return NextResponse.json({
      campaigns: campaigns.data ?? [],
      agents: agents.data ?? [],
      progress,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireFounder();
    const admin = serviceClient();
    const body = await req.json();

    switch (body.action) {
      case "preview": {
        const leads = await readLeads(admin, body.filters ?? {});
        const { sentPhones, suppressedValues } = await readLists(admin);
        const { funnel } = selectEligible(leads, sentPhones, suppressedValues);
        return NextResponse.json({ funnel });
      }

      case "create": {
        const variants: string[] = (body.variants ?? []).filter(
          (v: string) => typeof v === "string" && v.trim(),
        );
        if (variants.length < 2 || variants.length > 4) {
          return NextResponse.json(
            { error: "Write between two and four wordings" },
            { status: 400 },
          );
        }

        const leads = await readLeads(admin, body.filters ?? {});
        const { sentPhones, suppressedValues } = await readLists(admin);
        const { recipients, funnel } = selectEligible(
          leads,
          sentPhones,
          suppressedValues,
        );

        if (!recipients.length) {
          return NextResponse.json(
            { error: "Nothing left to send to in that selection" },
            { status: 400 },
          );
        }

        const { data: campaign, error } = await admin
          .from("re_outreach_campaigns")
          .insert({
            name: String(body.name ?? "Untitled campaign").slice(0, 120),
            variants,
            attachment_path: body.attachmentPath ?? null,
            daily_cap: Number(body.dailyCap ?? DEFAULT_DAILY_CAP),
            status: "draft",
            owner_id: ctx.userId,
          })
          .select("id")
          .single();
        if (error) throw error;

        // Chunked because 20,000 rows in one insert exceeds what PostgREST
        // will accept, and a single unique violation rejects the whole
        // statement — the bug that cost 49 good rows in the leads importer.
        for (let i = 0; i < recipients.length; i += 500) {
          const chunk = recipients.slice(i, i + 500).map((r) => ({
            campaign_id: campaign.id,
            place_id: r.place_id,
            phone: r.phone,
            name: r.name,
            city: r.city,
            district: r.district,
            state: r.state,
            industry: r.industry,
          }));
          const { error: insertError } = await admin
            .from("re_outreach_recipients")
            .upsert(chunk, { onConflict: "campaign_id,phone", ignoreDuplicates: true });
          if (insertError) throw insertError;
        }

        return NextResponse.json({ campaignId: campaign.id, funnel });
      }

      case "state": {
        const next = String(body.status);
        if (!["running", "paused", "stopped"].includes(next)) {
          return NextResponse.json({ error: "Unknown state" }, { status: 400 });
        }
        const now = new Date().toISOString();
        await admin
          .from("re_outreach_campaigns")
          .update({
            status: next,
            // Clearing these on resume matters. The reason, or the page keeps
            // showing why it stopped three days ago; the streak marker, or the
            // failures that paused it are recounted and it pauses again
            // before it sends anything.
            ...(next === "running"
              ? { paused_reason: null, failure_streak_reset_at: now }
              : {}),
            updated_at: now,
          })
          .eq("id", body.campaignId);
        return NextResponse.json({ ok: true });
      }

      case "suppress": {
        const values: string[] = String(body.numbers ?? "")
          .split(/[\s,;]+/)
          .map(normalisePhone)
          .filter(Boolean);
        if (!values.length) {
          return NextResponse.json({ error: "No usable numbers" }, { status: 400 });
        }
        await admin.from("re_suppressions").upsert(
          values.map((value) => ({
            channel: "whatsapp",
            value,
            reason: "opt_out",
            note: String(body.note ?? ""),
            created_by: ctx.userId,
          })),
          { onConflict: "channel,value", ignoreDuplicates: true },
        );
        return NextResponse.json({ added: values.length });
      }

      case "mintAgent": {
        const { token, tokenHash } = mintToken();
        const { data, error } = await admin
          .from("re_outreach_agents")
          .insert({
            label: String(body.label ?? "This computer").slice(0, 60),
            token_hash: tokenHash,
            owner_id: ctx.userId,
          })
          .select("id")
          .single();
        if (error) throw error;
        // The only time the token is ever returned.
        return NextResponse.json({ agentId: data.id, token });
      }

      case "revokeAgent": {
        await admin
          .from("re_outreach_agents")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", body.agentId);
        return NextResponse.json({ ok: true });
      }

      case "testSend": {
        const phones: string[] = String(body.numbers ?? "")
          .split(/[\s,;]+/)
          .map(normalisePhone)
          .filter(Boolean)
          .slice(0, 3);
        if (!phones.length) {
          return NextResponse.json({ error: "No usable numbers" }, { status: 400 });
        }
        await admin.from("re_outreach_recipients").upsert(
          phones.map((phone) => ({
            campaign_id: body.campaignId,
            phone,
            name: "Test",
            is_test: true,
          })),
          { onConflict: "campaign_id,phone", ignoreDuplicates: true },
        );
        return NextResponse.json({ queued: phones.length });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint`

Expected: no new errors.

- [ ] **Step 3: Verify the guard by hand**

Start the app (`npm run dev`), sign in as a non-founder superadmin if one exists, and `POST /api/admin/revenue/outreach` with `{"action":"preview","filters":{}}`.

Expected: 403. As the founder: 200 with a `funnel` object.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/revenue/outreach/route.ts
git commit -m "Add the founder-side outreach actions

Recipient inserts are chunked and upserted with ignoreDuplicates, because
one unique violation rejects a whole statement — the bug that cost 49 good
rows in the leads importer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Agent routes

The heart of the system. `/next` is the only place that may decide a message goes out.

**Files:**
- Create: `src/app/api/admin/revenue/outreach/next/route.ts`
- Create: `src/app/api/admin/revenue/outreach/result/route.ts`

**Interfaces:**
- Consumes: `authenticateAgent`, `readCounters`, `claimNext`, `releaseClaim`, `CAMPAIGN_COLUMNS`; `decide`, `pickVariant`, `renderMessage`, `OUTREACH_TIMEZONE`; `AGENT_TOKEN_HEADER`.
- Produces: `POST /next` → `{ kind: "send", recipientId, phone, text, attachmentUrl? }` | `{ kind: "wait", waitSeconds, reason }` | `{ kind: "paused" | "done", reason }`; `POST /result` → `{ ok: true }`.

- [ ] **Step 1: Write `/next`**

Create `src/app/api/admin/revenue/outreach/next/route.ts`:

```ts
// ============================================================
// The one endpoint that may let a message out.
//
// Everything in the spec's "Keeping the number alive" is enforced here:
// suppression, already-sent, the cap, the window, the warm-up, the long break
// and the gap. The extension is told either one finished message or how long
// to sleep, and it holds none of these rules itself — so a bug in the
// extension cannot blast 20,000 messages, and all of this is testable without
// loading one.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/auth/superadmin";
import { normalisePhone } from "@/lib/revenue/discovery-query";
import { AGENT_TOKEN_HEADER } from "@/lib/revenue/outreach-agents";
import {
  OUTREACH_TIMEZONE,
  decide,
  pickVariant,
  renderMessage,
} from "@/lib/revenue/outreach-policy";
import {
  CAMPAIGN_COLUMNS,
  authenticateAgent,
  claimNext,
  readCounters,
  releaseClaim,
  type CampaignRow,
} from "@/lib/revenue/outreach-store";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const admin = serviceClient();
  const agent = await authenticateAgent(
    admin,
    req.headers.get(AGENT_TOKEN_HEADER),
  );
  if (!agent) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const senderPhone = normalisePhone(String(body.senderPhone ?? ""));
  if (!senderPhone) {
    return NextResponse.json(
      { kind: "paused", reason: "The extension did not say which number it is logged in as" },
      { status: 200 },
    );
  }

  const { data: campaign } = await admin
    .from("re_outreach_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ kind: "done", reason: "No campaign is running" });
  }
  const row = campaign as CampaignRow;

  // A number change is not something to carry on through: the warm-up history
  // belongs to the old number and the founder may have switched Chrome
  // profiles by accident.
  if (row.sender_phone && row.sender_phone !== senderPhone) {
    await admin
      .from("re_outreach_campaigns")
      .update({
        status: "paused",
        paused_reason: `WhatsApp Web is logged in as ${senderPhone}, but this campaign has been sending from ${row.sender_phone}`,
      })
      .eq("id", row.id);
    return NextResponse.json({ kind: "paused", reason: "The sending number changed" });
  }

  const counters = await readCounters(
    admin,
    row.id,
    senderPhone,
    row.failure_streak_reset_at,
  );

  const decision = decide({
    now: new Date(),
    timezone: OUTREACH_TIMEZONE,
    window: {
      windowStart: row.window_start,
      windowEnd: row.window_end,
      weekdaysOnly: row.weekdays_only,
    },
    dailyCap: row.daily_cap,
    sentToday: counters.sentToday,
    firstSentOn: agent.sender_first_sent_on,
    lastSentAt: counters.lastSentAt,
    gapMinSec: row.gap_min_sec,
    gapMaxSec: row.gap_max_sec,
    queuedRemaining: counters.queuedRemaining,
    consecutiveFailures: counters.consecutiveFailures,
  });

  if (decision.kind === "paused") {
    await admin
      .from("re_outreach_campaigns")
      .update({ status: "paused", paused_reason: decision.reason })
      .eq("id", row.id);
    return NextResponse.json(decision);
  }

  if (decision.kind === "done") {
    await admin
      .from("re_outreach_campaigns")
      .update({ status: "done" })
      .eq("id", row.id);
    return NextResponse.json(decision);
  }

  if (decision.kind === "wait") return NextResponse.json(decision);

  const recipient = await claimNext(admin, row.id, agent.id);
  if (!recipient) {
    // Everything queued is in another agent's hands, or the count was stale.
    return NextResponse.json({
      kind: "wait",
      waitSeconds: 60,
      reason: "Nothing free to claim",
    });
  }

  // Suppression is re-checked HERE, not at campaign creation, so a number the
  // founder suppressed an hour ago is spared even though it was eligible when
  // the campaign was built. Test rows skip it: they are his own numbers.
  if (!recipient.is_test) {
    const [suppressed, alreadySent] = await Promise.all([
      admin
        .from("re_suppressions")
        .select("value")
        .in("channel", ["whatsapp", "phone", "all"])
        .eq("value", recipient.phone)
        .maybeSingle(),
      admin
        .from("re_outreach_sent_phones")
        .select("phone")
        .eq("phone", recipient.phone)
        .maybeSingle(),
    ]);

    if (suppressed.data || alreadySent.data) {
      await admin
        .from("re_outreach_recipients")
        .update({
          status: suppressed.data ? "skipped_suppressed" : "skipped_already_sent",
          claimed_by: null,
        })
        .eq("id", recipient.id);
      // Answer immediately rather than sleeping: a skip costs nothing and the
      // extension should get to a real recipient on its next call.
      return NextResponse.json({ kind: "wait", waitSeconds: 1, reason: "Skipped" });
    }
  }

  const variantIndex = pickVariant(recipient.id, row.variants.length);
  const text = renderMessage(row.variants[variantIndex], {
    name: recipient.name,
    city: recipient.city,
    industry: recipient.industry,
  });

  let attachmentUrl: string | null = null;
  if (row.attachment_path) {
    const { data: signed } = await admin.storage
      .from("outreach")
      .createSignedUrl(row.attachment_path, 600);
    attachmentUrl = signed?.signedUrl ?? null;
  }

  const { error: stampError } = await admin
    .from("re_outreach_recipients")
    .update({ variant_index: variantIndex, rendered_text: text })
    .eq("id", recipient.id);

  // If we cannot record what we are about to send, do not send it: an
  // unrecorded send is one we cannot prove or deduplicate later.
  if (stampError) {
    await releaseClaim(admin, recipient.id, agent.id);
    throw stampError;
  }

  if (!row.sender_phone) {
    await admin
      .from("re_outreach_campaigns")
      .update({ sender_phone: senderPhone })
      .eq("id", row.id);
  }

  return NextResponse.json({
    kind: "send",
    recipientId: recipient.id,
    phone: recipient.phone,
    text,
    attachmentUrl,
    isTest: recipient.is_test,
  });
}
```

- [ ] **Step 2: Write `/result`**

Create `src/app/api/admin/revenue/outreach/result/route.ts`:

```ts
// ============================================================
// What happened to the message /next handed out.
//
// The dead-man switch is counted here rather than in the extension, for the
// same reason everything else is: the extension must not be the thing holding
// the brakes. A `logged_out` result pauses immediately — carrying on against a
// restricted session is how a restriction becomes a ban.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/auth/superadmin";
import { AGENT_TOKEN_HEADER } from "@/lib/revenue/outreach-agents";
import { OUTREACH_TIMEZONE, zonedClock } from "@/lib/revenue/outreach-policy";
import { authenticateAgent } from "@/lib/revenue/outreach-store";

export const dynamic = "force-dynamic";

const OUTCOMES = new Set([
  "sent",
  "failed",
  "skipped_not_on_whatsapp",
  "skipped_blocked",
  "logged_out",
]);

export async function POST(req: NextRequest) {
  const admin = serviceClient();
  const agent = await authenticateAgent(
    admin,
    req.headers.get(AGENT_TOKEN_HEADER),
  );
  if (!agent) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const outcome = String(body.outcome ?? "");
  const recipientId = Number(body.recipientId);

  if (!OUTCOMES.has(outcome) || !Number.isFinite(recipientId)) {
    return NextResponse.json({ error: "Unknown outcome" }, { status: 400 });
  }

  const { data: recipient } = await admin
    .from("re_outreach_recipients")
    .select("id, campaign_id, phone, place_id, is_test")
    .eq("id", recipientId)
    .maybeSingle();

  if (!recipient) {
    return NextResponse.json({ error: "Unknown recipient" }, { status: 404 });
  }

  if (outcome === "logged_out") {
    // Put the recipient back — it was never attempted.
    await admin
      .from("re_outreach_recipients")
      .update({ status: "queued", claimed_by: null, claimed_at: null })
      .eq("id", recipientId);
    await admin
      .from("re_outreach_campaigns")
      .update({
        status: "paused",
        paused_reason: "WhatsApp Web is not logged in",
      })
      .eq("id", recipient.campaign_id);
    return NextResponse.json({ ok: true });
  }

  const now = new Date();

  await admin
    .from("re_outreach_recipients")
    .update({
      status: outcome,
      sent_at: outcome === "sent" ? now.toISOString() : null,
      error: outcome === "failed" ? String(body.error ?? "").slice(0, 500) : null,
    })
    .eq("id", recipientId);

  if (outcome === "sent" && !recipient.is_test) {
    // Permanent, and written only on a confirmed send: a number recorded here
    // is a number no later campaign will ever message again, so recording a
    // send that did not happen loses a prospect for good.
    await admin.from("re_outreach_sent_phones").upsert(
      {
        phone: recipient.phone,
        campaign_id: recipient.campaign_id,
        place_id: recipient.place_id,
      },
      { onConflict: "phone", ignoreDuplicates: true },
    );

    // The ramp counts from this number's first ever send.
    if (!agent.sender_first_sent_on) {
      await admin
        .from("re_outreach_agents")
        .update({
          sender_first_sent_on: zonedClock(now, OUTREACH_TIMEZONE).ymd,
          sender_phone: String(body.senderPhone ?? "") || undefined,
        })
        .eq("id", agent.id);
    }
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`

Expected: no new errors.

- [ ] **Step 4: Verify the concurrency guarantee by hand**

This is the one thing with no automated test, so it does not get skipped. With the migration applied and a draft campaign holding at least two queued recipients, set it `running` and fire two `/next` calls at once:

```bash
TOKEN=<minted agent token>
URL=http://localhost:3000/api/admin/revenue/outreach/next
for i in 1 2; do
  curl -s -X POST "$URL" -H "x-ozzo-agent-token: $TOKEN" \
    -H 'content-type: application/json' \
    -d '{"senderPhone":"919999999999"}' &
done; wait
```

Expected: two responses with **different** `recipientId` values, or one `send` and one `wait`. Two identical `recipientId`s means `for update skip locked` is not doing its job — stop and fix the RPC before going further, because the symptom in production is a prospect messaged twice.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/revenue/outreach/next/route.ts src/app/api/admin/revenue/outreach/result/route.ts
git commit -m "Let only the server decide that a message goes out

/next re-checks suppression at claim time rather than trusting the list the
campaign was built from, so a number suppressed an hour ago is spared. The
dead-man switch is counted in /result, not in the extension, because the
extension must not be the component holding the brakes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Portal page

**Files:**
- Create: `src/app/(superadmin)/admin/revenue/outreach/page.tsx`
- Create: `src/app/(superadmin)/admin/revenue/outreach/outreach-client.tsx`

**Interfaces:**
- Consumes: the Task 6 route.
- Produces: the founder-facing UI. No exports used elsewhere.

- [ ] **Step 1: Write the page shell**

Create `src/app/(superadmin)/admin/revenue/outreach/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import OutreachClient from "./outreach-client";

// Founder-only, like Lead Discovery next door: no plan gating, no rights
// registry, no mobile. The API route guards itself the same way, so this 404
// is defence in depth rather than the only lock.
export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  try {
    await requireFounder();
  } catch {
    notFound();
  }
  return <OutreachClient />;
}
```

- [ ] **Step 2: Write the client**

Create `src/app/(superadmin)/admin/revenue/outreach/outreach-client.tsx`. Follow the structure of `discover-client.tsx` next door for data fetching and layout. It must contain, and nothing more:

1. **Extension status** — from `GET`'s `agents`: label, `sender_phone`, "last spoke N seconds ago" from `last_seen_at`, a **Mint token** button that shows the returned token once in a copyable field with the words "This is the only time you will see this", and a **Revoke** button per agent.
2. **New campaign** — multi-select for state / district / industry (reuse `listStates` and `listDistricts` from `@/lib/revenue/discovery-geography`), a **Preview** button calling `action: "preview"` that renders the funnel as `"1,240 matched · 180 already messaged · 12 suppressed · 1,048 to send"`, two to four variant textareas showing `{name}`, `{city}` and `{industry}` as available fields, a daily-cap number input defaulting to 80, and **Create**.
3. **Test send** — a field for up to three numbers, calling `action: "testSend"`, with the text "These go through the same path as a real send, but skip the cap and the window."
4. **Progress** — the active campaign's status counts, its `paused_reason` when present, the last ten results, and Start / Pause / Stop buttons calling `action: "state"`. Poll `GET` every 15 seconds while a campaign is `running`.
5. **Do-not-contact** — a textarea for pasting numbers, calling `action: "suppress"`, labelled "Anyone who replied STOP. Nothing reads replies automatically, so this is the only way they get removed."
6. **A standing note** that WhatsApp Web must stay open in another tab, and that closing this page does not stop the campaign.

Use the repo's existing components: `Button`, `Input`, `Textarea`, `Card` from `@/components/ui`, and `DropdownMenu` from `@base-ui/react` wrappers — **remember `DropdownMenuLabel` outside a `Group` throws and kills the page.** Do not introduce a charting library.

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`, then open `/admin/revenue/outreach` as the founder.

Check: the page renders; Preview returns a funnel; Mint token shows a token once; a non-founder gets a 404.

- [ ] **Step 4: Check it at phone width**

Run: `npm run test:responsive:laptop` if a spec covers this route; otherwise resize the browser to 375px and confirm no horizontal scroll. The repo's responsive suite is Chrome-only and must be run against a production build, not the dev server — see `playwright.chrome.config.ts`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(superadmin)/admin/revenue/outreach"
git commit -m "Add the outreach campaign builder and progress page

The do-not-contact box is labelled with what it is for, because nothing
reads replies in V1 and pasting numbers in by hand is the only way anyone
gets removed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: The Chrome extension

**Files:**
- Create: `extension/ozzo-sender/manifest.json`
- Create: `extension/ozzo-sender/vendor/wppconnect-wa.js`
- Create: `extension/ozzo-sender/content-whatsapp.js`
- Create: `extension/ozzo-sender/background.js`
- Create: `extension/ozzo-sender/options.html`
- Create: `extension/ozzo-sender/options.js`
- Create: `extension/ozzo-sender/README.md`
- Modify: `tsconfig.json` — add `"extension"` to `exclude`

**Interfaces:**
- Consumes: `POST /api/admin/revenue/outreach/next` and `/result`, with the `x-ozzo-agent-token` header.
- Produces: nothing other code imports.

- [ ] **Step 1: Exclude the extension from the Next build**

Add `"extension"` to the `exclude` array in `tsconfig.json`. Without this, `npm run typecheck` tries to compile extension globals (`chrome.*`) that have no types installed, and a Vercel build fails on code that never ships to the server.

Run: `npm run typecheck`

Expected: no errors mentioning `extension/`.

- [ ] **Step 2: Vendor WA-JS**

Download the pinned release and commit it:

```bash
mkdir -p extension/ozzo-sender/vendor
curl -L -o extension/ozzo-sender/vendor/wppconnect-wa.js \
  https://cdn.jsdelivr.net/npm/@wppconnect/wa-js@4.6.0/dist/wppconnect-wa.js
```

Confirm it is a real bundle, not an error page: `head -c 200 extension/ozzo-sender/vendor/wppconnect-wa.js` should show minified JavaScript, and the file should be over 1 MB.

It is vendored rather than loaded from a CDN on purpose: an upstream publish must not be able to change what runs against the founder's business WhatsApp number without a commit here.

- [ ] **Step 3: Write the manifest**

Create `extension/ozzo-sender/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "OZZO Sender",
  "version": "1.0.0",
  "description": "Sends one OZZO outreach message at a time through WhatsApp Web. Founder-only.",
  "permissions": ["storage", "alarms"],
  "host_permissions": [
    "https://web.whatsapp.com/*",
    "https://app.ozzo.co.in/*",
    "http://localhost:3000/*"
  ],
  "background": { "service_worker": "background.js" },
  "options_page": "options.html",
  "content_scripts": [
    {
      "matches": ["https://web.whatsapp.com/*"],
      "js": ["content-whatsapp.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["vendor/wppconnect-wa.js"],
      "matches": ["https://web.whatsapp.com/*"]
    }
  ]
}
```

- [ ] **Step 4: Write the WhatsApp content script**

Create `extension/ozzo-sender/content-whatsapp.js`:

```js
// Injects WA-JS into the page and sends exactly what the server tells it to.
//
// WHY WA-JS AND NOT TYPING INTO THE BOX
//
// Finding the message box in the DOM and simulating keystrokes is how most of
// these tools work, and it is why most of them are dangerous: the selectors
// break on every WhatsApp redesign, and the failure mode is not an error, it
// is the right text in the wrong chat. WA-JS calls WhatsApp's own internal
// send functions instead.
//
// This script decides nothing. It does not know the cap, the window, the gap
// or the template.

const BUNDLE_URL = chrome.runtime.getURL("vendor/wppconnect-wa.js");

// MAIN world: WA-JS has to reach WhatsApp's own modules, which an isolated
// content-script world cannot see.
function injectBundle() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = BUNDLE_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("WA-JS failed to load"));
    (document.head || document.documentElement).appendChild(script);
  });
}

// The page and this script cannot share objects, so everything goes through
// window.postMessage with a page-side shim injected as source text.
const PAGE_SHIM = `
(() => {
  const ready = () => window.WPP && window.WPP.isReady;

  window.addEventListener("message", async (event) => {
    const msg = event.data;
    if (!msg || msg.__ozzo !== "request") return;

    const reply = (payload) =>
      window.postMessage({ __ozzo: "response", id: msg.id, ...payload }, "*");

    try {
      if (!ready()) return reply({ outcome: "logged_out" });

      if (msg.op === "whoami") {
        const me = window.WPP.whatsapp.UserPrefs.getMaybeMeUser();
        return reply({ phone: me ? me.user : "" });
      }

      if (msg.op === "send") {
        const exists = await window.WPP.contact.queryWidExists(msg.phone);
        if (!exists || !exists.wid) return reply({ outcome: "skipped_not_on_whatsapp" });

        if (await window.WPP.blocklist.isBlocked(exists.wid)) {
          return reply({ outcome: "skipped_blocked" });
        }

        if (msg.attachmentUrl) {
          const blob = await fetch(msg.attachmentUrl).then((r) => r.blob());
          await window.WPP.chat.sendFileMessage(exists.wid, blob, {
            type: "document",
            caption: msg.text,
            createChat: true,
          });
        } else {
          await window.WPP.chat.sendTextMessage(exists.wid, msg.text, {
            createChat: true,
          });
        }
        return reply({ outcome: "sent" });
      }

      reply({ outcome: "failed", error: "Unknown op" });
    } catch (error) {
      reply({ outcome: "failed", error: String(error && error.message || error) });
    }
  });
})();
`;

function injectShim() {
  const script = document.createElement("script");
  script.textContent = PAGE_SHIM;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

let nextId = 1;
function askPage(op, payload) {
  return new Promise((resolve) => {
    const id = nextId++;
    const onMessage = (event) => {
      const msg = event.data;
      if (!msg || msg.__ozzo !== "response" || msg.id !== id) return;
      window.removeEventListener("message", onMessage);
      resolve(msg);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ __ozzo: "request", id, op, ...payload }, "*");
    // A send that never answers must not hang the loop for ever.
    setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve({ outcome: "failed", error: "WhatsApp Web did not answer" });
    }, 60_000);
  });
}

chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  askPage(request.op, request).then(respond);
  return true; // keep the channel open for the async reply
});

(async () => {
  try {
    await injectBundle();
    injectShim();
  } catch (error) {
    console.error("[OZZO Sender]", error);
  }
})();
```

- [ ] **Step 5: Write the background loop**

Create `extension/ozzo-sender/background.js`:

```js
// The loop: ask, send, report, sleep as long as you were told.
//
// It holds the token and nothing else. Every number in this file came from the
// server's answer, not from here.

const ALARM = "ozzo-tick";

async function config() {
  const { token, baseUrl } = await chrome.storage.local.get(["token", "baseUrl"]);
  return { token, baseUrl: baseUrl || "https://app.ozzo.co.in" };
}

async function whatsappTab() {
  const tabs = await chrome.tabs.query({ url: "https://web.whatsapp.com/*" });
  return tabs[0] || null;
}

async function ask(tab, op, payload = {}) {
  return chrome.tabs.sendMessage(tab.id, { op, ...payload });
}

async function post(path, body) {
  const { token, baseUrl } = await config();
  if (!token) throw new Error("No agent token set");
  const response = await fetch(`${baseUrl}/api/admin/revenue/outreach/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ozzo-agent-token": token },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function sleep(seconds) {
  // chrome.alarms is the only timer that survives the service worker being
  // evicted, which Chrome does within seconds of idle. A setTimeout here would
  // silently never fire and the campaign would stop with no error anywhere.
  chrome.alarms.create(ALARM, { delayInMinutes: Math.max(seconds, 1) / 60 });
}

async function tick() {
  const tab = await whatsappTab();
  if (!tab) {
    sleep(60);
    return;
  }

  const me = await ask(tab, "whoami");
  if (!me || !me.phone) {
    sleep(60);
    return;
  }

  const decision = await post("next", { senderPhone: me.phone });

  if (decision.kind === "wait") {
    sleep(decision.waitSeconds);
    return;
  }
  if (decision.kind !== "send") {
    // paused or done: stop asking until the founder restarts it.
    return;
  }

  const result = await ask(tab, "send", {
    phone: decision.phone,
    text: decision.text,
    attachmentUrl: decision.attachmentUrl,
  });

  await post("result", {
    recipientId: decision.recipientId,
    outcome: result.outcome,
    error: result.error,
    senderPhone: me.phone,
  });

  // Ask again straight away — the server decides the gap, not this file.
  sleep(1);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) tick().catch((error) => console.error("[OZZO]", error));
});

chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  if (request.op === "start") {
    tick().then(() => respond({ ok: true })).catch((e) => respond({ error: String(e) }));
    return true;
  }
  if (request.op === "stop") {
    chrome.alarms.clear(ALARM).then(() => respond({ ok: true }));
    return true;
  }
});
```

- [ ] **Step 6: Write the options page**

Create `extension/ozzo-sender/options.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OZZO Sender</title>
    <style>
      body { font: 14px system-ui; max-width: 36rem; margin: 2rem auto; padding: 0 1rem; }
      label { display: block; margin: 1rem 0 0.25rem; font-weight: 600; }
      input { width: 100%; padding: 0.5rem; }
      button { margin-top: 1rem; padding: 0.5rem 1rem; }
      p { color: #555; }
    </style>
  </head>
  <body>
    <h1>OZZO Sender</h1>
    <p>
      Paste the agent token from
      <strong>/admin/revenue/outreach</strong>. Keep WhatsApp Web open in
      another tab while a campaign is running.
    </p>
    <label for="token">Agent token</label>
    <input id="token" type="password" autocomplete="off" />
    <label for="baseUrl">Portal URL</label>
    <input id="baseUrl" type="text" placeholder="https://app.ozzo.co.in" />
    <button id="save">Save</button>
    <button id="start">Start sending</button>
    <button id="stop">Stop</button>
    <p id="status"></p>
    <script src="options.js"></script>
  </body>
</html>
```

Create `extension/ozzo-sender/options.js`:

```js
const $ = (id) => document.getElementById(id);

chrome.storage.local.get(["token", "baseUrl"]).then(({ token, baseUrl }) => {
  if (token) $("token").value = token;
  $("baseUrl").value = baseUrl || "https://app.ozzo.co.in";
});

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    token: $("token").value.trim(),
    baseUrl: $("baseUrl").value.trim() || "https://app.ozzo.co.in",
  });
  $("status").textContent = "Saved.";
});

$("start").addEventListener("click", async () => {
  const reply = await chrome.runtime.sendMessage({ op: "start" });
  $("status").textContent = reply?.error ? `Error: ${reply.error}` : "Sending.";
});

$("stop").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ op: "stop" });
  $("status").textContent = "Stopped.";
});
```

- [ ] **Step 7: Write the README**

Create `extension/ozzo-sender/README.md` covering: that it is founder-only and never published to the Chrome Web Store; how to load it (`chrome://extensions` → Developer mode → Load unpacked → this folder); that WhatsApp Web must stay open; that the WA-JS bundle is pinned at 4.6.0 and `queryExists` is deprecated with removal on 27/10/2026 so `queryWidExists` is what we call; and that bulk unsolicited messaging breaks WhatsApp's Terms, with the risk sitting on whichever number Chrome is logged in as.

- [ ] **Step 8: Load it and test against numbers the founder owns**

In order, stopping at the first thing that misbehaves:

1. Load unpacked. Open the options page, paste a minted token, set the portal URL to `http://localhost:3000`, Save.
2. Open WhatsApp Web and sign in. Confirm the console shows no `[OZZO Sender]` error.
3. Create a campaign in the portal, then **Test send** to one number the founder owns. Press Start.
4. Expected: that number receives the message within a minute, with merge fields filled and the opt-out line at the bottom. The portal shows it as `sent`.
5. Test send to a landline. Expected: `skipped_not_on_whatsapp`, and no message attempted.
6. Sign out of WhatsApp Web mid-campaign. Expected: the campaign pauses with "WhatsApp Web is not logged in", and the recipient goes back to `queued`, not `failed`.

**Do not point this at real prospects in this task.** First real campaign is the founder's call, deliberately small, and his business number is what is at stake.

- [ ] **Step 9: Commit**

```bash
git add extension tsconfig.json
git commit -m "Add the Chrome extension that does the sending

Vendored WA-JS rather than a CDN load: an upstream publish must not be
able to change what runs against the business WhatsApp number without a
commit here. The loop sleeps on chrome.alarms, not setTimeout, because
Chrome evicts an idle service worker within seconds and a setTimeout would
silently never fire — the campaign would stop with no error anywhere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-review notes

Checked against the spec. Four things worth flagging to whoever executes this, two of which are defects this review caught and fixed:

1. **`failure_streak_reset_at` is not in the spec — it was added here.** The spec's dead-man switch counts consecutive `failed` recipients, but those rows survive the pause, so recounting them re-pauses the campaign the instant the founder presses Start. The column is stamped on resume and the count is scoped to after it. Without this the switch is a one-way door.
2. **Declaration order in the migration is load-bearing.** `re_outreach_recipients.claimed_by` references `re_outreach_agents`, so agents is declared second, not fourth as the spec's §Database section lists it. The spec lists tables by importance; Postgres needs them by dependency.
3. **The spec's §Flow step 5 says test sends "do not touch `re_outreach_sent_phones`"** — enforced in `/result` by the `!recipient.is_test` guard, and in `/next` by skipping the suppression and already-sent checks for test rows.
4. **Test rows bypass the cap only because `readCounters` filters `is_test: false` for `sentToday`.** They still obey the gap and the window, because they come through `/next` like everything else. Remove that filter and test sends start eating the founder's daily allowance.

Spec requirements with no task: none. Everything in §"Not in V1" stays out.

---

## Execution Handoff

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task, reviewed between tasks, fast iteration.

**2. Inline Execution** — tasks executed in this session with checkpoints for review.
