import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ForbiddenError, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serviceRoleKey } from "@/lib/supabase/service-role-key";

// Email-shaped is all that is required. The address is never delivered to:
// there is no Forgot Password in the portal, the admin resets it here. But
// Supabase validates the shape, so an admin typing "ramesh" must be told why.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Supabase's duplicate-email error is GLOBAL (auth.users is shared by all of OZZO).
const TAKEN_MESSAGE =
  "That login is already taken. Portal logins are shared across all of OZZO, so pick another address.";

// Our own unique index is per account.
const SAME_ACCOUNT_MESSAGE = "Another customer in your account already uses that login.";

export function validatePortalLogin(email: string, password: string): string | null {
  if (!EMAIL_SHAPE.test(email ?? "")) {
    return "The login must look like an email address, for example xyz@abc.com. It does not have to be a real mailbox.";
  }
  if ((password ?? "").length < 8) {
    return "The password must be at least 8 characters.";
  }
  return null;
}

export function friendlyAuthError(message: string): string {
  if (/already been registered|already exists/i.test(message)) {
    return TAKEN_MESSAGE;
  }
  return message;
}

/**
 * Our own unique index (account_id, lower(portal_email)) is a clash WITHIN the
 * admin's account. Matched by index name so an unrelated unique violation on
 * contacts is not caught. Everything else is the database's own wording,
 * passed through verbatim.
 */
export function friendlyDbError(err: { message: string; code?: string }): string {
  if (err.code === "23505" && /contacts_portal_email_idx/.test(err.message)) {
    return SAME_ACCOUNT_MESSAGE;
  }
  return err.message;
}

export type PortalGrantPlan =
  | { kind: "refuse"; error: string }
  | { kind: "restore"; password: string | null }
  | { kind: "create"; email: string; password: string };

/**
 * Pure decision: brand-new login, restore of a revoked one, or refusal.
 * Seat and add-on rules are NOT decided here: the database does that.
 */
export function planPortalGrant(
  contact: {
    portal_user_id: string | null;
    portal_access: boolean | null;
    portal_access_revoked_at: string | null;
    portal_email: string | null;
  },
  email: unknown,
  password: unknown
): PortalGrantPlan {
  const em = typeof email === "string" ? email.trim() : "";
  const pw = typeof password === "string" ? password : "";

  if (!contact.portal_user_id) {
    const invalid = validatePortalLogin(em, pw);
    return invalid ? { kind: "refuse", error: invalid } : { kind: "create", email: em, password: pw };
  }

  if (contact.portal_access === true && !contact.portal_access_revoked_at) {
    return {
      kind: "refuse",
      error: "This customer already has a portal login. Reset the password instead.",
    };
  }

  // Restore of a revoked login. The auth user already exists and owns the email.
  if (em && em.toLowerCase() !== (contact.portal_email ?? "").toLowerCase()) {
    return {
      kind: "refuse",
      error:
        "This customer's login is " +
        (contact.portal_email ?? "already set") +
        ". Changing a login address is not supported. Restore access without an email, or use the same one.",
    };
  }
  if (pw) {
    const invalid = validatePortalLogin("x@y.co", pw);
    if (invalid) return { kind: "refuse", error: invalid };
    return { kind: "restore", password: pw };
  }
  return { kind: "restore", password: null };
}

/**
 * Body for a successful restore. If the password step failed AFTER access was
 * restored, the response is still ok:true (HTTP 200) with a warning, because
 * the restore is durable. Do not turn this into a 400.
 */
export function restoreBody(portalUserId: string, passwordError: string | null) {
  return {
    ok: true as const,
    restored: true as const,
    portal_user_id: portalUserId,
    ...(passwordError
      ? {
          warning:
            "Access was restored, but the password was not changed. Try the password reset. (" +
            passwordError +
            ")",
        }
      : {}),
  };
}

// This client holds the service-role key and ignores RLS. It stays inside this
// file and is never returned, serialised or logged.
function admin() {
  if (!serviceRoleKey() || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Server is missing SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey()!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type Admin = ReturnType<typeof admin>;

interface OwnContact {
  id: string;
  account_id: string;
  portal_user_id: string | null;
  portal_access: boolean | null;
  portal_access_revoked_at: string | null;
  portal_email: string | null;
}

/**
 * The customer must belong to the caller's account. Checked server-side because
 * these requests run with the service-role key, which ignores RLS.
 */
async function loadOwnContact(sb: Admin, contactId: unknown, accountId: string) {
  if (typeof contactId !== "string" || !contactId) {
    throw new ForbiddenError("That customer is not in your account");
  }
  const { data: contact } = await sb
    .from("contacts")
    .select("id, account_id, portal_user_id, portal_access, portal_access_revoked_at, portal_email")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact || contact.account_id !== accountId) {
    throw new ForbiddenError("That customer is not in your account");
  }
  return contact as OwnContact;
}

/**
 * contacts.portal_access_set_by is a FK to profiles(id), NOT to auth.users.
 * ctx.userId is the auth user id, so translate it. Never fall back to null or
 * to the auth id.
 */
async function callerProfileId(sb: Admin, userId: string, accountId: string) {
  const { data } = await sb
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!data?.id) {
    throw new ForbiddenError("Could not identify your profile");
  }
  return data.id as string;
}

// NOTE: portal_access_set_by / portal_access_set_at mean "last changed by / at"
// (grant, restore or revoke), not only "granted by". Revocation is the event
// most likely to need an audit trail.

/** Give a customer a portal login, or restore a revoked one. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const contact_id: unknown = body?.contact_id;
    if (!contact_id) {
      return NextResponse.json({ error: "Missing contact_id" }, { status: 400 });
    }

    const ctx = await requireRole("admin");
    const sb = admin();

    const contact = await loadOwnContact(sb, contact_id, ctx.accountId);
    const plan = planPortalGrant(contact, body?.email, body?.password);
    if (plan.kind === "refuse") {
      return NextResponse.json({ error: plan.error }, { status: 400 });
    }

    // Resolved BEFORE any auth user is touched, so a failure here orphans nothing.
    const setBy = await callerProfileId(sb, ctx.userId, ctx.accountId);
    const now = new Date().toISOString();

    if (plan.kind === "restore") {
      // RESTORE. No auth user is created here, so there is deliberately no
      // deleteUser anywhere in this branch: the login already existed and a
      // refusal must leave it exactly as it was. The trigger re-checks the
      // add-on and seat cap and clears portal_access_revoked_at itself.
      const { data: restored, error: restoreError } = await sb
        .from("contacts")
        .update({ portal_access: true, portal_access_set_by: setBy, portal_access_set_at: now })
        .eq("id", contact.id)
        .eq("account_id", ctx.accountId)
        .select("id");
      if (restoreError || !restored || restored.length !== 1) {
        return NextResponse.json(
          { error: restoreError?.message ?? "Could not restore access for this customer" },
          { status: 400 }
        );
      }
      if (plan.password) {
        // After the contact update, so a refused restore never changes the password.
        const { error: pwError } = await sb.auth.admin.updateUserById(contact.portal_user_id!, {
          password: plan.password,
        });
        if (pwError) {
          // Access IS restored and persisted, so this is a 200 with a warning,
          // never a 4xx: a non-2xx must mean nothing durable changed.
          return NextResponse.json(
            restoreBody(contact.portal_user_id!, friendlyAuthError(pwError.message))
          );
        }
      }
      return NextResponse.json(restoreBody(contact.portal_user_id!, null));
    }

    // CREATE
    const { email, password } = plan;

    // `skip_account_provision` makes handle_new_user return at once: no account
    // and no profiles row. A portal customer is an auth user and nothing else.
    const { data: authData, error: authError } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // the address is fake; a confirmation mail would never arrive
      user_metadata: { skip_account_provision: "true", portal_contact_id: contact.id },
    });
    if (authError || !authData?.user) {
      return NextResponse.json(
        { error: friendlyAuthError(authError?.message ?? "Could not create the login") },
        { status: 400 }
      );
    }
    const newUserId = authData.user.id;

    // From here on the auth user WE JUST CREATED exists. EVERY exit that is not
    // success deletes newUserId (and only that id), or it keeps the
    // globally-unique email and the admin's corrected retry fails.
    try {
      // The seat cap, the add-on check and the hierarchy guard all live in
      // triggers on this UPDATE. A refusal is the database's: pass it through.
      const { data: updated, error: linkError } = await sb
        .from("contacts")
        .update({
          portal_user_id: newUserId,
          portal_email: email,
          portal_access: true,
          portal_access_set_by: setBy,
          portal_access_set_at: now,
        })
        .eq("id", contact.id)
        .eq("account_id", ctx.accountId)
        .select("id");

      if (linkError || !updated || updated.length !== 1) {
        const { error: delError } = await sb.auth.admin.deleteUser(newUserId);
        if (delError) {
          // Not durable on contacts, but the auth user is left behind: log the id (never the password).
          console.error("[portal-access] could not delete orphaned auth user", newUserId, delError.message);
        }
        return NextResponse.json(
          { error: linkError ? friendlyDbError(linkError) : "Could not give this customer access" },
          { status: 400 }
        );
      }
    } catch (e) {
      // Unexpected throw (network etc.): still clean up, then rethrow.
      await sb.auth.admin.deleteUser(newUserId).catch(() => {});
      throw e;
    }

    return NextResponse.json({ ok: true, portal_user_id: newUserId });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Reset a portal password. There is no self-service reset. */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const password: string = body?.password;
    const invalid = validatePortalLogin("x@y.co", password);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const ctx = await requireRole("admin");
    const sb = admin();

    const contact = await loadOwnContact(sb, body?.contact_id, ctx.accountId);
    if (!contact.portal_user_id) {
      return NextResponse.json({ error: "This customer has no portal login" }, { status: 400 });
    }

    const { error } = await sb.auth.admin.updateUserById(contact.portal_user_id, { password });
    if (error) {
      return NextResponse.json({ error: friendlyAuthError(error.message) }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** Withdraw access. Nothing is deleted and the seat returns to the pool. */
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireRole("admin");
    const sb = admin();

    const contact = await loadOwnContact(
      sb,
      req.nextUrl.searchParams.get("contact_id"),
      ctx.accountId
    );
    const setBy = await callerProfileId(sb, ctx.userId, ctx.accountId);
    const now = new Date().toISOString();

    // set_by / set_at mean "last changed by / at": here, who revoked and when.
    const { error } = await sb
      .from("contacts")
      .update({
        portal_access: false,
        portal_access_revoked_at: now,
        portal_access_set_by: setBy,
        portal_access_set_at: now,
      })
      .eq("id", contact.id)
      .eq("account_id", ctx.accountId);

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toErrorResponse(e);
  }
}
