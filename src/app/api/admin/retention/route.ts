// ============================================================
// Retention job — founder-triggered. Preview by default.
//
// Same rule as every other /api/admin route: authorise on the caller's own
// session first, only then touch the service-role client.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { runRetention } from "@/lib/retention/run";

export async function GET() {
  try {
    await requireFounder();
    const admin = serviceClient();

    const { data, error } = await admin
      .from("retention_runs")
      .select("id, started_at, finished_at, mode, summarised_days, rows_affected, detail, error")
      .order("started_at", { ascending: false })
      .limit(20);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ runs: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireFounder();
    const body = await req.json().catch(() => ({}));

    // Deleting for real has to be asked for explicitly. A missing or malformed
    // body previews; it never destroys anything.
    const dryRun = body?.dryRun !== false;

    const admin = serviceClient();
    const result = await runRetention(admin, { dryRun });

    await admin.from("retention_runs").insert({
      finished_at: new Date().toISOString(),
      mode: result.mode,
      summarised_days: result.summarisedDays,
      rows_affected: result.rowsAffected,
      detail: result.detail,
      error: result.errors.length ? result.errors.join(" | ") : null,
    });

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
