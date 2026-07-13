*WACRM Engineering Bible* > *Core Architecture* > *Database Schema & Architecture*
[← 02_Module_Inventory](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/02_Module_Inventory.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [04_API_Documentation →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/04_API_Documentation.md)
---

# WACRM Engineering Bible - Database Schema & Architecture

*Version: v1.0 | Target: Supabase PostgreSQL*

## 1. The Core Architecture

The WACRM database is entirely multi-tenant, residing in a single PostgreSQL instance managed by Supabase.

### 1.1 Tenancy & Isolation
Every table containing operational data has an `account_id` column referencing `accounts.id`.
**Row Level Security (RLS)** is enabled on almost every table.

A central PostgreSQL function dictates access:
```sql
CREATE FUNCTION is_account_member(acc_id UUID, min_role account_role_enum DEFAULT 'viewer') 
RETURNS BOOLEAN ...
```
This function checks the currently authenticated `auth.uid()` against the `profiles` table to ensure:
1. The user belongs to the requested `account_id`.
2. The user has at least the `min_role` required to perform the action.

### 1.2 Migration Flow
Schema changes are exclusively managed via sequentially numbered SQL files in `supabase/migrations/`.
*Never manually modify the production schema via the Supabase Dashboard.*

## 2. Table Blueprints (By Domain)

### 2.1 Identity & Access
- **`accounts`**: `id`, `name`, `owner_user_id`, `created_at`, `updated_at`.
- **`profiles`**: Maps `id` (references `auth.users`) to `account_id`, `full_name`, `account_role` (enum: owner, admin, agent, viewer). Includes access flags `mobile_access` and `web_access`.
- **`account_invitations`**: Stores `token_hash`, `role`, and expiration for onboarding.

### 2.2 Contacts & Custom Fields
- **`contacts`**: `id`, `account_id`, `name`, `phone` (unique per account), `email`, `created_by`.
- **`custom_fields`**: Defines dynamic schema additions (e.g., "VAT Number"). `id`, `account_id`, `entity_type` (contact, expense, lead), `field_type` (text, number, date, boolean).
- **`contact_custom_values`**: EAV (Entity-Attribute-Value) table mapping a `contact_id` to a `field_id` and storing the `value`.

### 2.3 WhatsApp Engine
- **`whatsapp_config`**: Stores Meta `phone_number_id`, `waba_id`, and `access_token`. Unique per `account_id`.
- **`conversations`**: Links `account_id` and `contact_id`. Tracks `last_message_at` and `unread_count`.
- **`messages`**: `id`, `conversation_id`, `direction` (inbound/outbound), `status` (sent, delivered, read), `message_type` (text, image, document), `content`.
- **`message_templates`**: Caches approved Meta templates for outbound initiation.

### 2.4 Field Force Operations
- **`tracking_sessions`**: The boundary of a shift. `id`, `user_id`, `started_at`, `ended_at`.
- **`location_pings`**: High-volume append-only table. `id`, `session_id`, `user_id`, `lat`, `lng`, `accuracy_m`, `battery_pct`, `recorded_at`.
  - *Note: RLS allows agents to insert their own pings, but only admins can select/read all pings for the dashboard.*
- **`site_visits`**: `id`, `user_id`, `contact_id` (optional), `task_id` (optional), `check_in_time`, `check_out_time`, `check_in_lat`, `check_in_lng`.

### 2.5 Expense Management
- **`expense_types`**: `name`, `requires_proof`, `rate_per_km`.
- **`expenses`**: `id`, `employee_id`, `type_id`, `amount`, `status` (Pending, Approved, Rejected), `odometer_start_photo`, `odometer_end_photo`.

## 3. Critical Database Functions & Triggers

### 3.1 Triggers
- **`set_updated_at`**: Attached to almost all tables. Automatically bumps the `updated_at` column `BEFORE UPDATE`.
- **Broadcast Counters**: Triggers on `broadcast_recipients` automatically increment `sent_count`, `delivered_count`, and `read_count` on the parent `broadcasts` table.
- **New User Handler**: A trigger on `auth.users` insertion creates a default personal `account` and `profile` atomically.

### 3.2 Stored Procedures (RPCs)
- **`compute_daily_distance(p_user_id, p_date)`**: Runs the Haversine formula across all `location_pings` for a user on a given day to return total KM traveled. Used to validate fuel expenses.
- **`redeem_invitation(p_token)`**: Securely hashes the input token, validates expiration, and links the authenticated `auth.uid()` to the target `account_id`.

## 4. Technical Debt & Constraints
- **Custom Fields EAV Anti-pattern:** The `custom_values` tables use the Entity-Attribute-Value pattern. While flexible, filtering/sorting contacts by custom fields is extremely slow at scale because it requires complex SQL joins. If contact volumes exceed 100k per tenant, this will require migration to a JSONB column or a dedicated materialized view.
- **Location Ping Bloat:** `location_pings` will grow massively (1 ping per 10 mins per user = ~48 pings/day/user). Need to implement partition tables or automated archiving for data > 90 days old.
