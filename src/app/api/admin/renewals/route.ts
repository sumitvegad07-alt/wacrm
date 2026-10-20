// ============================================================
// The renewal register: list + create. Founder-only.
//
// requireFounder() on the caller's own session, then the service-role client —
// platform_subscriptions has RLS with no policies.
//
// The response carries `today` (the IST date the server used) and the bucket
// summary computed with it, so the browser never decides what "today" means. A
// founder opening this at 23:50 IST and a cron reading it at 00:10 UTC must see
// the same answer.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { asTerm, type BillingTerm } from "@/lib/plans/pricing";
import { todayInIndia } from "@/lib/proposals/today";
import { bucketSummary, inBucket } from "@/lib/renewals/buckets";
import { periodEnd } from "@/lib/renewals/next-period";
import {
  BUCKETS,
  RENEWAL_STATUSES,
  type RenewalBucket,
  type SubscriptionRow,
} from "@/lib/renewals/types";

const COLUMNS =
  "id, customer_id, company_name, plan, billing_term, users, amount, start_date, " +
  "end_date, salesman_name, contact_person, phone, status, remarks, follow_up_date, " +
  "created_at, updated_at";

/** Only these may be written. Anything else in the body is ignored, not trusted. */
export const WRITABLE_FIELDS = [
  "customer_id", "company_name", "plan", "billing_term", "users", "amount",
  "start_date", "end_date", "salesman_name", "contact_person", "phone",
  "status", "remarks", "follow_up_date",
] as const;

const TEXT_FIELDS = new Set<string>([
  "customer_id", "company_name", "plan", "salesman_name", "contact_person",
  "phone", "remarks",
]);

/**
 * The body, narrowed to writable columns with the right types.
 *
 * Exported because the create and update routes must clean identically: a
 * second copy of this would be how `follow_up_date` ends up stored as "" on one
 * path and null on the other, and an empty string is not a valid `date`.
 */
export function cleanBody(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const key of WRITABLE_FIELDS) {
    if (body?.[key] === undefined) continue;
    const value = body[key];

    if (TEXT_FIELDS.has(key)) {
      patch[key] = typeof value === "string" ? value.trim() : "";
      continue;
    }

    if (key === "users") {
      patch[key] = Math.max(0, Math.floor(Number(value) || 0));
      continue;
    }

    if (key === "amount") {
      patch[key] = Math.max(0, Math.round(Number(value) || 0));
      continue;
    }

    if (key === "billing_term") {
      patch[key] = value ? asTerm(value) : null;
      continue;
    }

    if (key === "status") {
      patch[key] = (RENEWAL_STATUSES as readonly string[]).includes(String(value))
        ? value
        : "active";
      continue;
    }

    // The three date columns. An empty string is not a valid `date`, so a blank
    // follow-up date must be stored as NULL.
    patch[key] = typeof value === "string" && value.length === 10 ? value : null;
  }

  return patch;
}

function isBucket(value: unknown): value is RenewalBucket {
  return typeof value === "string" && (BUCKETS as readonly string[]).includes(value);
}

export async function GET(req: NextRequest) {
  try {
    await requireFounder();

    const { data, error } = await serviceClient()
      .from("platform_subscriptions")
      .select(COLUMNS)
      .order("end_date", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // Cast through `unknown`: `COLUMNS` is a concatenated string, so the
    // supabase-js type parser cannot read it as a column list and infers
    // GenericStringError[] instead. The shape is pinned by SubscriptionRow and
    // by COLUMNS listing exactly its fields.
    const rows = (data ?? []) as unknown as SubscriptionRow[];
    const today = todayInIndia();

    const requested = req.nextUrl.searchParams.get("bucket");
    const bucket: RenewalBucket = isBucket(requested) ? requested : "all";

    return NextResponse.json({
      today,
      bucket,
      // Summary is always over EVERY row, so the tiles keep their meaning while
      // a tab narrows the table beneath them.
      summary: bucketSummary(rows, today),
      subscriptions: rows.filter((row) => inBucket(row, bucket, today)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireFounder();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch = cleanBody(body);

    if (!patch.company_name) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }
    if (!patch.start_date) {
      return NextResponse.json({ error: "Start date is required" }, { status: 400 });
    }

    // A missing end date is filled from the term rather than refused: the form
    // computes it, and a direct POST without one still has one right answer.
    if (!patch.end_date) {
      patch.end_date = periodEnd(
        String(patch.start_date),
        (patch.billing_term as BillingTerm | null) ?? null,
      );
    }

    if (!patch.end_date) {
      return NextResponse.json({ error: "End date is required" }, { status: 400 });
    }
    if (String(patch.end_date) < String(patch.start_date)) {
      return NextResponse.json(
        { error: "The subscription cannot end before it starts." },
        { status: 400 },
      );
    }

    const { data, error } = await serviceClient()
      .from("platform_subscriptions")
      .insert({ ...patch, created_by: ctx.userId })
      .select("id")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ id: data.id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
