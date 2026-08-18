import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import {
  composeDigest,
  PERIOD_HOURS,
  renderDigestText,
  type DigestPeriod,
} from "@/lib/admin/digest";
import { healthLevel, signalsFor, type TenantHealth } from "@/lib/admin/health";
import type { AuditRow } from "@/lib/admin/alerts";

/**
 * Operations digest — daily or weekly, nothing custom.
 *
 * Two callers:
 *   * a superadmin opening /admin/digest, authenticated normally
 *   * a scheduler, authenticating with x-cron-secret
 *
 * The cron path mirrors the convention the WhatsApp health check already uses
 * (see proxy.ts): a shared secret, and 503 rather than 200 when the secret is
 * not configured, so a misconfigured scheduler is loud instead of silently
 * returning an empty digest forever.
 */
export async function GET(req: NextRequest) {
  try {
    const period: DigestPeriod =
      req.nextUrl.searchParams.get("period") === "weekly" ? "weekly" : "daily";

    const cronSecret = req.headers.get("x-cron-secret");
    const isCron = cronSecret !== null;

    if (isCron) {
      const expected = process.env.CRON_SECRET;
      if (!expected) {
        return NextResponse.json(
          { error: "CRON_SECRET is not configured on the server" },
          { status: 503 },
        );
      }
      if (cronSecret !== expected) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      await requireSuperadmin();
    }

    const admin = serviceClient();
    const since = new Date(
      Date.now() - PERIOD_HOURS[period] * 3_600_000,
    ).toISOString();

    const [auditRes, newRes, deletedRes, healthRes, syncRes] = await Promise.all([
      admin
        .from("superadmin_audit_log")
        .select(
          "id, actor_user_id, actor_email, action, table_name, target_account_id, row_count, created_at",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000),
      admin
        .from("accounts")
        .select("id, name, created_at")
        .gte("created_at", since),
      admin
        .from("accounts")
        .select("id, name, deleted_at")
        .not("deleted_at", "is", null)
        .gte("deleted_at", since),
      admin.rpc("admin_tenant_health"),
      admin.rpc("admin_sync_health"),
    ]);

    const tenants = (healthRes.data ?? []) as TenantHealth[];
    const criticalTenants = tenants
      .map((t) => ({ t, signals: signalsFor(t) }))
      .filter(({ signals }) => healthLevel(signals) === "critical")
      .map(({ t, signals }) => ({
        name: t.name,
        reason: signals[0]?.message ?? "critical",
      }));

    const sync = (syncRes.data ?? []) as {
      events_stuck: number;
      events_failed: number;
    }[];

    const digest = composeDigest({
      period,
      generatedAt: new Date().toISOString(),
      auditRows: (auditRes.data ?? []) as unknown as AuditRow[],
      newTenants: newRes.data ?? [],
      deletedTenants: (deletedRes.data ?? []) as {
        id: string;
        name: string;
        deleted_at: string;
      }[],
      stuckEvents: sync.reduce((n, s) => n + Number(s.events_stuck ?? 0), 0),
      failedEvents: sync.reduce((n, s) => n + Number(s.events_failed ?? 0), 0),
      criticalTenants,
    });

    // Reading the digest is not itself audited — it reports on the trail rather
    // than reading tenant rows, and a scheduler hitting it daily would bury the
    // entries that matter.
    if (req.nextUrl.searchParams.get("format") === "text") {
      return new NextResponse(renderDigestText(digest), {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return NextResponse.json(digest);
  } catch (err) {
    return toErrorResponse(err);
  }
}
