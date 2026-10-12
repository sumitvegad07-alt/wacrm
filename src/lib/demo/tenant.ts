// ============================================================
// Builds (and tears down) a demo tenant's *structure*: the account, the logins,
// the masters, the catalogue and the customers. History is history.ts.
//
// This mirrors scripts/seed-playconsole-test-account.mjs, which is already
// proven against this production database, and keeps its three hard-won rules:
//
//   1. `handle_new_user` mints the tenant from auth user metadata. It swallows
//      its own errors (EXCEPTION WHEN OTHERS -> RETURN NEW), so a missing
//      profile after createUser means the trigger failed silently. Check it.
//   2. `is_provisioned` must be forced true, or the dashboard shell runs
//      provision-account on first web login and overwrites the configuration.
//   3. Customer inserts go in chunks of 100. One big insert is a single
//      statement firing that many automation + notification triggers, which
//      times out at the API gateway.
//
// Every phase checks for what it already created, so a partial failure is safe
// to re-run.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultModuleSettings, planLines, type ModuleKey } from "../plans/catalog";
import {
  type DemoCity,
  type DemoTenant,
  EXPIRES_AT,
  FIRM_KIND,
  FIRM_PREFIX,
  FIRM_SUFFIX,
  FIRST_NAMES,
  LAST_NAMES,
  PASSWORD,
  REP_NAMES,
  STREETS,
  UNIT_NAMES,
  USER_SEATS,
  repEmail,
} from "./profiles";
import { makeRng, seedFromString, uniqueMaker, type Rng } from "./rng";
import { addDays, daysBetween, istInstant, type IstDay } from "./ist";

type DB = SupabaseClient<any, any, any>;

export interface DemoRep {
  index: number;
  userId: string;
  profileId: string;
  email: string;
  fullName: string;
  city: DemoCity;
}

export interface DemoCustomer {
  id: string;
  /** profiles.id of the rep who owns it (contacts.employee_id). */
  employeeId: string;
  /** auth user id of the rep (contacts.user_id). */
  userId: string;
  repIndex: number;
  name: string;
  company: string;
  lat: number;
  lng: number;
  creditDays: number;
  city: string;
  /**
   * When this customer joined the book. Spread across the history window, not
   * all set to "now" — otherwise the "New Customers" series spikes once on the
   * seed date and reads zero for every other month. Visits and orders are only
   * generated on or after this date, so no customer transacts before it exists.
   */
  createdAt: Date;
}

export interface DemoProduct {
  id: string;
  name: string;
  price: number;
  unit: string;
  unitId: string | null;
  categoryName: string;
}

export interface DemoMasters {
  expenseTypeIds: { id: string; name: string; travelling: boolean }[];
  paymentTypeIds: { id: string; name: string }[];
  leaveTypeIds: { id: string; name: string }[];
  holidayListId: string | null;
  weeklyOffs: number[];
  /** `YYYY-MM-DD` keys of public holidays. */
  holidays: Set<string>;
  pipelineId: string | null;
  stages: { id: string; name: string; position: number }[];
  leadStatuses: string[];
  leadSources: string[];
  leadIndustries: string[];
}

export interface BuiltTenant {
  tenant: DemoTenant;
  accountId: string;
  owner: { userId: string; profileId: string };
  reps: DemoRep[];
  customers: DemoCustomer[];
  products: DemoProduct[];
  masters: DemoMasters;
  rng: Rng;
}

// ── Small helpers ───────────────────────────────────────────

async function must<T>(label: string, p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${label} failed: ${error.message ?? error}`);
  return data;
}

export type Logger = (msg: string) => void;

/** Insert rows only if the table has none for this account. */
async function seedOnce(
  db: DB,
  table: string,
  accountId: string,
  label: string,
  rows: Record<string, unknown>[],
  log: Logger,
): Promise<void> {
  const { count } = await db
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("account_id", accountId);
  if (count && count > 0) {
    log(`    ${label}: already seeded (${count})`);
    return;
  }
  await must(`${label} insert`, db.from(table).insert(rows) as any);
  log(`    ${label}: ${rows.length}`);
}

export async function insertChunked(
  db: DB,
  table: string,
  rows: Record<string, unknown>[],
  chunk: number,
  label: string,
  log?: Logger,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    await must(
      `${label} insert (rows ${i + 1}-${i + slice.length})`,
      db.from(table).insert(slice) as any,
    );
  }
  if (log && rows.length) log(`    ${label}: ${rows.length}`);
}

/** Same as insertChunked but returns the inserted ids, in order. */
async function insertChunkedReturning(
  db: DB,
  table: string,
  rows: Record<string, unknown>[],
  chunk: number,
  label: string,
  select = "id",
): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const got = await must(
      `${label} insert (rows ${i + 1}-${i + slice.length})`,
      db.from(table).insert(slice).select(select) as any,
    );
    out.push(...(got as any[]));
  }
  return out;
}

// ── Roles ───────────────────────────────────────────────────

/**
 * The Sales Executive permission set, assembled from the plan's lines exactly
 * as provision-account does. A WFA tenant must not grant `view_orders`: the
 * module does not exist on that plan, and a permission for a screen the plan
 * hides is the sort of inconsistency a prospect clicks into.
 */
function salesExecPermissions(plan: DemoTenant["plan"]): Record<string, boolean> {
  const lines = planLines(plan);
  const p: Record<string, boolean> = {
    web_access: false,
    mobile_access: true,

    view_contacts: true,
    create_contacts: true,
    view_products: true,
    view_tasks: true,
    create_task: true,
    edit_task: true,
    view_leaves: true,
    manage_leaves: true,
    view_task_reports: true,
    share_reports: true,

    receive_task_notifications: true,
    receive_assignment_notifications: true,
    receive_announcement_notifications: true,
    receive_punch_alarm: true,
  };

  if (lines.wfa) {
    Object.assign(p, {
      view_expenses: true,
      create_expenses: true,
      view_visits: true,
      mobile_visit_checkin: true,
      view_location_tracking: true,
      view_expense_reports: true,
      view_field_reports: true,
    });
  }

  if (lines.sfa) {
    Object.assign(p, {
      view_orders: true,
      create_orders: true,
      view_payments: true,
      create_payments: true,
      view_payment_attachments: true,
      view_payment_reports: true,
      view_customer_outstanding: true,
      view_sales_reports: true,
      view_ageing_reports: true,
    });
  }

  if (lines.crm) {
    Object.assign(p, {
      view_leads: true,
      create_leads: true,
      edit_leads: true,
      view_deals: true,
      create_deals: true,
      view_quotations: true,
      create_quotations: true,
      view_lead_reports: true,
      view_quotation_reports: true,
    });
  }

  return p;
}

// ── Phase 1: the account ────────────────────────────────────

async function createOwnerAndAccount(
  db: DB,
  t: DemoTenant,
  log: Logger,
): Promise<{ accountId: string; userId: string; profileId: string }> {
  const { data: existing } = await db
    .from("profiles")
    .select("id, user_id, account_id")
    .eq("email", t.adminEmail)
    .maybeSingle();

  if (existing) {
    log(`    admin login already exists (account ${existing.account_id})`);
    return {
      accountId: existing.account_id as string,
      userId: existing.user_id as string,
      profileId: existing.id as string,
    };
  }

  const { data: created, error: authErr } = await db.auth.admin.createUser({
    email: t.adminEmail,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: t.adminName,
      company_name: t.company,
      plan: t.plan,
      sales_users: REP_NAMES.length,
    },
  });
  if (authErr) throw new Error(`admin auth user creation failed: ${authErr.message}`);
  const userId = created.user.id;

  const { data: profile } = await db
    .from("profiles")
    .select("id, account_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!profile) {
    throw new Error(
      `handle_new_user did not create a profile/account for ${t.adminEmail}. ` +
        `Auth user ${userId} now exists with no tenant — delete it before re-running.`,
    );
  }

  log(`    created admin login + account ${profile.account_id}`);
  return {
    accountId: profile.account_id as string,
    userId,
    profileId: profile.id as string,
  };
}

// ── Phase 2: configuration ──────────────────────────────────

async function configureAccount(db: DB, t: DemoTenant, accountId: string, log: Logger) {
  const acct = await must(
    "read account",
    db.from("accounts").select("settings").eq("id", accountId).single() as any,
  );
  const prev = (acct as any).settings ?? {};
  const lines = planLines(t.plan);
  const headCity = t.cities[0];

  const settings = {
    ...prev,
    task_types: ["Task", "Call", "Visit", "Meeting", "Follow up", "Note"],

    // Fencing OFF. A live fence blocks visit check-in when the rep is not at
    // the customer, which would stop a demo being driven from the office.
    geo_fencing: {
      enabled: false,
      visit_enabled: true,
      attendance_enabled: false,
      enforce_check_in: true,
      enforce_check_out: false,
      radius_m: 50,
    },

    gst_enabled: false,
    hsn_enabled: false,

    extra_settings: {
      customer_unique_key: "name",
      product_unique_key: "name",
      multi_unit_enabled: false,
    },

    order_settings: {
      ...(prev.order_settings ?? {}),
      tax_mode: "exclusive",
      discount_mode: "item",
      hierarchy_enabled: false,
      enforce_price_floor: false,
      amount_discount_basis: "entered",
      allow_discount_over_price_list: false,
    },

    product_settings: {
      levels_count: 1,
      level_1_name: "Category",
      level_2_name: "Sub-Category",
      level_3_name: "Brand",
    },

    // Tracking on, 10-minute interval, Mon–Sat. Shift times never gate
    // tracking — a punched-in rep is tracked at any hour.
    tracking_settings: {
      enabled: true,
      start_time: "09:30",
      end_time: "18:30",
      working_days: [1, 2, 3, 4, 5, 6],
      grace_minutes: 15,
      interval_minutes: 10,
    },

    // Direct assignment: contacts carry employee_id and the customer form does
    // not demand a territory.
    territory_settings: {
      levels: [
        { position: 1, name: "Country", enabled: true },
        { position: 2, name: "State", enabled: true },
        { position: 3, name: "City", enabled: true },
        { position: 4, name: "Area", enabled: false },
        { position: 5, name: "Sub Area", enabled: false },
      ],
      assignment_mode: "direct",
    },
    assignment_mode: "direct", // legacy top-level key, still read in places

    payment_settings: {
      require_notes: false,
      require_reference: false,
      require_attachment: false,
      approval_required: false,
      enable_credit_limit: true,
      enable_credit_days: true,
      credit_days_enforcement: "warn",
      credit_limit_enforcement: "warn",
      // `enforce_payment_status_transition` rejects any payment dated more than
      // `allow_backdate_days` ago unless the caller holds `backdate_payments` —
      // and it treats a NULL auth.uid() (which is what a service-role insert
      // has) as "no permission", not as "trusted". At the default of 30 days,
      // every month of back-dated payment history after the first would be
      // refused outright. 400 covers a 12-month backfill with headroom, and is
      // harmless live: the same trigger separately refuses any future date.
      allow_backdate_days: 400,
    },

    // The generator settles money against exactly these two statuses. Change
    // one and the Outstanding / Ageing widgets read zero.
    outstanding_settings: {
      order_statuses: ["Closed"],
      payment_statuses: ["Approved"],
    },

    whatsapp_settings: { default_country_code: "+91" },

    company_profile: {
      ...(prev.company_profile ?? {}),
      name: t.company,
      registered_email: t.adminEmail,
      contact_person_name: t.adminName,
      city: headCity.city,
      state: headCity.state,
      country: "India",
      gst_enabled: false,
      hsn_enabled: false,
    },
  };

  // The plan's defaults, then the demo-worthy opt-ins this tenant wants on.
  const moduleSettings = defaultModuleSettings(t.plan) as Record<string, boolean>;
  for (const key of t.extraModules) moduleSettings[key as ModuleKey] = true;

  await must(
    "account configuration",
    db
      .from("accounts")
      .update({
        name: t.company,
        industry: t.industry,
        subscription_plan: t.plan,
        subscription_status: "active",
        subscription_expires_at: EXPIRES_AT,
        user_count: USER_SEATS,
        default_currency: "INR",
        require_odometer: false,
        settings,
        module_settings: moduleSettings,
        is_provisioned: true,
      })
      .eq("id", accountId)
      .select("id") as any,
  );

  const on = Object.entries(moduleSettings)
    .filter(([, v]) => v)
    .map(([k]) => k);
  log(`    plan ${t.plan} (crm:${lines.crm} wfa:${lines.wfa} sfa:${lines.sfa}), modules: ${on.join(", ") || "none"}`);
}

// ── Phase 3: masters ────────────────────────────────────────

/** A few real Indian public holidays per year, so the attendance report has gaps. */
function holidayRows(accountId: string, listId: string, ownerUserId: string, years: number[]) {
  const fixed: [number, number, string][] = [
    [1, 26, "Republic Day"],
    [5, 1, "Labour Day"],
    [8, 15, "Independence Day"],
    [10, 2, "Gandhi Jayanti"],
    [12, 25, "Christmas"],
  ];
  const rows: Record<string, unknown>[] = [];
  for (const y of years) {
    for (const [m, d, name] of fixed) {
      rows.push({
        account_id: accountId,
        holiday_list_id: listId,
        name,
        holiday_date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        created_by: ownerUserId,
      });
    }
  }
  return rows;
}

async function seedMasters(
  db: DB,
  t: DemoTenant,
  accountId: string,
  ownerUserId: string,
  years: number[],
  log: Logger,
): Promise<DemoMasters> {
  const a = accountId;
  const lines = planLines(t.plan);

  // Pipeline + stages (CRM only — a WFA/SFA tenant has no Deals screen).
  let pipelineId: string | null = null;
  let stages: { id: string; name: string; position: number }[] = [];
  if (lines.crm) {
    const { data: pipes } = await db.from("pipelines").select("id").eq("account_id", a).limit(1);
    if (pipes && pipes.length) {
      pipelineId = pipes[0].id as string;
    } else {
      const pipeline = await must(
        "pipeline insert",
        db
          .from("pipelines")
          .insert({ account_id: a, user_id: ownerUserId, name: "Sales Pipeline" })
          .select("id")
          .single() as any,
      );
      pipelineId = (pipeline as any).id;
      await must(
        "pipeline stages insert",
        db.from("pipeline_stages").insert([
          { pipeline_id: pipelineId, name: "New", position: 0, color: "#3b82f6" },
          { pipeline_id: pipelineId, name: "Contacted", position: 1, color: "#6366f1" },
          { pipeline_id: pipelineId, name: "Follow-up", position: 2, color: "#eab308" },
          { pipeline_id: pipelineId, name: "Quotation Sent", position: 3, color: "#f97316" },
          { pipeline_id: pipelineId, name: "Negotiation", position: 4, color: "#a855f7" },
          { pipeline_id: pipelineId, name: "Won/Lost", position: 5, color: "#64748b" },
        ]) as any,
      );
      log("    pipeline + 6 stages");
    }
    const got = await must(
      "read stages",
      db.from("pipeline_stages").select("id, name, position").eq("pipeline_id", pipelineId).order("position") as any,
    );
    stages = got as any;

    await seedOnce(db, "tags", a, "tags", [
      { account_id: a, user_id: ownerUserId, name: "Hot", color: "#ef4444" },
      { account_id: a, user_id: ownerUserId, name: "Warm", color: "#f59e0b" },
      { account_id: a, user_id: ownerUserId, name: "Cold", color: "#3b82f6" },
    ], log);

    await seedOnce(db, "lead_statuses", a, "lead statuses", [
      { account_id: a, name: "New", color: "#3b82f6", position: 0 },
      { account_id: a, name: "Qualified", color: "#8b5cf6", position: 1 },
      { account_id: a, name: "Hot", color: "#ef4444", position: 2 },
      { account_id: a, name: "Follow-up", color: "#eab308", position: 3 },
      { account_id: a, name: "Disqualified", color: "#6b7280", position: 4 },
    ], log);

    await seedOnce(db, "lead_sources", a, "lead sources", [
      { account_id: a, name: "Facebook", color: "#1877f2", position: 0 },
      { account_id: a, name: "Instagram", color: "#e1306c", position: 1 },
      { account_id: a, name: "Google Ads", color: "#34a853", position: 2 },
      { account_id: a, name: "Referral", color: "#f59e0b", position: 3 },
      { account_id: a, name: "IndiaMart", color: "#ef4444", position: 4 },
      { account_id: a, name: "Walk-in", color: "#14b8a6", position: 5 },
    ], log);

    await seedOnce(db, "lead_industries", a, "lead industries", [
      { account_id: a, name: "Residential", color: "#22c55e", position: 0 },
      { account_id: a, name: "Commercial", color: "#8b5cf6", position: 1 },
      { account_id: a, name: "Builder / Contractor", color: "#3b82f6", position: 2 },
      { account_id: a, name: "Institutional", color: "#06b6d4", position: 3 },
    ], log);
  }

  await seedOnce(db, "leave_types", a, "leave types", [
    { account_id: a, name: "Casual Leave", status: "Active", created_by: ownerUserId },
    { account_id: a, name: "Medical Leave", status: "Active", created_by: ownerUserId },
    { account_id: a, name: "Maternity Leave", status: "Active", created_by: ownerUserId },
  ], log);

  // Sunday off, is_default so every rep inherits it and attendance works
  // without the admin creating a list first.
  await seedOnce(db, "holiday_lists", a, "holiday list", [
    {
      account_id: a,
      name: "Default Holiday List",
      weekly_offs: [0],
      is_default: true,
      created_by: ownerUserId,
    },
  ], log);

  const hl = await must(
    "read holiday list",
    db.from("holiday_lists").select("id, weekly_offs").eq("account_id", a).limit(1).single() as any,
  );
  const holidayListId = (hl as any).id as string;
  const weeklyOffs = ((hl as any).weekly_offs as number[]) ?? [0];

  const { count: holCount } = await db
    .from("holidays")
    .select("*", { count: "exact", head: true })
    .eq("account_id", a);
  if (!holCount) {
    const rows = holidayRows(a, holidayListId, ownerUserId, years);
    await must("holidays insert", db.from("holidays").insert(rows) as any);
    log(`    holidays: ${rows.length}`);
  }
  const holRows = await must(
    "read holidays",
    db.from("holidays").select("holiday_date").eq("account_id", a) as any,
  );
  const holidays = new Set<string>(
    (holRows as any[]).map((h) => String(h.holiday_date).slice(0, 10)),
  );

  if (lines.wfa) {
    await seedOnce(db, "expense_types", a, "expense types", [
      { account_id: a, allowance_type: "REGULAR", expense_name: "Food", default_amount: 200, created_by: ownerUserId },
      { account_id: a, allowance_type: "REGULAR", expense_name: "Hotel", default_amount: 1200, created_by: ownerUserId },
      { account_id: a, allowance_type: "REGULAR", expense_name: "Mobile Recharge", default_amount: 299, created_by: ownerUserId },
      { account_id: a, allowance_type: "TRAVELLING", expense_name: "Travel by Bike", is_per_km: "SYSTEM", rate_per_km: 4, created_by: ownerUserId },
      { account_id: a, allowance_type: "TRAVELLING", expense_name: "Travel by Car", is_per_km: "SYSTEM", rate_per_km: 9, created_by: ownerUserId },
      { account_id: a, allowance_type: "TRAVELLING", expense_name: "Bus / Train Fare", created_by: ownerUserId },
    ], log);
  }

  if (lines.sfa) {
    await seedOnce(db, "payment_types", a, "payment types", [
      { account_id: a, name: "Cash", requires_reference: false, position: 0, is_active: true },
      { account_id: a, name: "UPI", requires_reference: false, position: 1, is_active: true },
      { account_id: a, name: "Bank Transfer", requires_reference: false, position: 2, is_active: true },
      { account_id: a, name: "Cheque", requires_reference: false, position: 3, is_active: true },
    ], log);
  }

  await seedOnce(
    db,
    "product_units",
    a,
    "product units",
    UNIT_NAMES.map(([name, short]) => ({
      account_id: a,
      name,
      short_name: short,
      is_active: true,
    })),
    log,
  );

  const [expTypes, payTypes, lvTypes] = await Promise.all([
    db.from("expense_types").select("id, expense_name, allowance_type").eq("account_id", a),
    db.from("payment_types").select("id, name").eq("account_id", a),
    db.from("leave_types").select("id, name").eq("account_id", a),
  ]);

  return {
    expenseTypeIds: ((expTypes.data ?? []) as any[]).map((e) => ({
      id: e.id,
      name: e.expense_name,
      travelling: e.allowance_type === "TRAVELLING",
    })),
    paymentTypeIds: ((payTypes.data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name })),
    leaveTypeIds: ((lvTypes.data ?? []) as any[]).map((l) => ({ id: l.id, name: l.name })),
    holidayListId,
    weeklyOffs,
    holidays,
    pipelineId,
    stages,
    leadStatuses: ["New", "Qualified", "Hot", "Follow-up", "Disqualified"],
    leadSources: ["Facebook", "Instagram", "Google Ads", "Referral", "IndiaMart", "Walk-in"],
    leadIndustries: ["Residential", "Commercial", "Builder / Contractor", "Institutional"],
  };
}

// ── Phase 4: roles ──────────────────────────────────────────

async function seedRoles(
  db: DB,
  t: DemoTenant,
  accountId: string,
  ownerProfileId: string,
  log: Logger,
): Promise<{ adminRoleId: string; salesRoleId: string }> {
  const existing = await must(
    "read roles",
    db.from("employee_roles").select("id, name").eq("account_id", accountId) as any,
  );
  const byName = new Map((existing as any[]).map((r) => [r.name, r.id as string]));

  let adminRoleId = byName.get("Admin");
  if (!adminRoleId) {
    const row = await must(
      "Admin role insert",
      db
        .from("employee_roles")
        .insert({
          account_id: accountId,
          name: "Admin",
          description: "Full administrative access",
          status: "active",
          permissions: { all: true },
        })
        .select("id")
        .single() as any,
    );
    adminRoleId = (row as any).id;
  }

  let salesRoleId = byName.get("Sales Executive");
  if (!salesRoleId) {
    const row = await must(
      "Sales Executive role insert",
      db
        .from("employee_roles")
        .insert({
          account_id: accountId,
          name: "Sales Executive",
          description: "Mobile-only field executive — visit, sell, collect and report from the app.",
          status: "active",
          permissions: salesExecPermissions(t.plan),
        })
        .select("id")
        .single() as any,
    );
    salesRoleId = (row as any).id;
  }

  await must(
    "admin profile update",
    db
      .from("profiles")
      .update({
        employee_role_id: adminRoleId,
        full_name: t.adminName,
        designation: "Administrator",
        department: "Management",
        employee_code: "ADM-001",
        status: "active",
        web_access: true,
        mobile_access: true,
      })
      .eq("id", ownerProfileId)
      .select("id") as any,
  );

  log("    roles: Admin + Sales Executive");
  return { adminRoleId: adminRoleId!, salesRoleId: salesRoleId! };
}

// ── Phase 5: the five reps ──────────────────────────────────

async function seedReps(
  db: DB,
  t: DemoTenant,
  accountId: string,
  salesRoleId: string,
  ownerProfileId: string,
  log: Logger,
): Promise<DemoRep[]> {
  const reps: DemoRep[] = [];

  for (let i = 0; i < REP_NAMES.length; i++) {
    const { first, full } = REP_NAMES[i];
    const email = repEmail(first, t.key);
    const city = t.cities[i % t.cities.length];

    const { data: existing } = await db
      .from("profiles")
      .select("id, user_id")
      .eq("account_id", accountId)
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      reps.push({
        index: i,
        userId: existing.user_id as string,
        profileId: existing.id as string,
        email,
        fullName: full,
        city,
      });
      continue;
    }

    // member_of_account tells handle_new_user this login belongs to an existing
    // tenant, so it must NOT mint a second account + Customer ID.
    const { data: created, error } = await db.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: full, member_of_account: accountId },
    });
    if (error) throw new Error(`auth user ${email} creation failed: ${error.message}`);

    const profile = await must(
      `profile ${email} upsert`,
      db
        .from("profiles")
        .upsert(
          {
            user_id: created.user.id,
            email,
            full_name: full,
            account_id: accountId,
            account_role: "agent",
            employee_role_id: salesRoleId,
            employee_code: `EMP-${String(i + 1).padStart(3, "0")}`,
            mobile: `+9188${String(10000000 + i + 1).slice(-8)}`,
            department: "Field",
            designation: "Sales Executive",
            status: "active",
            // Mirrors the role: mobile-only, so the app is the only way in.
            web_access: false,
            mobile_access: true,
            default_approver_id: ownerProfileId,
            holiday_list_id: null,
          },
          { onConflict: "user_id" },
        )
        .select("id, user_id")
        .single() as any,
    );

    reps.push({
      index: i,
      userId: (profile as any).user_id,
      profileId: (profile as any).id,
      email,
      fullName: full,
      city,
    });
  }

  log(`    reps: ${reps.length} (${reps.map((r) => r.city.city).join(", ")})`);
  return reps;
}

// ── Phase 6: catalogue ──────────────────────────────────────

async function seedCatalogue(
  db: DB,
  t: DemoTenant,
  accountId: string,
  ownerUserId: string,
  log: Logger,
): Promise<DemoProduct[]> {
  const units = await must(
    "read units",
    db.from("product_units").select("id, name").eq("account_id", accountId) as any,
  );
  const unitByName = new Map((units as any[]).map((u) => [u.name, u.id as string]));

  const { data: existingProducts } = await db
    .from("products")
    .select("id, name, price, unit, unit_id, category")
    .eq("account_id", accountId);

  if (existingProducts && existingProducts.length) {
    log(`    products: already seeded (${existingProducts.length})`);
    return (existingProducts as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      unit: p.unit,
      unitId: p.unit_id,
      categoryName: p.category,
    }));
  }

  const cats = (await must<any[]>(
    "categories insert",
    db
      .from("product_categories")
      .insert(
        t.catalogue.map((c) => ({
          account_id: accountId,
          name: c.name,
          level: 1,
          parent_id: null,
          active: true,
          is_active: true,
        })),
      )
      .select("id, name") as any,
  )) as any[];
  const catByName = new Map(cats.map((c) => [c.name, c.id as string]));

  const rows: Record<string, unknown>[] = [];
  let sku = 1;
  for (const group of t.catalogue) {
    for (const [name, price, unit] of group.products) {
      rows.push({
        account_id: accountId,
        user_id: ownerUserId,
        name,
        sku: `SKU-${String(sku).padStart(4, "0")}`,
        description: `${group.name} — ${name}`,
        price,
        min_price: Math.round(price * 0.9 * 100) / 100,
        category: group.name,
        category_id: catByName.get(group.name),
        unit,
        unit_id: unitByName.get(unit) ?? null,
        track_stock: false,
        active: true,
      });
      sku++;
    }
  }

  const inserted = await insertChunkedReturning(
    db,
    "products",
    rows,
    100,
    "products",
    "id, name, price, unit, unit_id, category",
  );
  log(`    catalogue: ${cats.length} categories, ${inserted.length} products`);

  return inserted.map((p: any) => ({
    id: p.id,
    name: p.name,
    price: Number(p.price),
    unit: p.unit,
    unitId: p.unit_id,
    categoryName: p.category,
  }));
}

// ── Phase 7: customers ──────────────────────────────────────

async function seedCustomers(
  db: DB,
  t: DemoTenant,
  accountId: string,
  reps: DemoRep[],
  rng: Rng,
  window: { firstDay: IstDay; lastDay: IstDay },
  log: Logger,
): Promise<DemoCustomer[]> {
  const { data: existing } = await db
    .from("contacts")
    .select("id, employee_id, user_id, name, company, latitude, longitude, credit_days, city, created_at")
    .eq("account_id", accountId);

  if (existing && existing.length) {
    log(`    customers: already seeded (${existing.length})`);
    const byProfile = new Map(reps.map((r) => [r.profileId, r.index]));
    return (existing as any[]).map((c) => ({
      id: c.id,
      employeeId: c.employee_id,
      userId: c.user_id,
      repIndex: byProfile.get(c.employee_id) ?? 0,
      name: c.name,
      company: c.company,
      lat: Number(c.latitude),
      lng: Number(c.longitude),
      creditDays: c.credit_days ?? 30,
      city: c.city,
      createdAt: new Date(c.created_at),
    }));
  }

  // 55% are the book the company already had when it started on OZZO — dated
  // just before the window opens. The rest arrive through the window, growing
  // slightly, so "New Customers" climbs instead of spiking once.
  const totalDays = daysBetween(window.firstDay, window.lastDay).length;
  const joinDate = (): Date => {
    if (rng.chance(0.55)) return istInstant(addDays(window.firstDay, -rng.between(10, 200)), 11, 0);
    // Square the roll so later months get more arrivals than earlier ones.
    const r = rng.next();
    const offset = Math.floor(Math.sqrt(r) * (totalDays - 1));
    return istInstant(addDays(window.firstDay, offset), rng.between(10, 17), rng.between(0, 59));
  };

  // contacts.name is this account's duplicate key and phone_normalized carries
  // a unique index, so both must be unique inside the tenant.
  const personName = uniqueMaker(() => `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`);
  const kinds = FIRM_KIND[t.customerKind];
  const firmName = uniqueMaker(
    () => `${rng.pick(FIRM_PREFIX)} ${rng.pick(kinds)}${rng.pick(FIRM_SUFFIX)}`,
  );

  let phoneSeq = 0;
  const nextPhone = () => {
    phoneSeq++;
    return `+9198${String(10000000 + phoneSeq).slice(-8)}`;
  };

  let codeSeq = 0;
  const rows: Record<string, unknown>[] = [];
  const plan: { repIndex: number; name: string; company: string; lat: number; lng: number; creditDays: number; city: string; createdAt: Date }[] = [];

  reps.forEach((rep) => {
    const city = rep.city;
    const howMany = rng.between(t.customersPerRep[0], t.customersPerRep[1]);

    for (let n = 0; n < howMany; n++) {
      codeSeq++;
      const company = firmName();
      const contactPerson = personName();
      const area = rng.pick(city.areas);
      const phone = nextPhone();

      // ~8 km box around the city centre: close enough to cluster on a map,
      // far enough apart to look like a real beat.
      const lat = Number((city.lat + (rng.next() - 0.5) * 0.08).toFixed(6));
      const lng = Number((city.lng + (rng.next() - 0.5) * 0.08).toFixed(6));
      const creditDays = rng.pick([7, 15, 21, 30, 45]);
      const createdAt = joinDate();

      rows.push({
        created_at: createdAt.toISOString(),
        client_created_at: createdAt.toISOString(),
        account_id: accountId,
        user_id: rep.userId, // auth id — the rep "owns" the record
        employee_id: rep.profileId, // profiles.id — direct assignment
        company,
        name: contactPerson,
        phone,
        whatsapp: phone,
        email: null,
        address: `${rng.pick(STREETS)}, ${area}`,
        area,
        city: city.city,
        state: city.state,
        country: "India",
        pincode: `${city.pin}${String(rng.between(1, 99)).padStart(2, "0")}`,
        latitude: lat,
        longitude: lng,
        credit_limit: rng.between(10, 100) * 1000,
        credit_days: creditDays,
        opening_balance: 0,
        customer_code: `CUST-${String(codeSeq).padStart(4, "0")}`,
        is_active: true,
        territory_id: null,
      });
      plan.push({ repIndex: rep.index, name: contactPerson, company, lat, lng, creditDays, city: city.city, createdAt });
    }
  });

  // Chunks of 100: one big insert fires that many automation + notification
  // triggers in a single statement, which times out at the API gateway.
  const inserted = await insertChunkedReturning(db, "contacts", rows, 100, "customers", "id");
  log(`    customers: ${inserted.length}`);

  return inserted.map((row: any, i: number) => ({
    id: row.id,
    employeeId: reps[plan[i].repIndex].profileId,
    userId: reps[plan[i].repIndex].userId,
    repIndex: plan[i].repIndex,
    name: plan[i].name,
    company: plan[i].company,
    lat: plan[i].lat,
    lng: plan[i].lng,
    creditDays: plan[i].creditDays,
    city: plan[i].city,
    createdAt: plan[i].createdAt,
  }));
}

// ── Public: build one tenant's structure ────────────────────

export async function buildTenantStructure(
  db: DB,
  t: DemoTenant,
  years: number[],
  window: { firstDay: IstDay; lastDay: IstDay },
  log: Logger,
): Promise<BuiltTenant> {
  const rng = makeRng(seedFromString(t.key));

  log(`  [1/6] admin login + account`);
  const { accountId, userId, profileId } = await createOwnerAndAccount(db, t, log);

  log(`  [2/6] account configuration`);
  await configureAccount(db, t, accountId, log);

  log(`  [3/6] masters`);
  const masters = await seedMasters(db, t, accountId, userId, years, log);

  log(`  [4/6] roles + reps`);
  const { salesRoleId } = await seedRoles(db, t, accountId, profileId, log);
  const reps = await seedReps(db, t, accountId, salesRoleId, profileId, log);

  log(`  [5/6] catalogue`);
  const products = await seedCatalogue(db, t, accountId, userId, log);

  log(`  [6/6] customers`);
  const customers = await seedCustomers(db, t, accountId, reps, rng, window, log);

  return {
    tenant: t,
    accountId,
    owner: { userId, profileId },
    reps,
    customers,
    products,
    masters,
    rng,
  };
}

// ── Public: load an already-seeded tenant, read-only ────────

/**
 * Read an existing tenant's structure without writing anything.
 *
 * The nightly refresh uses this rather than `buildTenantStructure`, which is
 * idempotent but rewrites `accounts.settings` on every call — not something a
 * cron should do to a live tenant each night just to find out the account id.
 *
 * Throws if the tenant has not been seeded, so the cron fails loudly instead of
 * quietly refreshing nothing.
 */
export async function loadTenant(db: DB, t: DemoTenant): Promise<BuiltTenant> {
  const { data: adminProfile } = await db
    .from("profiles")
    .select("id, user_id, account_id")
    .eq("email", t.adminEmail)
    .maybeSingle();

  if (!adminProfile) {
    throw new Error(`demo tenant "${t.key}" is not seeded (no profile for ${t.adminEmail})`);
  }
  const accountId = adminProfile.account_id as string;

  const [profilesRes, contactsRes, productsRes, hlRes, holRes, expRes, payRes, lvRes, pipeRes] =
    await Promise.all([
      db.from("profiles").select("id, user_id, email, full_name").eq("account_id", accountId),
      db
        .from("contacts")
        .select("id, employee_id, user_id, name, company, latitude, longitude, credit_days, city, created_at")
        .eq("account_id", accountId),
      db.from("products").select("id, name, price, unit, unit_id, category").eq("account_id", accountId),
      db.from("holiday_lists").select("id, weekly_offs").eq("account_id", accountId).limit(1).maybeSingle(),
      db.from("holidays").select("holiday_date").eq("account_id", accountId),
      db.from("expense_types").select("id, expense_name, allowance_type").eq("account_id", accountId),
      db.from("payment_types").select("id, name").eq("account_id", accountId),
      db.from("leave_types").select("id, name").eq("account_id", accountId),
      db.from("pipelines").select("id").eq("account_id", accountId).limit(1).maybeSingle(),
    ]);

  // Reps are matched by their generated email, so their index — and therefore
  // their city and their performance multiplier — stays stable across runs.
  const byEmail = new Map(
    ((profilesRes.data ?? []) as any[]).map((p) => [String(p.email).toLowerCase(), p]),
  );
  const reps: DemoRep[] = [];
  REP_NAMES.forEach(({ first, full }, i) => {
    const email = repEmail(first, t.key);
    const p = byEmail.get(email);
    if (!p) return;
    reps.push({
      index: i,
      userId: p.user_id,
      profileId: p.id,
      email,
      fullName: full,
      city: t.cities[i % t.cities.length],
    });
  });
  if (reps.length === 0) throw new Error(`demo tenant "${t.key}" has no rep logins`);

  const byProfile = new Map(reps.map((r) => [r.profileId, r.index]));
  const customers: DemoCustomer[] = ((contactsRes.data ?? []) as any[]).map((c) => ({
    id: c.id,
    employeeId: c.employee_id,
    userId: c.user_id,
    repIndex: byProfile.get(c.employee_id) ?? 0,
    name: c.name,
    company: c.company,
    lat: Number(c.latitude),
    lng: Number(c.longitude),
    creditDays: c.credit_days ?? 30,
    city: c.city,
    createdAt: new Date(c.created_at),
  }));

  let stages: { id: string; name: string; position: number }[] = [];
  const pipelineId = (pipeRes.data as any)?.id ?? null;
  if (pipelineId) {
    const { data } = await db
      .from("pipeline_stages")
      .select("id, name, position")
      .eq("pipeline_id", pipelineId)
      .order("position");
    stages = (data ?? []) as any;
  }

  return {
    tenant: t,
    accountId,
    owner: { userId: adminProfile.user_id as string, profileId: adminProfile.id as string },
    reps,
    customers,
    products: ((productsRes.data ?? []) as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      price: Number(p.price),
      unit: p.unit,
      unitId: p.unit_id,
      categoryName: p.category,
    })),
    masters: {
      expenseTypeIds: ((expRes.data ?? []) as any[]).map((e) => ({
        id: e.id,
        name: e.expense_name,
        travelling: e.allowance_type === "TRAVELLING",
      })),
      paymentTypeIds: ((payRes.data ?? []) as any[]).map((p) => ({ id: p.id, name: p.name })),
      leaveTypeIds: ((lvRes.data ?? []) as any[]).map((l) => ({ id: l.id, name: l.name })),
      holidayListId: (hlRes.data as any)?.id ?? null,
      weeklyOffs: ((hlRes.data as any)?.weekly_offs as number[]) ?? [0],
      holidays: new Set<string>(
        ((holRes.data ?? []) as any[]).map((h) => String(h.holiday_date).slice(0, 10)),
      ),
      pipelineId,
      stages,
      leadStatuses: ["New", "Qualified", "Hot", "Follow-up", "Disqualified"],
      leadSources: ["Facebook", "Instagram", "Google Ads", "Referral", "IndiaMart", "Walk-in"],
      leadIndustries: ["Residential", "Commercial", "Builder / Contractor", "Institutional"],
    },
    rng: makeRng(seedFromString(`${t.key}-refresh`)),
  };
}

// ── Public: quiet the credit triggers while bulk-loading ────

/**
 * Flip the two credit enforcements to `ignore` for the duration of a bulk load,
 * then back to `warn`.
 *
 * `enforce_order_credit_limit` defaults to `warn`, which does not block the
 * insert — but it writes a `module_activities` row for every order that takes a
 * customer past their limit or is placed while they are overdue. Across a
 * 12-month backfill that is thousands of warning rows, because a year of
 * accumulated closed orders outgrows any sane credit limit. `ignore` returns
 * early and writes nothing.
 *
 * Restored to `warn` afterwards so the finished tenant behaves like a real one
 * and the credit features still demo.
 */
export async function setBulkLoadMode(db: DB, accountId: string, on: boolean): Promise<void> {
  const acct = await must(
    "read account settings",
    db.from("accounts").select("settings").eq("id", accountId).single() as any,
  );
  const settings = ((acct as any).settings ?? {}) as Record<string, any>;
  const mode = on ? "ignore" : "warn";

  await must(
    "set bulk-load mode",
    db
      .from("accounts")
      .update({
        settings: {
          ...settings,
          payment_settings: {
            ...(settings.payment_settings ?? {}),
            credit_days_enforcement: mode,
            credit_limit_enforcement: mode,
          },
        },
      })
      .eq("id", accountId)
      .select("id") as any,
  );
}

// ── Public: clear the noise the seed itself generated ───────

/**
 * Every contact / order / payment insert fires automation and notification
 * triggers. Nothing has subscribed — no devices, no automations — but leaving
 * tens of thousands of queued rows would bury the admin's notification centre
 * on first login.
 */
export async function clearSeedNoise(db: DB, accountId: string, log?: Logger): Promise<void> {
  for (const table of ["automation_events", "notification_outbox", "notifications"]) {
    const { error, count } = await db
      .from(table)
      .delete({ count: "exact" })
      .eq("account_id", accountId);
    if (error) log?.(`    ! could not clear ${table}: ${error.message}`);
    else if (count) log?.(`    cleared ${count} ${table} rows`);
  }
}

// ── Public: teardown ────────────────────────────────────────

export async function teardownTenant(db: DB, t: DemoTenant, log: Logger): Promise<boolean> {
  const { data: profile } = await db
    .from("profiles")
    .select("account_id")
    .eq("email", t.adminEmail)
    .maybeSingle();

  if (!profile) {
    log(`  ${t.key}: no account found for ${t.adminEmail}. Nothing to tear down.`);
    return false;
  }

  const accountId = profile.account_id as string;
  const acct = await must(
    "read account",
    db.from("accounts").select("name, customer_id").eq("id", accountId).single() as any,
  );

  log(`  ${t.key}: tearing down "${(acct as any).name}" (Customer ID ${(acct as any).customer_id})`);

  const profiles = await must(
    "read profiles",
    db.from("profiles").select("user_id").eq("account_id", accountId) as any,
  );
  const userIds = (profiles as any[]).map((p) => p.user_id as string);

  // Order matters, and the obvious order is wrong.
  //
  // Deleting the auth users first fails: the admin is `approved_by` on hundreds
  // of expenses, leaves and payments, and those foreign keys do not cascade
  // from auth.users. Postgres refuses, and the login survives as an orphan that
  // then blocks re-creating the tenant with the same email.
  //
  // Deleting the account first cascades all of that business data away (and the
  // profiles with it), after which the auth users have nothing pointing at them
  // and delete cleanly.
  const { error: delErr } = await db.from("accounts").delete().eq("id", accountId);
  if (delErr) throw new Error(`account delete failed: ${delErr.message}`);
  log(`    deleted account row (child data cascades)`);

  let deleted = 0;
  for (const userId of userIds) {
    const { error } = await db.auth.admin.deleteUser(userId);
    if (error) log(`    ! could not delete auth user ${userId}: ${error.message}`);
    else deleted++;
  }
  log(`    deleted ${deleted}/${userIds.length} logins`);
  return true;
}

/**
 * Delete auth users that carry a demo email but no longer have a profile.
 *
 * An auth login with no profile is invisible to every normal query, but it
 * still owns the email — so the next build fails to create that login and the
 * tenant comes out without an admin. Teardown sweeps these so a failed run
 * cannot leave the next one broken.
 *
 * Only ever touches the exact demo addresses passed in.
 */
export async function purgeOrphanDemoLogins(
  db: DB,
  emails: string[],
  log: Logger,
): Promise<number> {
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  const orphans: { id: string; email: string }[] = [];

  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      log(`    ! could not list auth users: ${error.message}`);
      break;
    }
    const users = data?.users ?? [];
    for (const u of users) {
      const email = (u.email ?? "").toLowerCase();
      if (wanted.has(email)) orphans.push({ id: u.id, email });
    }
    if (users.length < 200) break;
  }

  if (orphans.length === 0) return 0;

  // Keep only the ones with no profile — the rest belong to a live tenant.
  const { data: profiles } = await db
    .from("profiles")
    .select("user_id")
    .in(
      "user_id",
      orphans.map((o) => o.id),
    );
  const hasProfile = new Set(((profiles ?? []) as any[]).map((p) => p.user_id as string));

  let purged = 0;
  for (const o of orphans) {
    if (hasProfile.has(o.id)) continue;
    const { error } = await db.auth.admin.deleteUser(o.id);
    if (error) log(`    ! could not delete orphan login ${o.email}: ${error.message}`);
    else {
      log(`    purged orphan login ${o.email}`);
      purged++;
    }
  }
  return purged;
}
