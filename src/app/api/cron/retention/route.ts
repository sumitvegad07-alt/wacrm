// ============================================================
// Retention job — scheduled. Runs nightly via Vercel Cron.
//
// It previews unless RETENTION_DELETE_ENABLED is explicitly "true". That is the
// two-stage safety: the schedule runs from day one and logs what it WOULD
// remove, and the founder reads a few nights of that before anything is
// actually destroyed. Deletion is irreversible; a switch that has to be thrown
// deliberately is worth the small inconvenience.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/auth/superadmin";
import { runRetention } from "@/lib/retention/run";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without the secret
  // set, the route refuses to run rather than defaulting to open — an unguarded
  // endpoint that deletes data is not something to leave to chance.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = process.env.RETENTION_DELETE_ENABLED !== "true";
  const admin = serviceClient();

  try {
    const result = await runRetention(admin, { dryRun });

    await admin.from("retention_runs").insert({
      finished_at: new Date().toISOString(),
      mode: result.mode,
      summarised_days: result.summarisedDays,
      rows_affected: result.rowsAffected,
      detail: result.detail,
      error: result.errors.length ? result.errors.join(" | ") : null,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("retention_runs").insert({
      finished_at: new Date().toISOString(),
      mode: dryRun ? "preview" : "delete",
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
