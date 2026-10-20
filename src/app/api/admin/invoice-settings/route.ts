// ============================================================
// OZZO's own seller details for invoices. Founder-only.
//
// One row, keyed `id = true`. Authorise on the caller's own session with
// requireFounder(), and only then touch the service-role client —
// platform_invoice_settings has RLS with no policies, so the service role is
// the only way in.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireFounder, serviceClient } from "@/lib/auth/superadmin";
import { gstStateCodeFromGstin } from "@/lib/gst/states";

const COLUMNS =
  "firm_name, address, pincode, state, gst_state_code, gstin, pan, phone, email, " +
  "bank_name, bank_account_no, ifsc, upi_id, declaration, default_terms, " +
  "signature_url, logo_url, next_gst_seq_override, next_non_gst_seq_override";

/** Only these may be written. Anything else in the body is ignored, not trusted. */
const WRITABLE = [
  "firm_name", "address", "pincode", "state", "gst_state_code", "gstin", "pan",
  "phone", "email", "bank_name", "bank_account_no", "ifsc", "upi_id",
  "declaration", "default_terms", "signature_url", "logo_url",
] as const;

export async function GET() {
  try {
    await requireFounder();

    const { data, error } = await serviceClient()
      .from("platform_invoice_settings")
      .select(COLUMNS)
      .eq("id", true)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ settings: data ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireFounder();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    for (const key of WRITABLE) {
      const value = body?.[key];
      if (value === undefined) continue;
      patch[key] = typeof value === "string" ? value.trim() : value;
    }

    // The supplier state code is derived, never typed: it IS the GSTIN's first
    // two digits, and a hand-typed one that disagrees would flip every invoice
    // between intra- and inter-state.
    if (typeof patch.gstin === "string") {
      patch.gst_state_code = gstStateCodeFromGstin(patch.gstin) ?? "";
    }

    // Nullable integers: an empty string must become null, not 0, or the series
    // would be told to start at zero.
    for (const key of ["next_gst_seq_override", "next_non_gst_seq_override"] as const) {
      if (body?.[key] === undefined) continue;
      const n = Number(body[key]);
      patch[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { error } = await serviceClient()
      .from("platform_invoice_settings")
      .update(patch)
      .eq("id", true);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
