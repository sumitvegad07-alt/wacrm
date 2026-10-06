// ============================================================
// Seed the Google Play closed-testing tenant.
//
//   node scripts/seed-playconsole-test-account.mjs            (dry run — prints the plan)
//   node scripts/seed-playconsole-test-account.mjs --apply    (writes to the DB)
//   node scripts/seed-playconsole-test-account.mjs --teardown (deletes the tenant)
//
// Builds one complete, realistic tenant so Play Console testers (and Google's
// own reviewer) can exercise the Android app end to end: customers, products,
// visits, order booking, payment collection, expenses, leaves, attendance and
// location tracking.
//
// Shape:
//   1 owner/admin login + 20 "Sales Executive" logins (mobile-only, the stock
//   role that provision-account seeds), 5 product categories, 25 products, and
//   30–40 customers DIRECTLY assigned to each rep (contacts.employee_id), one
//   Indian city per rep so maps and routes look sensible.
//
// This mirrors src/app/api/provision-account/route.ts rather than calling it,
// because that route needs a logged-in admin session. Two deliberate
// differences from the route:
//   * territory_settings.assignment_mode is 'direct', not 'area_wise'
//   * accounts.is_provisioned is set true, so the dashboard shell does NOT
//     re-provision on first web login and overwrite that back to 'area_wise'
//
// Deterministic: the same seed produces the same names, phones and coordinates,
// so a teardown + re-run reproduces the tenant exactly.
//
// Idempotent: every phase checks for what it already created. Safe to re-run
// after a partial failure.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function loadEnv(file) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv('.env.local');
loadEnv('.env');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.service_role;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const TEARDOWN = process.argv.includes('--teardown');

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Tenant constants ────────────────────────────────────────

const ADMIN_EMAIL = 'testplayconsole@gmail.com'; // Gmail folds case; stored lowercase
const ADMIN_NAME = 'Play Console Admin';
const ACCOUNT_NAME = 'Play Console';
const PASSWORD = '123456';
const PLAN = 'CRM_SFA';
const REP_COUNT = 20;
const EXPIRES_AT = '2027-12-31T00:00:00+00:00';
const USER_SEATS = 25; // 21 logins + headroom

// ── Deterministic PRNG (mulberry32) ─────────────────────────

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261006);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// ── Name pools ──────────────────────────────────────────────

const REP_NAMES = [
  'Rahul Mehta', 'Priya Sharma', 'Amit Patel', 'Sneha Deshmukh', 'Vikram Singh',
  'Kavita Joshi', 'Rohit Kulkarni', 'Anjali Nair', 'Suresh Reddy', 'Deepa Iyer',
  'Manish Agarwal', 'Pooja Chauhan', 'Arjun Rao', 'Nisha Verma', 'Karan Thakkar',
  'Shweta Pandey', 'Imran Shaikh', 'Meera Pillai', 'Sandeep Yadav', 'Ritu Bansal',
];

const FIRST_NAMES = [
  'Aarav', 'Aditya', 'Akash', 'Alok', 'Amar', 'Anand', 'Aniket', 'Ankit', 'Arun', 'Ashish',
  'Bhavesh', 'Chetan', 'Dhaval', 'Dinesh', 'Gaurav', 'Girish', 'Harsh', 'Hemant', 'Jatin', 'Jignesh',
  'Kalpesh', 'Kaushik', 'Kiran', 'Lalit', 'Mahesh', 'Mayur', 'Mukesh', 'Naresh', 'Nikhil', 'Nilesh',
  'Paresh', 'Pankaj', 'Pravin', 'Rajesh', 'Rakesh', 'Ramesh', 'Ravi', 'Sachin', 'Sagar', 'Sanjay',
  'Shailesh', 'Shirish', 'Sunil', 'Tarun', 'Tushar', 'Umesh', 'Vinod', 'Vishal', 'Yogesh', 'Zahir',
  'Anita', 'Asha', 'Bhavna', 'Chetna', 'Divya', 'Geeta', 'Hema', 'Jyoti', 'Kirti', 'Lata',
  'Madhuri', 'Namrata', 'Neha', 'Payal', 'Rekha', 'Sarita', 'Seema', 'Shilpa', 'Trupti', 'Vandana',
];

const LAST_NAMES = [
  'Shah', 'Patel', 'Mehta', 'Desai', 'Trivedi', 'Pandya', 'Joshi', 'Bhatt', 'Vyas', 'Dave',
  'Thakkar', 'Parekh', 'Gandhi', 'Kapadia', 'Soni', 'Chokshi', 'Modi', 'Doshi', 'Jain', 'Agarwal',
  'Gupta', 'Sharma', 'Verma', 'Yadav', 'Mishra', 'Tiwari', 'Pandey', 'Singh', 'Chauhan', 'Rathod',
  'Kulkarni', 'Deshmukh', 'Jadhav', 'Patil', 'Shinde', 'Pawar', 'Gaikwad', 'More',
  'Reddy', 'Rao', 'Naidu', 'Nair', 'Menon', 'Pillai', 'Iyer',
];

const FIRM_PREFIX = [
  'Shree', 'Shri', 'New', 'Jai', 'Krishna', 'Ganesh', 'Laxmi', 'Sai', 'Balaji', 'Mahavir',
  'Arihant', 'Vardhman', 'Hari', 'Om', 'Gayatri', 'Tirupati', 'Ambika', 'Durga', 'Shakti', 'Surya',
  'Chandra', 'Ratna', 'Swastik', 'Vishwa', 'Bharat', 'Deep', 'Jyot', 'Kamal', 'Navkar', 'Pushpa',
  'Rajdhani', 'Sagar', 'Sangam', 'Satyam', 'Shubh', 'Siddhi', 'Umiya', 'Vijay', 'Yash', 'Anmol',
];

const FIRM_KIND = [
  'Provision Stores', 'Super Market', 'Kirana Stores', 'Trading Company', 'Enterprise',
  'Agency', 'Distributors', 'Traders', 'General Stores', 'Marketing',
  'Sales Corporation', 'Mart',
];

const FIRM_SUFFIX = ['', '', '', ' Pvt Ltd', ' & Sons', ' & Co'];

// ── Cities: one per rep. Real coordinates; customers scatter around them. ──

const CITIES = [
  { city: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714, pin: '3800', areas: ['Maninagar', 'Navrangpura', 'Satellite', 'Bapunagar', 'Vastrapur'] },
  { city: 'Surat', state: 'Gujarat', lat: 21.1702, lng: 72.8311, pin: '3950', areas: ['Adajan', 'Varachha', 'Katargam', 'Athwa', 'Udhna'] },
  { city: 'Vadodara', state: 'Gujarat', lat: 22.3072, lng: 73.1812, pin: '3900', areas: ['Alkapuri', 'Gotri', 'Manjalpur', 'Karelibaug', 'Sayajigunj'] },
  { city: 'Rajkot', state: 'Gujarat', lat: 22.3039, lng: 70.8022, pin: '3600', areas: ['Kalawad Road', 'Gondal Road', 'University Road', 'Mavdi', 'Raiya Road'] },
  { city: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777, pin: '4000', areas: ['Andheri East', 'Borivali', 'Dadar', 'Ghatkopar', 'Malad West'] },
  { city: 'Pune', state: 'Maharashtra', lat: 18.5204, lng: 73.8567, pin: '4110', areas: ['Kothrud', 'Hadapsar', 'Shivajinagar', 'Wakad', 'Kondhwa'] },
  { city: 'Nashik', state: 'Maharashtra', lat: 19.9975, lng: 73.7898, pin: '4220', areas: ['Panchavati', 'Satpur', 'Nashik Road', 'Indira Nagar', 'Gangapur Road'] },
  { city: 'Nagpur', state: 'Maharashtra', lat: 21.1458, lng: 79.0882, pin: '4400', areas: ['Dharampeth', 'Sadar', 'Manish Nagar', 'Wardha Road', 'Itwari'] },
  { city: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lng: 75.8577, pin: '4520', areas: ['Vijay Nagar', 'Palasia', 'Rau', 'Sudama Nagar', 'Annapurna'] },
  { city: 'Bhopal', state: 'Madhya Pradesh', lat: 23.2599, lng: 77.4126, pin: '4620', areas: ['Arera Colony', 'Kolar Road', 'MP Nagar', 'Bairagarh', 'Hoshangabad Road'] },
  { city: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873, pin: '3020', areas: ['Malviya Nagar', 'Vaishali Nagar', 'Mansarovar', 'Jhotwara', 'Tonk Road'] },
  { city: 'Jodhpur', state: 'Rajasthan', lat: 26.2389, lng: 73.0243, pin: '3420', areas: ['Sardarpura', 'Shastri Nagar', 'Ratanada', 'Mandore', 'Pal Road'] },
  { city: 'New Delhi', state: 'Delhi', lat: 28.6139, lng: 77.209, pin: '1100', areas: ['Karol Bagh', 'Rohini', 'Lajpat Nagar', 'Dwarka', 'Pitampura'] },
  { city: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467, lng: 80.9462, pin: '2260', areas: ['Gomti Nagar', 'Hazratganj', 'Alambagh', 'Indira Nagar', 'Aliganj'] },
  { city: 'Kanpur', state: 'Uttar Pradesh', lat: 26.4499, lng: 80.3319, pin: '2080', areas: ['Swaroop Nagar', 'Govind Nagar', 'Kidwai Nagar', 'Kalyanpur', 'Civil Lines'] },
  { city: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946, pin: '5600', areas: ['Jayanagar', 'Indiranagar', 'Rajajinagar', 'Whitefield', 'Basavanagudi'] },
  { city: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867, pin: '5000', areas: ['Kukatpally', 'Begumpet', 'Dilsukhnagar', 'Ameerpet', 'Secunderabad'] },
  { city: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707, pin: '6000', areas: ['T Nagar', 'Anna Nagar', 'Velachery', 'Adyar', 'Tambaram'] },
  { city: 'Kochi', state: 'Kerala', lat: 9.9312, lng: 76.2673, pin: '6820', areas: ['Kakkanad', 'Edappally', 'Fort Kochi', 'Vyttila', 'Aluva'] },
  { city: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639, pin: '7000', areas: ['Salt Lake', 'Behala', 'Howrah', 'Garia', 'Dum Dum'] },
];

const STREETS = [
  'Main Road', 'Market Road', 'Station Road', 'Bazaar Street', 'Ring Road',
  'Shop No 4, Shanti Complex', 'Shop No 12, Krishna Plaza', 'Ground Floor, Sai Arcade',
  'Near Bus Stand', 'Opp. Post Office', 'Shop No 7, Gokul Shopping Centre',
];

// ── Catalogue: 5 categories x 5 products ────────────────────

const CATALOGUE = [
  {
    category: 'Beverages',
    products: [
      ['Mango Fruit Drink 200ml', 10, 'Pieces'],
      ['Orange Fruit Drink 200ml', 10, 'Pieces'],
      ['Lemon Soda 300ml', 20, 'Pieces'],
      ['Packaged Drinking Water 1L', 20, 'Pieces'],
      ['Cola Soft Drink 750ml', 40, 'Pieces'],
    ],
  },
  {
    category: 'Snacks & Namkeen',
    products: [
      ['Masala Potato Chips 50g', 20, 'Pieces'],
      ['Salted Potato Chips 50g', 20, 'Pieces'],
      ['Aloo Bhujia 200g', 55, 'Pieces'],
      ['Mixture Namkeen 400g', 95, 'Pieces'],
      ['Roasted Peanuts 150g', 45, 'Pieces'],
    ],
  },
  {
    category: 'Biscuits & Bakery',
    products: [
      ['Glucose Biscuits 100g', 10, 'Pieces'],
      ['Marie Biscuits 200g', 35, 'Pieces'],
      ['Cream Sandwich Biscuits 120g', 25, 'Pieces'],
      ['Salted Crackers 150g', 30, 'Pieces'],
      ['Rusk Toast 300g', 50, 'Pieces'],
    ],
  },
  {
    category: 'Personal Care',
    products: [
      ['Herbal Shampoo 180ml', 110, 'Pieces'],
      ['Sandal Bath Soap 100g', 40, 'Pieces'],
      ['Toothpaste 100g', 60, 'Pieces'],
      ['Coconut Hair Oil 200ml', 85, 'Pieces'],
      ['Body Lotion 100ml', 95, 'Pieces'],
    ],
  },
  {
    category: 'Home Care',
    products: [
      ['Detergent Powder 1kg', 120, 'Pieces'],
      ['Dishwash Bar 150g', 20, 'Pieces'],
      ['Floor Cleaner 500ml', 90, 'Pieces'],
      ['Toilet Cleaner 500ml', 85, 'Pieces'],
      ['Phenyl 1L', 70, 'Pieces'],
    ],
  },
];

const UNIT_NAMES = [
  ['Pieces', 'Pcs'],
  ['Box', 'Box'],
  ['Case', 'Case'],
  ['Kilograms', 'Kg'],
  ['Litre', 'Ltr'],
];

// ── Helpers ─────────────────────────────────────────────────

function die(msg, err) {
  console.error(`\n✗ ${msg}`);
  if (err) console.error(err.message || err);
  process.exit(1);
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) die(`${label} failed`, error);
  return data;
}

function log(msg) {
  console.log(msg);
}

/** Unique-value generator backed by a Set, so no DB unique index can bite. */
function uniqueMaker(build) {
  const seen = new Set();
  return () => {
    for (let i = 0; i < 2000; i++) {
      const v = build(i);
      const k = v.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        return v;
      }
    }
    die('could not generate a unique value after 2000 attempts');
  };
}

// ── Teardown ────────────────────────────────────────────────

async function teardown() {
  const { data: acct } = await db
    .from('accounts')
    .select('id, name, customer_id')
    .eq('name', ACCOUNT_NAME)
    .maybeSingle();

  if (!acct) {
    log(`No account named "${ACCOUNT_NAME}" found. Nothing to tear down.`);
    return;
  }

  log(`Tearing down "${acct.name}" (Customer ID ${acct.customer_id}, ${acct.id})`);

  const profiles = await must(
    'read profiles',
    db.from('profiles').select('user_id').eq('account_id', acct.id),
  );

  // Deleting the auth users cascades the profiles; the account row then goes
  // last so nothing is left orphaned.
  for (const p of profiles ?? []) {
    const { error } = await db.auth.admin.deleteUser(p.user_id);
    if (error) console.warn(`  ! could not delete auth user ${p.user_id}: ${error.message}`);
  }
  log(`  deleted ${profiles?.length ?? 0} logins`);

  const { error: delErr } = await db.from('accounts').delete().eq('id', acct.id);
  if (delErr) die('account delete failed', delErr);
  log('  deleted account row (child data cascades)');
  log('\n✓ Teardown complete.');
}

// ── Phase 1: owner login + account ──────────────────────────

async function createOwnerAndAccount() {
  // An existing profile with this email means the tenant is already (partly) built.
  const { data: existing } = await db
    .from('profiles')
    .select('id, user_id, account_id')
    .eq('email', ADMIN_EMAIL)
    .maybeSingle();

  if (existing) {
    log(`  owner login already exists (account ${existing.account_id})`);
    return { userId: existing.user_id, profileId: existing.id, accountId: existing.account_id };
  }

  // handle_new_user reads this metadata to mint the account, the Customer ID,
  // the owner profile and the plan's module_settings in one shot.
  const { data: created, error: authErr } = await db.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: ADMIN_NAME,
      company_name: ACCOUNT_NAME,
      plan: PLAN,
      sales_users: REP_COUNT,
    },
  });
  if (authErr) die('owner auth user creation failed', authErr);
  const userId = created.user.id;

  // handle_new_user swallows its own errors (EXCEPTION WHEN OTHERS -> RETURN NEW),
  // so a missing profile here means the trigger failed silently. Check, do not assume.
  const { data: profile } = await db
    .from('profiles')
    .select('id, account_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!profile) {
    die(
      'handle_new_user did not create a profile/account for the owner. ' +
        `Auth user ${userId} now exists with no tenant — delete it before re-running.`,
    );
  }

  log(`  created owner login + account ${profile.account_id}`);
  return { userId, profileId: profile.id, accountId: profile.account_id };
}

// ── Phase 2: account configuration ──────────────────────────

async function configureAccount(accountId, ownerUserId) {
  const acct = await must(
    'read account',
    db.from('accounts').select('settings').eq('id', accountId).single(),
  );
  const prev = acct.settings ?? {};

  const settings = {
    ...prev,
    task_types: ['Task', 'Call', 'Visit', 'Meeting', 'Follow up', 'Note'],

    // Fencing OFF. Testers are scattered and nowhere near these customers; a
    // live fence would block every visit check-in and punch, which is the one
    // thing the closed test has to prove works.
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
      customer_unique_key: 'name',
      product_unique_key: 'name',
      multi_unit_enabled: false,
    },

    order_settings: {
      ...(prev.order_settings ?? {}),
      tax_mode: 'exclusive',
      discount_mode: 'item',
      hierarchy_enabled: false,
      enforce_price_floor: false,
      amount_discount_basis: 'entered',
      allow_discount_over_price_list: false,
    },

    // One flat category level: five categories, nothing nested.
    product_settings: {
      levels_count: 1,
      level_1_name: 'Category',
      level_2_name: 'Sub-Category',
      level_3_name: 'Brand',
    },

    // Location tracking on, 10-minute pings, Mon–Sat. Shift times do not gate
    // tracking — a punched-in rep is tracked at any hour — so a tester in any
    // time zone still produces a trail.
    tracking_settings: {
      enabled: true,
      start_time: '09:30',
      end_time: '18:30',
      working_days: [1, 2, 3, 4, 5, 6],
      grace_minutes: 15,
      interval_minutes: 10,
    },

    // Direct customer assignment: contacts carry employee_id, and the customer
    // form does not demand a territory.
    territory_settings: {
      levels: [
        { position: 1, name: 'Country', enabled: true },
        { position: 2, name: 'State', enabled: true },
        { position: 3, name: 'City', enabled: true },
        { position: 4, name: 'Area', enabled: false },
        { position: 5, name: 'Sub Area', enabled: false },
      ],
      assignment_mode: 'direct',
    },
    assignment_mode: 'direct', // legacy top-level key, still read in places

    // Deliberately lenient so a tester can record a payment without hunting for
    // a reference number, a photo or an approver.
    payment_settings: {
      require_notes: false,
      require_reference: false,
      require_attachment: false,
      approval_required: false,
      enable_credit_limit: true,
      enable_credit_days: true,
      credit_days_enforcement: 'warn',
    },

    outstanding_settings: {
      order_statuses: ['Closed'],
      payment_statuses: ['Approved'],
    },

    whatsapp_settings: { default_country_code: '+91' },

    company_profile: {
      ...(prev.company_profile ?? {}),
      name: ACCOUNT_NAME,
      registered_email: ADMIN_EMAIL,
      contact_person_name: ADMIN_NAME,
      city: 'Ahmedabad',
      state: 'Gujarat',
      country: 'India',
      gst_enabled: false,
      hsn_enabled: false,
    },
  };

  // CRM_SFA with the opt-in extras left off: Beat Planning (route), Scheme,
  // Stock and User Hierarchy all ship off, same as a real signup. FSM's
  // `service` module is not built, so it stays off too.
  const moduleSettings = {
    whatsapp: true,
    quotation: true,
    expense: true,
    territory: true,
    dispatch: true,
    pending_dispatch: true,
    payment: true,
    route: false,
    reporting_hierarchy: false,
    scheme: false,
    stock: false,
    service: false,
  };

  await must(
    'account configuration',
    db
      .from('accounts')
      .update({
        name: ACCOUNT_NAME,
        industry: 'General',
        subscription_plan: PLAN,
        subscription_status: 'active',
        subscription_expires_at: EXPIRES_AT,
        user_count: USER_SEATS,
        default_currency: 'INR',
        require_odometer: false,
        settings,
        module_settings: moduleSettings,
        // True so the dashboard shell does not run provision-account on first
        // web login and reset assignment_mode back to 'area_wise'.
        is_provisioned: true,
      })
      .eq('id', accountId),
  );
  log(`  plan ${PLAN}, ${USER_SEATS} seats, expires ${EXPIRES_AT.slice(0, 10)}, direct assignment`);
}

// ── Phase 3: masters (mirrors provision-account) ────────────

/** Insert rows only if the table is empty for this account. */
async function seedOnce(table, label, rows) {
  const { count } = await db
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('account_id', rows[0].account_id);
  if (count && count > 0) {
    log(`  ${label}: already seeded (${count})`);
    return;
  }
  await must(`${label} insert`, db.from(table).insert(rows));
  log(`  ${label}: ${rows.length}`);
}

async function seedMasters(accountId, ownerUserId) {
  const a = accountId;

  // Pipeline + stages. "New" first and "Won/Lost" last are the fixed bookends.
  const { count: pipeCount } = await db
    .from('pipelines')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', a);
  if (!pipeCount) {
    const pipeline = await must(
      'pipeline insert',
      db.from('pipelines').insert({ account_id: a, user_id: ownerUserId, name: 'Sales Pipeline' }).select('id').single(),
    );
    await must(
      'pipeline stages insert',
      db.from('pipeline_stages').insert([
        { pipeline_id: pipeline.id, name: 'New', position: 0, color: '#3b82f6' },
        { pipeline_id: pipeline.id, name: 'Contacted', position: 1, color: '#6366f1' },
        { pipeline_id: pipeline.id, name: 'Follow-up', position: 2, color: '#eab308' },
        { pipeline_id: pipeline.id, name: 'Quotation Sent', position: 3, color: '#f97316' },
        { pipeline_id: pipeline.id, name: 'Won/Lost', position: 4, color: '#64748b' },
      ]),
    );
    log('  pipeline + 5 stages');
  } else {
    log(`  pipeline: already seeded (${pipeCount})`);
  }

  await seedOnce('tags', 'tags', [
    { account_id: a, user_id: ownerUserId, name: 'Hot', color: '#ef4444' },
    { account_id: a, user_id: ownerUserId, name: 'Warm', color: '#f59e0b' },
    { account_id: a, user_id: ownerUserId, name: 'Cold', color: '#3b82f6' },
  ]);

  await seedOnce('lead_statuses', 'lead statuses', [
    { account_id: a, name: 'New', color: '#3b82f6', position: 0 },
    { account_id: a, name: 'Qualified', color: '#8b5cf6', position: 1 },
    { account_id: a, name: 'Hot', color: '#ef4444', position: 2 },
    { account_id: a, name: 'Follow-up', color: '#eab308', position: 3 },
    { account_id: a, name: 'Disqualified', color: '#6b7280', position: 4 },
  ]);

  await seedOnce('lead_sources', 'lead sources', [
    { account_id: a, name: 'Facebook', color: '#1877f2', position: 0 },
    { account_id: a, name: 'Instagram', color: '#e1306c', position: 1 },
    { account_id: a, name: 'Google Ads', color: '#34a853', position: 2 },
    { account_id: a, name: 'Cold Call', color: '#f59e0b', position: 3 },
    { account_id: a, name: 'IndiaMart', color: '#ef4444', position: 4 },
  ]);

  await seedOnce('lead_industries', 'lead industries', [
    { account_id: a, name: 'Agriculture', color: '#22c55e', position: 0 },
    { account_id: a, name: 'Garment', color: '#8b5cf6', position: 1 },
    { account_id: a, name: 'Manufacturing', color: '#3b82f6', position: 2 },
    { account_id: a, name: 'Pharma', color: '#06b6d4', position: 3 },
  ]);

  await seedOnce('leave_types', 'leave types', [
    { account_id: a, name: 'Casual Leave', status: 'Active', created_by: ownerUserId },
    { account_id: a, name: 'Medical Leave', status: 'Active', created_by: ownerUserId },
    { account_id: a, name: 'Maternity Leave', status: 'Active', created_by: ownerUserId },
  ]);

  // Sunday off. is_default so every Sales Executive inherits it and attendance
  // works without the admin creating a list first.
  await seedOnce('holiday_lists', 'holiday list', [
    {
      account_id: a,
      name: 'Default Holiday List',
      weekly_offs: [0],
      is_default: true,
      created_by: ownerUserId,
    },
  ]);

  await seedOnce('expense_types', 'expense types', [
    { account_id: a, allowance_type: 'REGULAR', expense_name: 'Food', created_by: ownerUserId },
    { account_id: a, allowance_type: 'REGULAR', expense_name: 'Hotel', created_by: ownerUserId },
    { account_id: a, allowance_type: 'TRAVELLING', expense_name: 'Travel by Bike', created_by: ownerUserId },
    { account_id: a, allowance_type: 'TRAVELLING', expense_name: 'Travel by Car', created_by: ownerUserId },
  ]);

  // requires_reference false across the board: a tester should not need a UTR
  // number to prove payment collection works.
  await seedOnce('payment_types', 'payment types', [
    { account_id: a, name: 'Cash', requires_reference: false, position: 0 },
    { account_id: a, name: 'UPI', requires_reference: false, position: 1 },
    { account_id: a, name: 'Bank Transfer', requires_reference: false, position: 2 },
    { account_id: a, name: 'Cheque', requires_reference: false, position: 3 },
  ]);

  await seedOnce(
    'product_units',
    'product units',
    UNIT_NAMES.map(([name, short]) => ({
      account_id: a,
      name,
      short_name: short,
      is_active: true,
    })),
  );
}

// ── Phase 4: roles ──────────────────────────────────────────

/**
 * The stock Sales Executive permission set for a CRM+SFA plan, copied from
 * provision-account's plan-aware branch with lines.wfa and lines.sfa both true.
 * web_access false keeps the rep on the Android app only.
 */
const SALES_EXEC_PERMISSIONS = {
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

  // WFA line
  view_expenses: true,
  create_expenses: true,
  view_visits: true,
  mobile_visit_checkin: true,
  view_location_tracking: true,
  view_expense_reports: true,
  view_field_reports: true,

  // SFA line
  view_orders: true,
  create_orders: true,
  view_payments: true,
  create_payments: true,
  view_payment_attachments: true,
  view_payment_reports: true,
  view_customer_outstanding: true,
  view_sales_reports: true,
  view_ageing_reports: true,
};

async function seedRoles(accountId, ownerProfileId) {
  const existing = await must(
    'read roles',
    db.from('employee_roles').select('id, name').eq('account_id', accountId),
  );
  const byName = new Map((existing ?? []).map((r) => [r.name, r.id]));

  let adminRoleId = byName.get('Admin');
  if (!adminRoleId) {
    const row = await must(
      'Admin role insert',
      db
        .from('employee_roles')
        .insert({
          account_id: accountId,
          name: 'Admin',
          description: 'Full administrative access',
          permissions: { all: true },
        })
        .select('id')
        .single(),
    );
    adminRoleId = row.id;
    log('  role: Admin');
  } else {
    log('  role: Admin (exists)');
  }

  let salesRoleId = byName.get('Sales Executive');
  if (!salesRoleId) {
    const row = await must(
      'Sales Executive role insert',
      db
        .from('employee_roles')
        .insert({
          account_id: accountId,
          name: 'Sales Executive',
          description: 'Mobile-only field sales rep — sell, collect, visit and report from the app.',
          status: 'active',
          permissions: SALES_EXEC_PERMISSIONS,
        })
        .select('id')
        .single(),
    );
    salesRoleId = row.id;
    log('  role: Sales Executive');
  } else {
    log('  role: Sales Executive (exists)');
  }

  await must(
    'owner role assignment',
    db
      .from('profiles')
      .update({
        employee_role_id: adminRoleId,
        full_name: ADMIN_NAME,
        designation: 'Administrator',
        department: 'Management',
        employee_code: 'ADM-001',
        status: 'active',
        web_access: true,
        mobile_access: true,
      })
      .eq('id', ownerProfileId),
  );

  return { adminRoleId, salesRoleId };
}

// ── Phase 5: the 20 sales reps ──────────────────────────────

async function seedReps(accountId, salesRoleId, ownerProfileId) {
  const reps = [];

  for (let i = 1; i <= REP_COUNT; i++) {
    const email = `test${i}@gmail.com`;
    const fullName = REP_NAMES[i - 1];

    const { data: existing } = await db
      .from('profiles')
      .select('id, user_id')
      .eq('account_id', accountId)
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      reps.push({ ...existing, email, fullName, index: i });
      continue;
    }

    // member_of_account tells handle_new_user this login belongs to an existing
    // tenant, so it must NOT mint a second account + Customer ID.
    const { data: created, error } = await db.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName, member_of_account: accountId },
    });
    if (error) die(`auth user ${email} creation failed`, error);

    const profile = await must(
      `profile ${email} upsert`,
      db
        .from('profiles')
        .upsert(
          {
            user_id: created.user.id,
            email,
            full_name: fullName,
            account_id: accountId,
            account_role: 'agent',
            employee_role_id: salesRoleId,
            employee_code: `EMP-${String(i).padStart(3, '0')}`,
            mobile: `+9188${String(10000000 + i).slice(-8)}`,
            department: 'Sales',
            designation: 'Sales Executive',
            status: 'active',
            // Mirrors the role: mobile-only, so the app is the only way in.
            web_access: false,
            mobile_access: true,
            default_approver_id: ownerProfileId,
          },
          { onConflict: 'user_id' },
        )
        .select('id, user_id')
        .single(),
    );

    reps.push({ ...profile, email, fullName, index: i });
  }

  log(`  reps: ${reps.length} (${REP_COUNT} expected)`);
  return reps;
}

// ── Phase 6: catalogue ──────────────────────────────────────

async function seedCatalogue(accountId, ownerUserId) {
  const { count: prodCount } = await db
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId);
  if (prodCount && prodCount > 0) {
    log(`  products: already seeded (${prodCount})`);
    return;
  }

  const units = await must(
    'read units',
    db.from('product_units').select('id, name').eq('account_id', accountId),
  );
  const unitByName = new Map((units ?? []).map((u) => [u.name, u.id]));

  const catRows = CATALOGUE.map((c) => ({
    account_id: accountId,
    name: c.category,
    level: 1,
    parent_id: null,
    active: true,
    is_active: true,
  }));
  const cats = await must(
    'categories insert',
    db.from('product_categories').insert(catRows).select('id, name'),
  );
  const catByName = new Map(cats.map((c) => [c.name, c.id]));
  log(`  categories: ${cats.length}`);

  const products = [];
  let sku = 1;
  for (const group of CATALOGUE) {
    for (const [name, price, unit] of group.products) {
      products.push({
        account_id: accountId,
        user_id: ownerUserId,
        name,
        sku: `SKU-${String(sku).padStart(3, '0')}`,
        description: `${group.category} — ${name}`,
        price,
        // 10% below list, so discounting has somewhere to go even though the
        // price floor is not enforced on this tenant.
        min_price: Math.round(price * 0.9 * 100) / 100,
        category: group.category,
        category_id: catByName.get(group.category),
        unit,
        unit_id: unitByName.get(unit) ?? null,
        // Stock module is off for this tenant, so nothing tracks a ledger.
        track_stock: false,
        active: true,
      });
      sku++;
    }
  }
  await must('products insert', db.from('products').insert(products));
  log(`  products: ${products.length}`);
}

// ── Phase 7: customers, 30–40 directly assigned per rep ─────

async function seedCustomers(accountId, reps) {
  const { count: existingCount } = await db
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId);
  if (existingCount && existingCount > 0) {
    log(`  customers: already seeded (${existingCount})`);
    return existingCount;
  }

  // contacts.name is the account's duplicate key and phone_normalized carries a
  // unique index, so both have to be globally unique inside this tenant.
  const personName = uniqueMaker(() => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`);
  const firmName = uniqueMaker(
    () => `${pick(FIRM_PREFIX)} ${pick(FIRM_KIND)}${pick(FIRM_SUFFIX)}`,
  );

  let phoneSeq = 0;
  const nextPhone = () => {
    phoneSeq++;
    // 98 + a 8-digit counter: always 10 digits, never collides.
    return `+9198${String(10000000 + phoneSeq).slice(-8)}`;
  };

  let codeSeq = 0;
  const rows = [];

  reps.forEach((rep, idx) => {
    const city = CITIES[idx % CITIES.length];
    const howMany = between(30, 40);

    for (let n = 0; n < howMany; n++) {
      codeSeq++;
      const company = firmName();
      const contactPerson = personName();
      const area = pick(city.areas);
      const phone = nextPhone();

      // ~8 km box around the city centre: close enough to cluster on a map,
      // far enough apart to look like a real beat.
      const lat = +(city.lat + (rand() - 0.5) * 0.08).toFixed(6);
      const lng = +(city.lng + (rand() - 0.5) * 0.08).toFixed(6);

      rows.push({
        account_id: accountId,
        user_id: rep.user_id, // the rep "owns" the record
        employee_id: rep.id, // direct assignment — profiles.id, not the auth uid
        company,
        name: contactPerson,
        phone,
        whatsapp: phone,
        email: null,
        address: `${pick(STREETS)}, ${area}`,
        area,
        city: city.city,
        state: city.state,
        country: 'India',
        pincode: `${city.pin}${String(between(1, 99)).padStart(2, '0')}`,
        latitude: lat,
        longitude: lng,
        credit_limit: between(10, 100) * 1000,
        credit_days: pick([7, 15, 21, 30, 45]),
        opening_balance: 0,
        customer_code: `CUST-${String(codeSeq).padStart(4, '0')}`,
        is_active: true,
        territory_id: null, // direct assignment: no territory needed
      });
    }
  });

  // Chunked: one 700-row insert is a single statement that fires 700 automation
  // and notification triggers, which the API gateway times out on.
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await must(
      `customers insert (rows ${i + 1}-${Math.min(i + CHUNK, rows.length)})`,
      db.from('contacts').insert(rows.slice(i, i + CHUNK)),
    );
    process.stdout.write(`\r  customers: ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
  return rows.length;
}

// ── Phase 8: clear the noise the seed itself generated ──────

async function clearSeedNoise(accountId) {
  // Every contact insert fires trg_emit_customer_created and
  // trg_notif_customer_created. Nothing has subscribed yet — no devices, no
  // automations — but leaving ~700 queued rows would bury the admin's
  // notification centre on first login.
  for (const table of ['automation_events', 'notification_outbox', 'notifications']) {
    const { error, count } = await db
      .from(table)
      .delete({ count: 'exact' })
      .eq('account_id', accountId);
    if (error) {
      console.warn(`  ! could not clear ${table}: ${error.message}`);
    } else {
      log(`  cleared ${count ?? 0} ${table} rows`);
    }
  }
}

// ── Verification ────────────────────────────────────────────

async function verify(accountId) {
  const acct = await must(
    'verify account',
    db
      .from('accounts')
      .select('name, customer_id, subscription_plan, subscription_status, subscription_expires_at, user_count, settings, module_settings, is_provisioned')
      .eq('id', accountId)
      .single(),
  );

  const counts = {};
  for (const t of ['profiles', 'contacts', 'products', 'product_categories', 'employee_roles', 'product_units', 'payment_types', 'expense_types', 'leave_types', 'holiday_lists', 'territories']) {
    const { count } = await db.from(t).select('*', { count: 'exact', head: true }).eq('account_id', accountId);
    counts[t] = count ?? 0;
  }

  console.log('\n── Verification ──────────────────────────────');
  console.log(`account              ${acct.name}  (Customer ID ${acct.customer_id})`);
  console.log(`plan                 ${acct.subscription_plan} / ${acct.subscription_status} / expires ${String(acct.subscription_expires_at).slice(0, 10)}`);
  console.log(`seats                ${acct.user_count}`);
  console.log(`assignment_mode      ${acct.settings?.territory_settings?.assignment_mode}`);
  console.log(`geo_fencing.enabled  ${acct.settings?.geo_fencing?.enabled}`);
  console.log(`tracking.enabled     ${acct.settings?.tracking_settings?.enabled}`);
  console.log(`is_provisioned       ${acct.is_provisioned}`);
  console.log(`modules on           ${Object.entries(acct.module_settings ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ')}`);
  for (const [k, v] of Object.entries(counts)) {
    console.log(`${k.padEnd(20)} ${v}`);
  }

  // Per-rep customer spread, read back from the DB rather than from the
  // in-memory plan, so the numbers are what actually landed.
  const { data: contactRows } = await db
    .from('contacts')
    .select('employee_id')
    .eq('account_id', accountId);
  const spread = new Map();
  for (const r of contactRows ?? []) spread.set(r.employee_id, (spread.get(r.employee_id) ?? 0) + 1);
  const vals = [...spread.values()];
  console.log(`\ncustomers per rep    min ${Math.min(...vals)}, max ${Math.max(...vals)}, reps covered ${spread.size}`);

  return { acct, counts };
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  console.log(`Supabase project: ${SUPABASE_URL}`);

  if (TEARDOWN) {
    if (!APPLY) {
      console.log('\nDRY RUN. Add --apply to actually delete.');
      const { data } = await db.from('accounts').select('id, name, customer_id').eq('name', ACCOUNT_NAME).maybeSingle();
      console.log(data ? `Would delete: ${data.name} (${data.customer_id})` : 'Nothing to delete.');
      return;
    }
    await teardown();
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — nothing written. Add --apply to create the tenant.\n`);
    console.log(`  account        ${ACCOUNT_NAME}`);
    console.log(`  owner login    ${ADMIN_EMAIL} / ${PASSWORD}`);
    console.log(`  rep logins     test1@gmail.com … test${REP_COUNT}@gmail.com / ${PASSWORD}`);
    console.log(`  plan           ${PLAN}, expires ${EXPIRES_AT.slice(0, 10)}`);
    console.log(`  assignment     direct (contacts.employee_id)`);
    console.log(`  catalogue      ${CATALOGUE.length} categories, ${CATALOGUE.reduce((n, c) => n + c.products.length, 0)} products`);
    console.log(`  customers      30–40 per rep across ${REP_COUNT} Indian cities`);
    return;
  }

  console.log('\n[1/8] owner login + account');
  const { userId: ownerUserId, profileId: ownerProfileId, accountId } = await createOwnerAndAccount();

  console.log('[2/8] account configuration');
  await configureAccount(accountId, ownerUserId);

  console.log('[3/8] masters');
  await seedMasters(accountId, ownerUserId);

  console.log('[4/8] roles');
  const { salesRoleId } = await seedRoles(accountId, ownerProfileId);

  console.log('[5/8] sales reps');
  const reps = await seedReps(accountId, salesRoleId, ownerProfileId);

  console.log('[6/8] catalogue');
  await seedCatalogue(accountId, ownerUserId);

  console.log('[7/8] customers');
  await seedCustomers(accountId, reps);

  console.log('[8/8] clearing seed noise');
  await clearSeedNoise(accountId);

  await verify(accountId);

  console.log('\n── Logins ────────────────────────────────────');
  console.log(`Admin (web + app)    ${ADMIN_EMAIL}   ${PASSWORD}`);
  reps.forEach((r) => {
    const city = CITIES[(r.index - 1) % CITIES.length].city;
    console.log(`Rep ${String(r.index).padStart(2, '0')} (app only)    ${r.email.padEnd(20)} ${PASSWORD}   ${r.fullName} — ${city}`);
  });
  console.log('\n✓ Done.');
}

main().catch((e) => die('unhandled error', e));
