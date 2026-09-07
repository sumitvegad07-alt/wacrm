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

    // Every pipeline is bookended by two predefined, locked stages: "New" first
    // and "Won/Lost" last. Only the middle stages differ by industry. The
    // terminal "Won/Lost" stage is where a deal is resolved (won or lost) — see
    // the deal detail page. Middle-stage colours cycle through this palette.
    const MIDDLE_COLORS = ["#6366f1", "#eab308", "#f97316", "#8b5cf6", "#14b8a6"];
    const buildStages = (middle: string[]) => {
      const rows = [{ name: "New", color: "#3b82f6" }];
      middle.forEach((name, i) => rows.push({ name, color: MIDDLE_COLORS[i % MIDDLE_COLORS.length] }));
      rows.push({ name: "Won/Lost", color: "#64748b" });
      return rows.map((s, position) => ({ ...s, position }));
    };

    // Default basic data everyone gets
    let pipelineName = "Sales Pipeline";
    let stages = buildStages(["Contacted", "Follow-up", "Quotation Sent"]);
    let tags = ["Hot", "Warm", "Cold"];
    let customFields: any[] = [];

    // Industry specific overrides (middle stages only — New / Won/Lost are fixed)
    if (industry.includes("Real Estate")) {
      pipelineName = "Property Sales";
      stages = buildStages(["Property Shown", "Offer Made", "Under Contract"]);
      tags = ["Buyer", "Seller", "Renter", "Investor", "High Budget"];
      customFields = [
        { field_name: "Budget", field_type: "text" },
        { field_name: "Preferred Location", field_type: "text" },
      ];
    } else if (industry.includes("Healthcare") || industry.includes("Dental")) {
      pipelineName = "Patient Intake";
      stages = buildStages(["Consultation Booked", "Consultation Done", "Treatment Started"]);
      tags = ["New Patient", "Returning Patient", "Checkup", "Emergency"];
      customFields = [
        { field_name: "Last Visit Date", field_type: "text" },
      ];
    } else if (industry.includes("Retail")) {
      pipelineName = "Order Fulfillment";
      stages = buildStages(["Processing", "Shipped", "Delivered"]);
      tags = ["VIP Customer", "Repeat Buyer", "Refund Request"];
    } else if (industry.includes("Education")) {
      pipelineName = "Admissions";
      stages = buildStages(["Application Submitted", "Interview Scheduled", "Enrolled"]);
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

    // Seed the standard default lead statuses. New leads default to "New".
    await supabase.from('lead_statuses').insert([
      { account_id, name: 'New', color: '#3b82f6', position: 0 },
      { account_id, name: 'Qualified', color: '#8b5cf6', position: 1 },
      { account_id, name: 'Hot', color: '#ef4444', position: 2 },
      { account_id, name: 'Follow-up', color: '#eab308', position: 3 },
      { account_id, name: 'Disqualified', color: '#6b7280', position: 4 },
    ]);

    // Seed the standard default expense types. These are the out-of-the-box
    // allowances every new account starts with; the admin can add/remove more
    // from Settings. Only seeded for plans that include the Workforce (WFA)
    // line, since the Expense module is a WFA feature — CRM-only accounts get
    // nothing to keep their setup uncluttered.
    {
      const { data: acct } = await supabase
        .from('accounts')
        .select('subscription_plan')
        .eq('id', account_id)
        .single();
      const plan = String(acct?.subscription_plan || '').toUpperCase();
      const hasWorkforce =
        plan === 'WFA' || plan === 'CRM_WFA' || plan === 'SFA' || plan === 'CRM_SFA' ||
        // Legacy / unrecognised plans get full access (mirrors catalog.ts), so seed them too.
        !['CRM'].includes(plan);
      if (hasWorkforce) {
        await supabase.from('expense_types').insert([
          { account_id, allowance_type: 'REGULAR', expense_name: 'Food', created_by: userId },
          { account_id, allowance_type: 'REGULAR', expense_name: 'Hotel', created_by: userId },
          { account_id, allowance_type: 'TRAVELLING', expense_name: 'Travel by Bike', created_by: userId },
          { account_id, allowance_type: 'TRAVELLING', expense_name: 'Travel by Car', created_by: userId },
        ]);
      }
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
    if (adminRole && userId) {
      await supabase
        .from('profiles')
        .update({ employee_role_id: adminRole.id })
        .eq('user_id', userId)
        .eq('account_id', account_id);
    }

    // Default "Sales Executive" role — a mobile-only field rep. Permissions are a
    // flat { key: true } map of rights (same shape the Roles editor reads/writes).
    // web_access is explicitly false so the rep can sign into the Android app only.
    // Rights outside the account's plan are simply inert until that line is bought.
    await supabase
      .from('employee_roles')
      .insert({
        account_id,
        name: 'Sales Executive',
        description: 'Mobile-only field sales rep — sell, collect, visit and report from the app.',
        status: 'active',
        permissions: {
          // Login surface — mobile only
          web_access: false,
          mobile_access: true,
          // Customers — view + create
          view_contacts: true,
          create_contacts: true,
          // Products — view only
          view_products: true,
          // Orders — view + create
          view_orders: true,
          create_orders: true,
          // Payments — view, create, attachments, reports
          view_payments: true,
          create_payments: true,
          view_payment_attachments: true,
          view_payment_reports: true,
          // Customer financials — outstanding only
          view_customer_outstanding: true,
          // Tasks — view, create, edit
          view_tasks: true,
          create_task: true,
          edit_task: true,
          // Expenses — view, create
          view_expenses: true,
          create_expenses: true,
          // Visits — view + check-in
          view_visits: true,
          mobile_visit_checkin: true,
          // Leave — view + apply
          view_leaves: true,
          manage_leaves: true,
          // Mobile attendance & location — location dashboard only
          view_location_tracking: true,
          // Reports — sales/order, payment, ageing, expense, visit/DSR, task + share PDF
          // (view_payment_reports above already covers the payment report)
          view_sales_reports: true,
          view_ageing_reports: true,
          view_expense_reports: true,
          view_field_reports: true,
          view_task_reports: true,
          share_reports: true,
        },
      });

    // Load default Indian territories
    await supabase.rpc('territory_bulk_seed', {
      p_account_id: account_id,
      p_countries: SEED_COUNTRIES,
      p_states: SEED_INDIA_STATES,
      p_districts: SEED_INDIA_DISTRICTS
    });

    // Configure Territory Master to area-wise with the default Country/State/City
    // hierarchy, so the area picker works immediately and customer creation is
    // area-scoped to each rep's assignment. Merged so the trigger-seeded
    // company_profile in settings is preserved.
    {
      const { data: acctSettings } = await supabase
        .from('accounts')
        .select('settings')
        .eq('id', account_id)
        .single();
      const mergedSettings = {
        ...((acctSettings?.settings as Record<string, unknown>) || {}),
        territory_settings: {
          levels: [
            { position: 1, name: 'Country', enabled: true },
            { position: 2, name: 'State', enabled: true },
            { position: 3, name: 'City', enabled: true },
            { position: 4, name: 'Area', enabled: false },
            { position: 5, name: 'Sub Area', enabled: false },
          ],
          assignment_mode: 'area_wise',
        },
      };
      await supabase.from('accounts').update({ settings: mergedSettings }).eq('id', account_id);
    }

    return NextResponse.json({ message: "Account provisioned successfully" });
  } catch (error: any) {
    console.error("Provisioning Error:", error);
    return toErrorResponse(error);
  }
}
