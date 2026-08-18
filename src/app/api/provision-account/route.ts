import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { SEED_COUNTRIES, SEED_INDIA_STATES, SEED_INDIA_DISTRICTS } from "@/lib/territories/seed-data.generated";
import { ForbiddenError, getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { account_id, industry } = body;

    if (!account_id || !industry) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // This route runs with the service-role key, so it must not be reachable
    // unauthenticated. The `is_provisioned = false` claim below bounds the blast
    // radius to one call per account, but "bounded" is not "authorised": an
    // anonymous caller could still burn a new tenant's provisioning slot and
    // seed it with an industry of their choosing.
    //
    // No role requirement beyond membership: this fires from the dashboard
    // shell on first load for whoever gets there first, which is normally the
    // owner but need not be.
    const ctx = await getCurrentAccount();
    if (ctx.accountId !== account_id) {
      throw new ForbiddenError("Cannot provision another account");
    }

    // Use admin client to bypass RLS for provisioning
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Atomically claim the provisioning rights
    const { data: updatedAcc, error: updateErr } = await supabase
      .from('accounts')
      .update({ is_provisioned: true })
      .eq('id', account_id)
      .eq('is_provisioned', false)
      .select('id')
      .single();

    if (!updatedAcc || updateErr) {
      return NextResponse.json({ message: "Already provisioned or provisioning in progress" });
    }

    const { data: firstUser } = await supabase.from('profiles').select('user_id').eq('account_id', account_id).limit(1).single();
    const userId = firstUser?.user_id;

    if (!userId) {
       return NextResponse.json({ error: "No user found for account" }, { status: 400 });
    }

    // Default basic data everyone gets
    let pipelineName = "Main Sales Pipeline";
    let stages = [
      { name: "New Lead", position: 0, color: "#3b82f6" },
      { name: "Contacted", position: 1, color: "#eab308" },
      { name: "Qualified", position: 2, color: "#8b5cf6" },
      { name: "Closed Won", position: 3, color: "#22c55e" },
      { name: "Closed Lost", position: 4, color: "#ef4444" },
    ];
    let tags = ["Hot", "Warm", "Cold"];
    let customFields: any[] = [];

    // Industry specific overrides
    if (industry.includes("Real Estate")) {
      pipelineName = "Property Sales";
      stages = [
        { name: "New Inquiry", position: 0, color: "#3b82f6" },
        { name: "Property Shown", position: 1, color: "#eab308" },
        { name: "Offer Made", position: 2, color: "#8b5cf6" },
        { name: "Under Contract", position: 3, color: "#f97316" },
        { name: "Closed", position: 4, color: "#22c55e" },
      ];
      tags = ["Buyer", "Seller", "Renter", "Investor", "High Budget"];
      customFields = [
        { field_name: "Budget", field_type: "text" },
        { field_name: "Preferred Location", field_type: "text" },
      ];
    } else if (industry.includes("Healthcare") || industry.includes("Dental")) {
      pipelineName = "Patient Intake";
      stages = [
        { name: "New Inquiry", position: 0, color: "#3b82f6" },
        { name: "Consultation Booked", position: 1, color: "#eab308" },
        { name: "Consultation Done", position: 2, color: "#8b5cf6" },
        { name: "Treatment Started", position: 3, color: "#22c55e" },
      ];
      tags = ["New Patient", "Returning Patient", "Checkup", "Emergency"];
      customFields = [
        { field_name: "Last Visit Date", field_type: "text" },
      ];
    } else if (industry.includes("Retail")) {
      pipelineName = "Order Fulfillment";
      stages = [
        { name: "Order Placed", position: 0, color: "#3b82f6" },
        { name: "Processing", position: 1, color: "#eab308" },
        { name: "Shipped", position: 2, color: "#8b5cf6" },
        { name: "Delivered", position: 3, color: "#22c55e" },
      ];
      tags = ["VIP Customer", "Repeat Buyer", "Refund Request"];
    } else if (industry.includes("Education")) {
      pipelineName = "Admissions";
      stages = [
        { name: "Lead", position: 0, color: "#3b82f6" },
        { name: "Application Submitted", position: 1, color: "#eab308" },
        { name: "Interview Scheduled", position: 2, color: "#8b5cf6" },
        { name: "Enrolled", position: 3, color: "#22c55e" },
      ];
      tags = ["Student", "Parent", "Scholarship"];
    }

    // Insert Pipeline
    const { data: pLine } = await supabase
      .from('pipelines')
      .insert({ account_id, user_id: userId, name: pipelineName })
      .select('id')
      .single();

    if (pLine) {
      // Insert Stages
      const stagesToInsert = stages.map(s => ({
        pipeline_id: pLine.id,
        name: s.name,
        position: s.position,
        color: s.color,
      }));
      await supabase.from('pipeline_stages').insert(stagesToInsert);
    }

    // Insert Tags
    if (tags.length > 0) {
      const tagsToInsert = tags.map(t => ({
        account_id,
        user_id: userId,
        name: t,
        color: "#3b82f6"
      }));
      await supabase.from('tags').insert(tagsToInsert);
    }

    // Insert Custom Fields
    if (customFields.length > 0) {
      const fieldsToInsert = customFields.map(f => ({
        account_id,
        user_id: userId,
        field_name: f.field_name,
        field_type: f.field_type,
      }));
      await supabase.from('custom_fields').insert(fieldsToInsert);
    }

    // Create Default Roles
    const { data: adminRole } = await supabase
      .from('employee_roles')
      .insert({
        account_id,
        name: 'Admin',
        description: 'Full administrative access',
        permissions: { all: true }
      })
      .select('id')
      .single();



    // Assign Admin role to the creator
    // Assign Admin role to the creator
    if (adminRole && userId) {
      await supabase
        .from('profiles')
        .update({ employee_role_id: adminRole.id })
        .eq('user_id', userId)
        .eq('account_id', account_id);
    }

    // Load default Indian territories
    await supabase.rpc('territory_bulk_seed', { 
      p_account_id: account_id, 
      p_countries: SEED_COUNTRIES, 
      p_states: SEED_INDIA_STATES, 
      p_districts: SEED_INDIA_DISTRICTS 
    });

    return NextResponse.json({ message: "Account provisioned successfully" });
  } catch (error: any) {
    console.error("Provisioning Error:", error);
    return toErrorResponse(error);
  }
}
