*WACRM Engineering Bible* > *Core Architecture* > *API & Integration Architecture*
[← 03_Database](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/03_Database.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [05_Mobile_Architecture →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/05_Mobile_Architecture.md)
---

# WACRM Engineering Bible - API & Integration Architecture

## 1. Architectural Philosophy

WACRM deliberately blurs the line between Backend and Frontend. 
Because we use Supabase (BaaS), **the Database IS the primary API.**

### 1.1 Client-to-Database Direct (The 80% Rule)
For standard CRUD operations (Contacts, Tasks, Expenses), the web and mobile clients do NOT hit a REST API. 
They use the `@supabase/supabase-js` client to directly execute SQL-like queries against the database.
- **Security:** RLS (Row Level Security) ensures the client cannot read/write outside their `account_id`.
- **Performance:** Eliminates the latency of a middleman Node.js server.

### 1.2 Next.js Route Handlers (The 20% Rule)
We only create traditional REST API endpoints in `src/app/api/` when we absolutely must bypass client RLS, interact with external systems, or handle webhooks.

## 2. API Endpoint Inventory (`/src/app/api/`)

### 2.1 Webhooks
**`POST /api/whatsapp/webhook`**
- **Purpose:** Meta hits this URL whenever a customer sends a WhatsApp message or a message status changes (Delivered/Read).
- **Security:** Validates the SHA-256 HMAC signature from Meta using `APP_SECRET`.
- **Workflow:**
  1. Acknowledge receipt (Return 200 immediately to prevent Meta retries).
  2. Parse the WABA ID to find the matching `whatsapp_config`.
  3. Upsert the `contact`.
  4. Insert the `message`.
  5. Fire the AI/Automation Engine asynchronously.

### 2.2 External Public API (`/api/v1/*`)
**Purpose:** Allows customers to integrate WACRM with their own ERPs or legacy systems.
- **`GET /api/v1/me`**: Verifies the API Key.
- **Authentication:** Requires a `Bearer {API_KEY}` header. Keys are stored as hashes in `api_keys`.
- **Rate Limiting:** Currently uses an in-memory token bucket. *Tech Debt: This will fail in a multi-server deployment. Needs Redis.*

### 2.3 System Crons & Automations
**`POST /api/automations/engine`**
- **Purpose:** Scans the `automation_pending_executions` table and executes delayed actions (e.g., "Send WhatsApp message 2 days after Lead Creation").
- **Security:** Protected by a secret cron key. Called by an external cron service (like Vercel Cron or GitHub Actions) every minute.

## 3. Server Actions (Next.js 14+)

For internal Web UI mutations that require elevated privileges or complex multi-table transactions, we use React Server Actions instead of API routes.

Example: **Approving an Expense**
- The client calls `approveExpense(id)`.
- The Server Action executes in a secure Node environment.
- It bypasses RLS using the Supabase Service Role Key to verify the admin's rights, then updates the expense and creates a ledger entry atomically.

## 4. Integration Specifications

### 4.1 Meta WhatsApp Cloud API
- **Outbound Sends:** We hit `graph.facebook.com/v19.0/{PHONE_ID}/messages`.
- **Media Uploads:** Images uploaded by agents are first saved to Supabase Storage, then securely streamed to Meta's `/media` endpoint to get a Media ID, which is then sent to the customer.

### 4.2 Mapping (OpenStreetMap & OpenRouteService)
To avoid exorbitant Google Maps API costs for field tracking:
- **Geocoding:** `nominatim.openstreetmap.org` translates GPS coordinates into readable street addresses for the dashboard.
- **Routing:** `api.openrouteservice.org` draws the snapped road-path lines between an agent's `location_pings` on the web map.

## 5. Security Posture
- **Never expose the Service Role Key** (`SUPABASE_SERVICE_ROLE_KEY`) to the client.
- Always use `createRouteHandlerClient` or `createServerActionClient` in Next.js, which automatically inherits the user's secure JWT cookies.
- Do not trust API input; always validate payloads using `zod` schemas before executing DB queries.
