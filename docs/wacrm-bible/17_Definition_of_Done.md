*WACRM Engineering Bible* > *AIOS Standards* > *Definition of Done (DoD)*
[← 16_Development_Workflow](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/16_Development_Workflow.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [18_AI_OPERATING_SYSTEM →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/18_AI_OPERATING_SYSTEM.md)
---

# WACRM AIOS - Definition of Done (DoD)

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
This document defines the absolute, non-negotiable checklist that every feature must pass before it can be merged into the `main` branch or considered "Done". 

**Why it exists:** "It works on my machine" is unacceptable in a Multi-Tenant SaaS. A single missed RLS policy could expose all customer data. A single unhandled offline exception could cause a field agent to lose a day's worth of expenses.
**Who uses it:** Engineers (for self-checking) and AI Reviewers (for PR approval).

---

## 2. The Strict Checklist

### 2.1 Database & Security (RLS)
*Why: Tenant isolation is the most critical feature of WACRM.*
- [ ] Every new operational table has an `account_id` column.
- [ ] Row Level Security (RLS) is explicitly enabled on every new table.
- [ ] RLS policies use `is_account_member(account_id, role)` to enforce tenant boundaries.
- [ ] System roles (Admin vs Agent) are correctly scoped in the RLS policies.
- [ ] `created_at` and `updated_at` columns exist, and the update trigger is applied.

### 2.2 Backend & APIs
*Why: Preventing malformed data and ensuring scalability.*
- [ ] All inputs to Next.js Server Actions or API routes are validated with a `zod` schema.
- [ ] RLS is NOT bypassed using the Service Role Key unless strictly necessary (e.g., automated background crons), and if bypassed, is thoroughly documented.
- [ ] Rate limiting logic is applied to any public `/api/v1/` endpoint.

### 2.3 Mobile & Offline First
*Why: Field agents operate in low-signal environments.*
- [ ] The feature is functional when the device is in Airplane Mode.
- [ ] Mutations (Inserts/Updates) are queued in the local SQLite/WatermelonDB store and synced in the background.
- [ ] Conflict resolution (Last-Write-Wins based on `updated_at`) is handled correctly by the sync engine.
- [ ] The UI clearly indicates to the user if a record is "Pending Sync".

### 2.4 Realtime & Synchronization
*Why: The office dashboard must reflect field/customer reality instantly.*
- [ ] If the feature involves live operations (Map tracking, WhatsApp Inbox), Supabase Realtime channels are implemented.
- [ ] Realtime subscriptions explicitly filter by `account_id` to prevent cross-tenant message broadcasting.

### 2.5 User Interface (UI)
*Why: Maintaining the premium, glassmorphic brand identity.*
- [ ] Only standard components from `src/components/ui` (Shadcn) were used. No raw `<button>` or `<input>` tags.
- [ ] Dark Mode was tested and verified (no white flashes).
- [ ] Loading states (Spinners/Skeletons) are implemented for all async actions.
- [ ] Mobile screens are wrapped in `<SafeAreaView>` and `<KeyboardAvoidingView>`.

### 2.6 Documentation & Traceability
*Why: Code rots. Documentation scales.*
- [ ] `10_Module_Details.md` has been updated with the new tables and workflows.
- [ ] `11_Web_vs_Mobile_Gap.md` has been updated to reflect parity changes.
- [ ] If a major architectural shift occurred, `20_ARCHITECTURE_DECISIONS.md` was filed.
- [ ] Code comments were added to any complex business logic (e.g., Haversine distance calculations).

### 2.7 Testing & QA
*Why: Preventing regressions in the core operating loop.*
- [ ] Edge cases defined in the Sprint Template have been manually or automatically verified.
- [ ] The feature does not break existing WhatsApp webhook ingestion or Background GPS tracking.

## 3. Anti-Patterns
- Merging code with the comment: *"I'll add the RLS policies later."* (Immediate Rejection).
- Merging code with the comment: *"Offline sync is too hard for this screen, let's just use `fetch()`."* (Immediate Rejection).
