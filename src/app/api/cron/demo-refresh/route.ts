// ============================================================
// Demo-tenant refresh — scheduled. Runs daily via Vercel Cron.
//
// The four plan-demo tenants (WFA / SFA / CRM+WFA / CRM+SFA) exist so a
// prospect can be shown a company that has been using OZZO for a year. Their
// twelve months of history never goes stale, but every headline dashboard tile
// is scoped to the local day — the live agent map, Active Field Agents, Visits
// Logged Today, Distance Tracked, Orders Today. Seeded once and left alone,
// those all read zero tomorrow.
//
// So this regenerates today for each demo tenant, and is idempotent: it clears
// whatever it wrote for today before writing it again, which makes it safe to
// run twice and safe to retry.
//
// Scheduling note. This project is on Vercel's Hobby tier, which allows two
// cron jobs at daily granularity; /api/cron/retention holds the other one. A
// once-daily run cannot follow the clock, so it writes the whole working day
// (09:30–18:30) up front. Until that window has actually passed, part of the
// day is timestamped slightly ahead of now. That is invisible on every
// dashboard tile (the "live agent" test is `minutesAgo <= 25`, which a negative
// number passes, and the count tiles have no upper bound) and shows only in
// today's GPS replay. `npx tsx scripts/seed-demo-accounts.ts --refresh-now`
// trims it back to the real clock before a meeting.
//
// The schedule is 00:30 UTC, which is 06:00 IST, and that is deliberate rather
// than arbitrary: `enforce_payment_status_transition` rejects any payment whose
// `payment_date` is after the database's CURRENT_DATE. Run at, say, 02:00 IST
// and the Indian calendar day is already ahead of the UTC one, so every payment
// written for "today" is refused. Between 05:30 and 24:00 IST the two dates
// agree.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/auth/superadmin";
import { DEMO_TENANTS, tenantByKey } from "@/lib/demo/profiles";
import { refreshTenantToday } from "@/lib/demo/refresh";

// Matches /api/cron/retention, which already runs at 300 on this project — so
// this ceiling is known to work here rather than inferred from the published
// tier limits. The actual work is ~1,500 rows and takes a few seconds.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without the secret
  // configured the route refuses rather than defaulting to open: it writes to
  // live tenants, which is not something to leave reachable by anyone.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ?only=<key> refreshes a single tenant, for debugging one in isolation.
  const only = req.nextUrl.searchParams.get("only");
  const targets = only ? [tenantByKey(only)].filter(Boolean) : DEMO_TENANTS;
  if (only && targets.length === 0) {
    return NextResponse.json(
      { error: `unknown tenant "${only}"`, valid: DEMO_TENANTS.map((t) => t.key) },
      { status: 400 },
    );
  }

  const db = serviceClient();
  const lines: string[] = [];
  const log = (msg: string) => lines.push(msg.trim());

  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  const started = Date.now();

  for (const tenant of targets as typeof DEMO_TENANTS) {
    const at = Date.now();
    try {
      const counts = await refreshTenantToday(db, tenant, {
        // null = write the whole working day. See the scheduling note above.
        cutoffMinutes: null,
        log,
      });
      results[tenant.key] = { ...counts, ms: Date.now() - at };
    } catch (err: any) {
      // One broken tenant must not stop the other three from being refreshed.
      const message = err?.message ?? String(err);
      errors.push(`${tenant.key}: ${message}`);
      results[tenant.key] = { error: message, ms: Date.now() - at };
    }
  }

  const body = {
    ok: errors.length === 0,
    refreshed: Object.keys(results),
    results,
    errors,
    ms: Date.now() - started,
    log: lines,
  };

  // A partial failure still returns 200 with `ok: false`: the cron should not
  // be retried wholesale because one tenant is unseeded, and the body says
  // exactly which one went wrong.
  return NextResponse.json(body);
}
