import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ForbiddenError, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serviceRoleKey } from "@/lib/supabase/service-role-key";

// Email-shaped is all that is required. The address is never delivered to:
// there is no Forgot Password in the portal, the admin resets it here. But
// Supabase validates the shape, so an admin typing "ramesh" must be told why.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TAKEN_MESSAGE =
  "That login is already taken. Portal logins are shared across all of OZZO, so pick another address.";

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
    .select("id, account_id, portal_user_id")
    .eq("id", contactId)
    .maybeSingle();
  if (!contact || contact.account_id !== accountId) {
    throw new ForbiddenError("That customer is not in your account");
  }
  return contact as { id: string; account_id: string; portal_user_id: string | null };
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

/** Give a customer a portal login. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const contact_id: unknown = body?.contact_id;
    const email: string = body?.email;
    const password: string = body?.password;
    if (!contact_id) {
      return NextResponse.json({ error: "Missing contact_id" }, { status: 400 });
    }
    const invalid = validatePortalLogin(email, password);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const ctx = await requireRole("admin");
    const sb = admin();

    const contact = await loadOwnContact(sb, contact_id, ctx.accountId);
    if (contact.portal_user_id) {
      return NextResponse.json(
        { error: "This customer already has a portal login. Reset the password instead." },
        { status: 400 }
      );
    }

    // Resolved BEFORE the auth user exists, so a failure here orphans nothing.
    const setBy = await callerProfileId(sb, ctx.userId, ctx.accountId);

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

    // From here on the auth user exists. EVERY exit that is not success must
    // delete it, or it keeps the globally-unique email and the admin's
    // corrected retry fails with "already taken".
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
          portal_access_set_at: new Date().toISOString(),
        })
        .eq("id", contact.id)
        .eq("account_id", ctx.accountId)
        .select("id");

      if (linkError || !updated || updated.length !== 1) {
        await sb.auth.admin.deleteUser(newUserId);
        const msg = linkError?.message ?? "Could not give this customer access";
        // Only the unique index on (account_id, lower(portal_email)) is not
        // already worded for an admin; everything else passes through verbatim.
        const isUniqueClash = linkError?.code === "23505";
        return NextResponse.json(
          { error: isUniqueClash ? TAKEN_MESSAGE : msg },
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
