import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ForbiddenError, requireRole, toErrorResponse } from "@/lib/auth/account";

// Columns that decide what a profile is allowed to do. They are never accepted
// from the request body: this route runs with the service-role key, which
// ignores RLS and column grants, so anything echoed straight into the update
// would be a privilege-escalation path.
const PRIVILEGE_COLUMNS = ["is_superadmin", "account_id", "user_id", "id"] as const;

function stripPrivilegeColumns(updates: Record<string, unknown>) {
  const clean = { ...updates };
  for (const col of PRIVILEGE_COLUMNS) delete clean[col];
  return clean;
}

export async function POST(req: NextRequest) {
  try {
    const { 
      email, 
      password, 
      full_name, 
      employee_code, 
      mobile, 
      department, 
      designation, 
      employee_role_id,
      account_id,
      account_role = "agent"
    } = await req.json();

    if (!email || !password || !full_name || !account_id) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // The caller must be an admin of the account they are creating a user in.
    // Without this, an unauthenticated request could mint a login in any tenant.
    const ctx = await requireRole("admin");
    if (ctx.accountId !== account_id) {
      throw new ForbiddenError("Cannot create an employee in another account");
    }
    if (account_role === "owner") {
      throw new ForbiddenError("Ownership cannot be assigned through this route");
    }

    // Creating a login account needs the service-role key (admin API). If it's not
    // configured, fail with a clear, actionable message instead of the cryptic
    // "supabaseKey is required" that createClient throws.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json(
        { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local (Supabase → Project Settings → API → service_role key) and restart the dev server." },
        { status: 500 }
      );
    }

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Fetch the account to get user_count limit
    const { data: acct, error: acctErr } = await supabaseAdmin
      .from("accounts")
      .select("user_count")
      .eq("id", account_id)
      .single();

    if (acctErr || !acct) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    // Only enforce limit if user_count is set (not null)
    if (acct.user_count !== null) {
      const { count } = await supabaseAdmin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("account_id", account_id);
      
      if (count !== null && count >= acct.user_count) {
        return NextResponse.json(
          { error: "your user/employee limit has reached. Reach us to increase user limit." },
          { status: 403 }
        );
      }
    }

    // 1. Create the user in Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name,
      }
    });

    if (authError) {
      console.error("Auth creation error:", authError);
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const userId = authData.user.id;

    // 2. Insert into profiles table
    // (A trigger might already insert a row, so let's do an upsert)
    const { data: profileData, error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        user_id: userId,
        email,
        full_name,
        account_id,
        account_role, // 'admin', 'agent', etc.
        employee_code,
        mobile,
        department,
        designation,
        employee_role_id,
        status: 'active',
        web_access: true,
        mobile_access: true
      }, { onConflict: 'user_id' })
      .select()
      .single();

    if (profileError) {
      console.error("Profile creation error:", profileError);
      // Optional: Cleanup auth user if profile fails
      // await supabaseAdmin.auth.admin.deleteUser(userId);
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, profile: profileData });

  } catch (error: any) {
    console.error("Employee creation exception:", error);
    return toErrorResponse(error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, updates: rawUpdates } = await req.json();
    let updates: Record<string, any> = rawUpdates;

    if (!id || !updates) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // The caller must be an admin of the same account as the target profile.
    // Previously this route applied any `updates` to any `id` with no auth at
    // all, so a bare request could set is_superadmin or reset any password.
    const ctx = await requireRole("admin");

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json(
        { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." },
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: target } = await supabaseAdmin
      .from("profiles")
      .select("account_id, account_role")
      .eq("id", id)
      .single();

    if (!target || target.account_id !== ctx.accountId) {
      throw new ForbiddenError("Cannot modify a profile in another account");
    }
    if (updates.account_role === "owner" && target.account_role !== "owner") {
      throw new ForbiddenError("Ownership cannot be assigned through this route");
    }

    updates = stripPrivilegeColumns(updates);

    // If password is being updated, we need to update the Auth user
    if (updates.password) {
      // Get the auth user_id from the profile
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .eq("id", id)
        .single();
      
      if (profile?.user_id) {
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
          profile.user_id,
          { password: updates.password }
        );
        if (authError) {
          console.error("Auth password update error:", authError);
          return NextResponse.json({ error: authError.message }, { status: 400 });
        }
      }
      
      // Remove password fields so they don't try to save to the profiles table
      delete updates.password;
      delete updates.repassword;
    }

    // Using admin client to bypass RLS since users cannot update other profiles' statuses
    if (Object.keys(updates).length > 0) {
      const { data: updatedProfile, error } = await supabaseAdmin
        .from("profiles")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("Profile update error:", error);
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, profile: updatedProfile });
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Employee update exception:", error);
    return toErrorResponse(error);
  }
}
