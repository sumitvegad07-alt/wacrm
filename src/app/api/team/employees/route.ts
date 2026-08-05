import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, updates } = await req.json();

    if (!id || !updates) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

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
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
