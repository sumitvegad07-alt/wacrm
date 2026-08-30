// ============================================================
// ASK OZZO — seed the global product-doc corpus.
//
//   node scripts/ozzo-seed.mjs
//
// Loads .env.local, embeds each article with Gemini (768-dim, same model as
// the app), and upserts docs + chunks via the service role (bypasses RLS —
// corpus authoring is a platform operation). Idempotent by slug.
//
// This is the Phase-1 curated seed. Content is grounded in verified product
// facts; expand/curate over time. (The hybrid auto-ingest of existing repo
// docs can be added as more sources here.)
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// --- load .env.local ---
function loadEnv(file) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv('.env.local');
loadEnv('.env');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_KEY) {
  console.error('Missing env: need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const embModel = new GoogleGenerativeAI(GEMINI_KEY).getGenerativeModel({ model: 'gemini-embedding-2' });

async function embed(text) {
  const r = await embModel.embedContent({
    content: { role: 'user', parts: [{ text }] },
    outputDimensionality: 768,
  });
  return r.embedding.values;
}

function chunkText(text, maxLen = 1000) {
  const paras = text.split(/\n\s*\n/);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    if (cur.length + p.length > maxLen) {
      if (cur) chunks.push(cur.trim());
      cur = p;
    } else {
      cur += (cur ? '\n\n' : '') + p;
    }
  }
  if (cur) chunks.push(cur.trim());
  return chunks;
}

async function upsert(doc) {
  const { data, error } = await admin
    .from('ozzo_docs')
    .upsert({ ...doc, is_published: true }, { onConflict: 'slug' })
    .select('id')
    .single();
  if (error) throw new Error(`upsert ${doc.slug}: ${error.message}`);
  await admin.from('ozzo_doc_chunks').delete().eq('doc_id', data.id);
  const pieces = chunkText(doc.body_md);
  let i = 0;
  for (const content of pieces) {
    const v = await embed(content);
    const { error: e } = await admin.from('ozzo_doc_chunks').insert({
      doc_id: data.id, chunk_index: i, content,
      embedding: `[${v.join(',')}]`, token_count: Math.round(content.length / 4),
    });
    if (e) throw new Error(`chunk ${i} ${doc.slug}: ${e.message}`);
    i++;
  }
  console.log(`  ✓ ${doc.slug} (${i} chunks)`);
}

const DOCS = [
  {
    slug: 'scheme-management-setup', title: 'Turning on and configuring Scheme Management',
    module: 'schemes', category: 'guide', source_ref: 'curated',
    body_md: `Scheme Management lets you run promotional pricing and discount schemes (for example "buy 10 get 1 free" or a percentage off) that apply automatically when reps create orders.

It is OFF by default. To turn it on, open Catalogue Settings and enable the Scheme Management toggle. Once enabled, a Schemes section appears where you can create and manage schemes.

To create a scheme: define the products it applies to, the discount or free-goods rule, and the validity dates. A scheme has an on/off toggle so you can activate or pause it without deleting it — controlled by the "toggle scheme" right, which is separate from full edit rights.

When Scheme Management is off, the Schemes area and scheme pricing on the order form are hidden. If a rep says they can't see schemes, first confirm the Catalogue Settings toggle is on and that their role has the view/scheme rights.`,
  },
  {
    slug: 'order-vs-invoice', title: 'Difference between an Order and an Invoice',
    module: 'orders', category: 'concept', source_ref: 'curated',
    body_md: `An Order records a customer's request to buy goods — the products, quantities, agreed prices, discounts, and taxes. It moves through statuses (for example provisional, confirmed, dispatched, closed) as it is fulfilled.

An Invoice is the formal bill you issue for goods actually supplied against an order. In OZZO, the order is the operational record your sales and dispatch teams work from; documents such as a printable order or dispatch note are generated from it using Document Templates.

Practical difference: you create and manage Orders in the Orders module day to day. Reporting on sales counts an order as a sale when it reaches the Closed status (dated by when dispatch completes).`,
  },
  {
    slug: 'order-needs-review', title: 'Why an order shows "Needs Review" or "Provisional"',
    module: 'orders', category: 'troubleshooting', source_ref: 'curated',
    body_md: `Orders carry a pricing status. "Confirmed" means the price the rep saw matches what the server calculated. "Provisional" or "Needs Review" means the order was taken (often offline in the field) and the final price needs to be reconciled against the current catalogue, price lists, and schemes.

This usually happens when: the order was created offline and synced later, a price list or scheme changed between creation and sync, or a manual price override was applied that is outside the allowed range.

What to do: open the order and review the line prices against the expected total. If the pricing is correct, confirm it; if a rep applied a discount or override they shouldn't have, correct the lines. Orders lock automatically once dispatch begins, so review before dispatching.`,
  },
  {
    slug: 'permissions-overview', title: 'How employee roles and permissions work',
    module: 'permissions', category: 'guide', source_ref: 'curated',
    body_md: `OZZO has two layers of access control.

System roles (Owner, Admin, Agent, Viewer) are the hard security layer. Owner and Admin can manage almost everything; Agents work on operational records; Viewers can only look. These are enforced in the database, not just the screen.

Business roles (Employee Roles) are the fine-grained layer you configure under Team → Employee Roles. Each role is a set of rights — for example view/create/edit/delete for Leads, Orders, Payments, and so on — plus data visibility (see only your own records, your team's, or everyone's). Assign a role to each employee under Team → Employees.

To let someone do something they currently can't: edit their Employee Role and grant the specific right (for example "create orders"), then save. Owner and Admin bypass these checks automatically. Remember that hiding a button is not the whole story — the most sensitive actions are also enforced in the database.`,
  },
  {
    slug: 'agent-cannot-punch-in', title: "Why a field agent can't punch in",
    module: 'attendance', category: 'troubleshooting', source_ref: 'curated',
    body_md: `The most common reason is device approval. The first phone an employee logs in from is approved automatically; logging in from a new phone marks that device as pending, and the app signs them out with a "pending approval" message. Fix: an admin opens Team → Employees, finds the employee, and approves the device in the Mobile Device Security list.

Other causes to check:
- Location permission is not granted, or the phone's GPS is off. Punch In starts a background location service that needs location permission.
- The app is the Expo Go sandbox rather than a proper build — background location only works in an installed build, not Expo Go.
- The employee's role is missing mobile access, or their account status is inactive.

Note: shift times do NOT block punching in. An employee can punch in at any hour; shift times are only used to classify the attendance (on time, late, etc.), never to prevent tracking.`,
  },
  {
    slug: 'import-customers-products', title: 'Importing customers and products correctly',
    module: 'imports', category: 'guide', source_ref: 'curated',
    body_md: `OZZO uses one guided Import wizard. Open the import for the module you want (for example Product Units), upload a CSV or Excel file, then follow the steps: Upload → Map columns → Preview → Result.

Tips for a clean import:
- Use "Validate only" (a dry run) first to catch errors before anything is written.
- On the Map step, match each of your spreadsheet columns to the correct OZZO field. The wizard suggests matches, but check them.
- Choose Skip or Update mode for rows that already exist.
- If an import went wrong, use the import history to Undo it — undo is available for a short window and only while no newer import or dependent record exists.

You need the import rights on your role (import data / manage imports) for the import button to appear.`,
  },
  {
    slug: 'beat-route-planning', title: 'Implementing beat / route planning for a distributor',
    module: 'beat', category: 'guide', source_ref: 'curated',
    body_md: `Beat (route) planning lets you decide which customers each field rep should visit on which days, then track that they actually did.

A typical distributor setup:
1. Make sure your customers have addresses/locations so they can be placed on a route.
2. Create routes (beats) and add the customers that belong to each.
3. Set a schedule — which day(s) each route is run and by whom (assign the route to a rep).
4. Reps execute the route from the mobile app, checking in at each customer as they visit.

Route rights control who can create, edit, assign, approve, and execute routes. Assignment is keyed to the employee's profile, and execution is recorded per day, so the same route run on different days stays separate.`,
  },
  {
    slug: 'reports-and-export', title: 'Available reports and how to export them',
    module: 'reports', category: 'guide', source_ref: 'curated',
    body_md: `OZZO includes a suite of reports built on one engine, including Sales, Payments (collections), Ageing (outstanding), CRM, Field/Attendance, Expense, Stock, Task, Visit and a cross-module DSR (daily sales report).

Each report supports per-module filters and column choices, and you can save a default view. To download, use the export action on the report — this requires the "export reports" right on your role. Sharing a report as a PDF requires the "share reports" right.

Reports read your data according to your data-visibility scope: if your role is limited to your own records, the report shows only those; a manager with team or company scope sees more.`,
  },
];

console.log(`Seeding ${DOCS.length} ASK OZZO docs...`);
for (const d of DOCS) {
  await upsert(d);
}
const { count } = await admin.from('ozzo_doc_chunks').select('*', { count: 'exact', head: true });
console.log(`Done. Total chunks in corpus: ${count}`);
