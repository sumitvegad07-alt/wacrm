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
