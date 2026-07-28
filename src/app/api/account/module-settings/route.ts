// ============================================================
// /api/account/module-settings
//
//   GET   — Returns current module settings for the caller's account.
//           Any authenticated member.
//   PATCH — Updates module settings. Admin+ only.
//
// Module settings control which optional modules are visible in the
// sidebar and accessible to company members. Fixed modules are
// unaffected by this endpoint.
// ============================================================

import { NextResponse } from "next/server";
import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// The canonical set of configurable module keys.
// Adding a new key here is the only code change needed to support
// a new toggleable module.
const CONFIGURABLE_MODULES = [
  "whatsapp",
  "quotation",
  "expense",
  "dispatch",
  "pending_dispatch",
] as const;

type ModuleKey = (typeof CONFIGURABLE_MODULES)[number];

export type ModuleSettings = Record<ModuleKey, boolean>;

const DEFAULT_MODULE_SETTINGS: ModuleSettings = {
  whatsapp: true,
  quotation: true,
  expense: true,
  dispatch: true,
  pending_dispatch: true,
};

function normalizeSettings(raw: unknown): ModuleSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_MODULE_SETTINGS };
  }
  const result = { ...DEFAULT_MODULE_SETTINGS };
  for (const key of CONFIGURABLE_MODULES) {
    const val = (raw as Record<string, unknown>)[key];
    if (typeof val === "boolean") {
      result[key] = val;
    }
  }
  return result;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from("accounts")
      .select("module_settings")
      .eq("id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/account/module-settings] error:", error);
      return NextResponse.json(
        { error: "Failed to fetch module settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      module_settings: normalizeSettings(data?.module_settings),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:module-settings:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    // Only accept known configurable module keys; ignore unknowns.
    const updates: Partial<ModuleSettings> = {};
    for (const key of CONFIGURABLE_MODULES) {
      const val = body[key];
      if (typeof val === "boolean") {
        updates[key] = val;
      }
    }

    // Merge with existing settings so a partial PATCH doesn't wipe
    // keys not included in this request.
    const { data: existing, error: fetchErr } = await ctx.supabase
      .from("accounts")
      .select("module_settings")
      .eq("id", ctx.accountId)
      .maybeSingle();

    if (fetchErr) {
      console.error("[PATCH /api/account/module-settings] fetch error:", fetchErr);
      return NextResponse.json(
        { error: "Failed to read existing settings" },
        { status: 500 }
      );
    }

    const merged = {
      ...normalizeSettings(existing?.module_settings),
      ...updates,
    };

    const { data, error } = await ctx.supabase
      .from("accounts")
      .update({ module_settings: merged })
      .eq("id", ctx.accountId)
      .select("module_settings")
      .single();

    if (error) {
      console.error("[PATCH /api/account/module-settings] update error:", error);
      return NextResponse.json(
        { error: "Failed to update module settings" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      module_settings: normalizeSettings(data?.module_settings),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
