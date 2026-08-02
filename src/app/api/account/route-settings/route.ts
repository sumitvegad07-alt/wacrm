// ============================================================
// /api/account/route-settings
//
//   GET   — Returns route behavior settings for the caller's account.
//           Any authenticated member.
//   PATCH — Updates route behavior settings. Admin+ only.
//
// Behavior config only (skip / reason / sequence / capacity / approval).
// Access control for route ACTIONS lives in the granular permission keys, not here.
// Stored under accounts.settings.route_settings (jsonb). Mirrors the module-settings
// route: server-side + admin-gated, so the UI never writes the table directly.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

type Enforcement = "warn" | "block";
type ApprovalMode = "none" | "manager" | "admin";

export interface RouteSettings {
  execution: {
    skip_allowed: boolean;
    skip_reason_mandatory: boolean;
    out_of_sequence_allowed: boolean;
    allow_complete_with_pending: boolean;
  };
  capacity: { max_customers: number; enforcement: Enforcement };
  validation: { warn_duplicate_name: boolean; warn_schedule_conflict: boolean };
  approval_mode: ApprovalMode;
}

const DEFAULTS: RouteSettings = {
  execution: {
    skip_allowed: true,
    skip_reason_mandatory: true,
    out_of_sequence_allowed: true,
    allow_complete_with_pending: false,
  },
  capacity: { max_customers: 50, enforcement: "warn" },
  validation: { warn_duplicate_name: true, warn_schedule_conflict: true },
  approval_mode: "none",
};

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Coerce arbitrary jsonb into a fully-populated, valid RouteSettings. */
function normalize(raw: unknown): RouteSettings {
  const src = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const exec = (src.execution ?? {}) as Record<string, unknown>;
  const cap = (src.capacity ?? {}) as Record<string, unknown>;
  const val = (src.validation ?? {}) as Record<string, unknown>;
  const maxRaw = Number(cap.max_customers);
  const enforcement: Enforcement = cap.enforcement === "block" ? "block" : "warn";
  const approval: ApprovalMode =
    src.approval_mode === "manager" || src.approval_mode === "admin"
      ? (src.approval_mode as ApprovalMode)
      : "none";
  return {
    execution: {
      skip_allowed: bool(exec.skip_allowed, DEFAULTS.execution.skip_allowed),
      skip_reason_mandatory: bool(exec.skip_reason_mandatory, DEFAULTS.execution.skip_reason_mandatory),
      out_of_sequence_allowed: bool(exec.out_of_sequence_allowed, DEFAULTS.execution.out_of_sequence_allowed),
      allow_complete_with_pending: bool(
        exec.allow_complete_with_pending,
        DEFAULTS.execution.allow_complete_with_pending
      ),
    },
    capacity: {
      max_customers: Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : DEFAULTS.capacity.max_customers,
      enforcement,
    },
    validation: {
      warn_duplicate_name: bool(val.warn_duplicate_name, DEFAULTS.validation.warn_duplicate_name),
      warn_schedule_conflict: bool(val.warn_schedule_conflict, DEFAULTS.validation.warn_schedule_conflict),
    },
    approval_mode: approval,
  };
}

function getRouteSettings(settings: unknown): RouteSettings {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  return normalize(s.route_settings);
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
      console.error("[GET /api/account/route-settings] error:", error);
      return NextResponse.json({ error: "Failed to fetch route settings" }, { status: 500 });
    }
    return NextResponse.json({ route_settings: getRouteSettings(data?.settings) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`admin:route-settings:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as unknown;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Normalize the incoming payload into a valid, complete settings object.
    const next = normalize(body);

    // Merge into the account's existing settings jsonb (don't clobber sibling keys).
    const { data: existing, error: fetchErr } = await ctx.supabase
      .from("accounts")
      .select("settings")
      .eq("id", ctx.accountId)
      .maybeSingle();
    if (fetchErr) {
      console.error("[PATCH /api/account/route-settings] fetch error:", fetchErr);
      return NextResponse.json({ error: "Failed to read existing settings" }, { status: 500 });
    }
    const currentSettings =
      existing?.settings && typeof existing.settings === "object" && !Array.isArray(existing.settings)
        ? (existing.settings as Record<string, unknown>)
        : {};
    const mergedSettings = { ...currentSettings, route_settings: next };

    const { data, error } = await ctx.supabase
      .from("accounts")
      .update({ settings: mergedSettings })
      .eq("id", ctx.accountId)
      .select("settings")
      .single();
    if (error) {
      console.error("[PATCH /api/account/route-settings] update error:", error);
      return NextResponse.json({ error: "Failed to update route settings" }, { status: 500 });
    }
    return NextResponse.json({ route_settings: getRouteSettings(data?.settings) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
