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

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

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
