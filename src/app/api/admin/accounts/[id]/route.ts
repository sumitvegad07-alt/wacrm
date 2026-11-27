import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperadmin, serviceClient } from "@/lib/auth/superadmin";
import { recordAdminAccess } from "@/lib/admin/audit";
import {
  BillingValidationError,
  validateBillingChange,
  type AccountBillingState,
} from "@/lib/admin/billing";
import { ADDON_LINES } from "@/lib/plans/catalog";
import {
  isCustomFeatureKey,
  isGrantableCustomFeature,
} from "@/lib/plans/custom-features";
import { isUndefinedColumn } from "@/lib/auth/account-select";

/**
 * Billing and module changes for one tenant.
 *
 * Replaces hand-editing `accounts` in Supabase for plan changes, seat
 * adjustments, trial extensions and module toggles. Validation lives in
 * lib/admin/billing.ts; this route owns auth, persistence and audit.
 */
/**
 * One tenant's account row, for the superadmin company screen.
 *
 * The screen used to read `accounts` straight from the browser, which worked
 * only because `accounts_select` carried an `OR is_superadmin()` branch — and
 * that branch fired inside the ordinary tenant area too. See migration
 * 20261017120000.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperadmin();
    const { id } = await params;

    const { data, error } = await serviceClient()
      .from("accounts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Deliberately the route's existing guard: subscription_plan, an equally
    // commercial field, is governed by requireSuperadmin, and superadmin is
    // itself granted only by the founder.
    const ctx = await requireSuperadmin();
    const admin = serviceClient();
    const { id } = await params;

    const { data: current, error: readErr } = await admin
      .from("accounts")
      .select(
        "id, name, subscription_plan, subscription_status, subscription_expires_at, user_count, module_settings, addon_lines, portal_seats_limit",
      )
      .eq("id", id)
      .single();

    if (readErr || !current) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Real profile count, so a seat reduction cannot strand existing users.
    const { count: activeUsers } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("account_id", id);

    const body = await req.json();

    let patch;
    try {
      patch = validateBillingChange(
        current as AccountBillingState,
        body,
        activeUsers ?? 0,
      );
    } catch (e) {
      if (e instanceof BillingValidationError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    // DMS add-on and portal login allowance. Granted here and nowhere else; the
    // database trigger on `accounts` refuses these columns from any writer that
    // is not the service role or a superadmin, and `admin` above is the service
    // role. Only genuine changes go into the patch, so an unchanged save still
    // reads "No changes to save" and the audit log holds real before/after.
    const cur = current as unknown as {
      addon_lines: string[] | null;
      portal_seats_limit: number | null;
    };
    const curLines = cur.addon_lines ?? [];

    // custom_features is read in a SEPARATE query, on purpose. Adding it to the
    // select above would break this whole route — every plan change, seat change
    // and module toggle for every tenant, answering "Account not found" — on any
    // database where migration 20261127120000 has not been pasted yet. The
    // column arrives when the founder runs the SQL, which is after this deploy.
    const { data: cfRow, error: cfErr } = await admin
      .from("accounts")
      .select("custom_features")
      .eq("id", id)
      .maybeSingle();
    const customColumnExists = !isUndefinedColumn(cfErr);
    const curCustom: string[] = customColumnExists
      ? ((cfRow as { custom_features?: string[] | null } | null)?.custom_features ?? [])
      : [];

    if (body.addonLines !== undefined) {
      if (
        !Array.isArray(body.addonLines) ||
        body.addonLines.some((l: unknown) => typeof l !== "string")
      ) {
        return NextResponse.json({ error: "addonLines must be a list of add-on names" }, { status: 400 });
      }
      const unknown = (body.addonLines as string[]).filter(
        (l) => !(ADDON_LINES as readonly string[]).includes(l),
      );
      if (unknown.length) {
        return NextResponse.json({ error: `Unknown add-on: ${unknown.join(", ")}` }, { status: 400 });
      }
    }
    // Per-client switches. Validated against the CODE catalogue, not against
    // whatever the browser sent: a key with nothing behind it would sit in the
    // column looking granted and do nothing, and the client would be told their
    // feature is on. A retired key may stay on an account that already holds it
    // (removing it is a decision, not a side effect of a save) but may not be
    // handed to anybody new.
    let newCustom: string[] | undefined;
    if (body.customFeatures !== undefined) {
      if (
        !Array.isArray(body.customFeatures) ||
        body.customFeatures.some((k: unknown) => typeof k !== "string")
      ) {
        return NextResponse.json(
          { error: "customFeatures must be a list of feature keys" },
          { status: 400 },
        );
      }
      const asked = Array.from(new Set(body.customFeatures as string[]));
      // The screen sends the list on every save, so an empty list on a database
      // without the column is simply "nothing to do" — only an actual grant has
      // to stop and say why.
      if (!customColumnExists && asked.length > 0) {
        return NextResponse.json(
          {
            error:
              "Custom features are not set up in the database yet. Paste RUN-THIS-IN-SUPABASE-custom-features.sql into the Supabase SQL Editor and run it, then try again.",
          },
          { status: 400 },
        );
      }
      const unknownKeys = asked.filter((k) => !isCustomFeatureKey(k));
      if (unknownKeys.length) {
        return NextResponse.json(
          { error: `Unknown custom feature: ${unknownKeys.join(", ")}` },
          { status: 400 },
        );
      }
      const newlyRetired = asked.filter(
        (k) => !isGrantableCustomFeature(k) && !curCustom.includes(k),
      );
      if (newlyRetired.length) {
        return NextResponse.json(
          {
            error: `${newlyRetired.join(", ")} is retired and cannot be granted to a new account. It became a standard setting — switch that on instead.`,
          },
          { status: 400 },
        );
      }
      newCustom = asked.sort();
    }

    if (body.portalSeatsLimit !== undefined) {
      if (
        typeof body.portalSeatsLimit !== "number" ||
        !Number.isInteger(body.portalSeatsLimit) ||
        body.portalSeatsLimit < 0
      ) {
        return NextResponse.json({ error: "Portal logins must be a whole number, zero or more" }, { status: 400 });
      }
    }

    const newLines: string[] | undefined = body.addonLines
      ? Array.from(new Set(body.addonLines as string[])).sort()
      : undefined;
    const linesChanged =
      newLines !== undefined &&
      JSON.stringify(newLines) !== JSON.stringify([...curLines].sort());
    const removing = curLines.filter((l) => !(newLines ?? curLines).includes(l));
    const seatsChanged =
      body.portalSeatsLimit !== undefined &&
      body.portalSeatsLimit !== (cur.portal_seats_limit ?? 0);

    if (linesChanged || seatsChanged) {
      // Logins in use. Read through the SERVICE-ROLE client (`admin`): this
      // route is the only thing entitled to read another tenant's count.
      const { data: seatRow, error: seatErr } = await admin.rpc("portal_seats_used", {
        p_account_id: id,
      });
      if (seatErr) {
        return NextResponse.json({ error: seatErr.message }, { status: 400 });
      }
      const seatsUsed = Number(seatRow ?? 0);

      if (seatsChanged && body.portalSeatsLimit < seatsUsed) {
        return NextResponse.json(
          {
            error: `${seatsUsed} portal logins are already in use. Remove access from some customers before lowering the allowance to ${body.portalSeatsLimit}.`,
          },
          { status: 400 },
        );
      }

      // Removing the add-on stops every portal login at once (account_has_line
      // goes false). Nothing is deleted, but the person must be told first.
      if (removing.length > 0 && seatsUsed > 0 && body.confirmRevokeLogins !== true) {
        return NextResponse.json(
          {
            code: "confirm_revoke_logins",
            seatsUsed,
            error: `This account has ${seatsUsed} portal logins in use. Removing the DMS will stop all of them signing in. Nothing is deleted. Send confirmRevokeLogins to continue.`,
          },
          { status: 409 },
        );
      }
    }

    if (linesChanged) patch.addon_lines = newLines;
    if (seatsChanged) patch.portal_seats_limit = body.portalSeatsLimit;

    // Only a real change goes in, so an unchanged save still reads "No changes
    // to save" and the audit log records a grant as a grant.
    if (
      newCustom !== undefined &&
      JSON.stringify(newCustom) !== JSON.stringify([...curCustom].sort())
    ) {
      patch.custom_features = newCustom;
    }

    // Taking the DMS away takes its allowance with it, however the route is
    // called: an account with no add-on but spare logins is a configuration
    // that must not exist. Fires only when this patch leaves the account with
    // no add-on AND it had one before; the audit log picks the column up from
    // the patch like any other change. An explicit seat value in the same
    // request is overridden on purpose (no add-on means no allowance).
    if (
      linesChanged &&
      curLines.length > 0 &&
      (newLines ?? []).length === 0 &&
      (cur.portal_seats_limit ?? 0) !== 0
    ) {
      patch.portal_seats_limit = 0;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, changed: {} });
    }

    const { error: writeErr } = await admin
      .from("accounts")
      .update(patch)
      .eq("id", id);

    if (writeErr) {
      return NextResponse.json({ error: writeErr.message }, { status: 400 });
    }

    // Record before and after for each changed field: "plan changed" is much
    // less useful six months later than "Basic -> Enterprise".
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      before[key] = (current as Record<string, unknown>)[key];
    }

    await recordAdminAccess(admin, ctx, {
      action: "update_account_billing",
      table: "accounts",
      targetAccountId: id,
      filters: { before, after: patch },
      rowCount: 1,
    });

    return NextResponse.json({ ok: true, changed: patch });
  } catch (err) {
    return toErrorResponse(err);
  }
}
