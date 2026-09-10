// ============================================================
// /api/account/geofence-settings
//
//   GET   — Returns geo-fencing settings for the caller's account.
//           Any authenticated member (mobile reads this too).
//   PATCH — Updates geo-fencing settings. Admin+ only.
//
// Stored under accounts.settings.geo_fencing (jsonb). Mirrors the
// route-settings route: server-side + admin-gated, so the UI never writes the
// accounts table directly. The DB trigger enforce_site_visit_geofence() reads
// the same jsonb to block out-of-range visits at the database level.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const ALLOWED_RADII = [50, 100, 250, 500, 1000] as const;
export type GeoFenceRadius = (typeof ALLOWED_RADII)[number];

export interface GeoFencingSettings {
  enabled: boolean;
  enforce_check_in: boolean;
  enforce_check_out: boolean;
  radius_m: GeoFenceRadius;
}

const DEFAULTS: GeoFencingSettings = {
  enabled: false,
  enforce_check_in: true,
  enforce_check_out: false,
  radius_m: 50,
};

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Coerce arbitrary jsonb into a fully-populated, valid GeoFencingSettings. */
function normalize(raw: unknown): GeoFencingSettings {
  const src = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const radiusRaw = Number(src.radius_m);
  const radius: GeoFenceRadius = (ALLOWED_RADII as readonly number[]).includes(radiusRaw)
    ? (radiusRaw as GeoFenceRadius)
    : DEFAULTS.radius_m;
  return {
    enabled: bool(src.enabled, DEFAULTS.enabled),
    enforce_check_in: bool(src.enforce_check_in, DEFAULTS.enforce_check_in),
    enforce_check_out: bool(src.enforce_check_out, DEFAULTS.enforce_check_out),
    radius_m: radius,
  };
}

function getGeoFencing(settings: unknown): GeoFencingSettings {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  return normalize(s.geo_fencing);
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from("accounts")
      .select("settings")
      .eq("id", ctx.accountId)
      .maybeSingle();
    if (error) {
      console.error("[GET /api/account/geofence-settings] error:", error);
      return NextResponse.json({ error: "Failed to fetch geo-fencing settings" }, { status: 500 });
    }
    return NextResponse.json({ geo_fencing: getGeoFencing(data?.settings) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`admin:geofence-settings:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const next = normalize(body);

    // Merge into the account's existing settings jsonb (don't clobber sibling keys).
    const { data: existing, error: fetchErr } = await ctx.supabase
      .from("accounts")
      .select("settings")
      .eq("id", ctx.accountId)
      .maybeSingle();
    if (fetchErr) {
      console.error("[PATCH /api/account/geofence-settings] fetch error:", fetchErr);
      return NextResponse.json({ error: "Failed to read existing settings" }, { status: 500 });
    }
    const currentSettings =
      existing?.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
        ? (existing.settings as Record<string, unknown>)
        : {};
    const mergedSettings = { ...currentSettings, geo_fencing: next };

    const { data, error } = await ctx.supabase
      .from("accounts")
      .update({ settings: mergedSettings })
      .eq("id", ctx.accountId)
      .select("settings")
      .single();
    if (error) {
      console.error("[PATCH /api/account/geofence-settings] update error:", error);
      return NextResponse.json({ error: "Failed to update geo-fencing settings" }, { status: 500 });
    }
    return NextResponse.json({ geo_fencing: getGeoFencing(data?.settings) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
