# WACRM Sprint 1A - Engineering Preparation & Offline Readiness Audit

*This document is the result of the Phase 0 and Phase 1 Codebase Interrogation. It serves to prepare the WACRM ecosystem for the upcoming SDS-001 (Offline-First Architecture) without modifying any existing behavior.*

---

## PHASE 1: Complete Architecture Audit

### Current System State
- **Mobile Architecture:** Built on Expo 57 / React Native. Heavy reliance on direct `@supabase/supabase-js` calls inside UI components (`app/` and `lib/`).
- **Web Architecture:** Next.js 14+ App Router. Mix of Server Components fetching directly from Supabase and Client Components using Server Actions.
- **Synchronization:** **None.** All requests are synchronous HTTP calls to Supabase PostgREST. If the network drops, the `await supabase...` call fails and throws an error.
- **Authentication:** Supabase Auth (JWT). Handled by `lib/auth-context.tsx` in mobile.
- **Local Storage:** `expo-secure-store` used for tokens. Basic `expo-file-system` queues exist *only* for background GPS pings (`lib/location.ts`), completely absent for CRM operations (Contacts, Tasks, Expenses).
- **API Usage:** Mobile UI directly invokes Supabase. Web uses Server Actions and Next.js `/api/` for webhooks.
- **Realtime Usage:** Web uses `supabase.channel()` to subscribe to `location_pings` and `messages`. Mobile currently lacks Realtime subscriptions for Inbox.
- **Database Usage:** Direct SQL mapping via Supabase. Heavy reliance on RLS (`is_account_member`).
- **Permission Handling:** Role-based (owner, admin, agent, viewer). Checked synchronously online during DB queries.
- **GPS Handling:** `expo-location` Foreground Service. Queues pings locally in a `.json` file and flushes every 10 minutes. 
- **Image Handling:** `expo-camera` captures URIs. `lib/storage.ts` attempts immediate synchronous upload to Supabase Storage. Fails catastrophically if offline.
- **Background Services:** Only GPS tracking exists. No background sync engine for data or photos.
- **Network Handling:** Binary (Online = Success, Offline = Crash/Error). No interceptors or retry mechanisms.
- **Caching:** React Query is largely missing. State relies on component unmount/remount fetching.
- **Error Handling:** Basic `try/catch` wrapping Supabase calls. Errors often alerted directly to the UI instead of a structured log.
- **Logging:** Console logs. No Sentry or Datadog integration currently active for mobile crashes.
- **Offline Assumptions:** System falsely assumes 100% 4G availability for everything except background GPS tracking.

---

## PHASE 2: Offline Readiness Audit

Every dependency on the internet was identified and classified.

| Dependency | Classification | Why/How it fails | Replacement Strategy | Complexity | Risk |
|------------|----------------|------------------|----------------------|------------|------|
| **Supabase Queries (`select`)** | Critical | Blocks rendering of Contacts, Tasks, Lists. | Replace with local SQLite (WatermelonDB) reads. | High | High (Requires massive UI refactor to observe local DB). |
| **Supabase Mutations (`insert`)** | Critical | Data loss on Punch In, Site Visit, Add Expense. | Intercept inserts into a local SQLite `pending_sync` queue. | High | High (Conflict resolution LWW). |
| **Supabase Auth (`getSession`)** | Critical | Forces logout if token expires while offline. | Extend grace period in `auth-context.tsx`. Cache last valid user. | Medium | Medium (Security risk if device stolen). |
| **Storage Uploads (`storage.ts`)**| Medium | Expense photos lost if submission fails. | Save to `expo-file-system`. Sync background queue to upload chunks. | Medium | Low (Images are immutable). |

---

## PHASE 3: Module Audit

| Module | Works Offline? | Blocker | Estimated Complexity | Dependencies |
|--------|----------------|---------|----------------------|--------------|
| **Contacts** | ❌ No | Reads/Writes strictly to Supabase via HTTP. | High | Needs Two-Way Sync Engine. |
| **Tasks** | ❌ No | Assigned tasks fail to load without internet. | Medium | Needs One-Way Down sync, One-Way Up status sync. |
| **Attendance (Punch)** | ❌ No | Session start/end writes directly to Supabase. | Medium | Needs offline session ID generation (UUIDv4) + Queue. |
| **GPS Tracking** | ⚠️ Partial | Pings queue locally, but session creation fails. | Low | Already queues; just needs session fallback. |
| **Site Visits** | ❌ No | Requires online geofence coordinate matching. | High | Must download daily geofences to local SQLite. |
| **Expenses** | ❌ No | Uploads photos and DB records synchronously. | Medium | Needs offline photo cache + DB queue. |
| **WhatsApp Inbox** | ❌ No | Cannot receive Webhooks offline. | Extreme | Impossible to be truly offline. Needs complex sync. |

---

## PHASE 4: Database Audit

| Table | Classification | Why (Sync Strategy) |
|-------|----------------|---------------------|
| `accounts` | **Offline Required** | Needed to verify basic tenancy rules locally. |
| `profiles` | **Sync One Way (Down)** | Agent needs to see team names, but cannot edit them. |
| `contacts` | **Sync Two Way** | Core CRM. High risk of **Conflict Sensitivity** if two agents edit the same contact. Requires `updated_at` LWW resolution. |
| `tasks` | **Sync Two Way** | Assigned to Agent (Down), Marked Complete by Agent (Up). |
| `tracking_sessions` | **Sync One Way (Up)** | Generated on device, pushed to server. |
| `location_pings` | **Sync One Way (Up)** | Generated heavily on device. |
| `expenses` | **Attachment Heavy** | Sync Two Way. Requires dependent photo upload queue. |
| `whatsapp_config` | **Never Sync** | Irrelevant and dangerous to expose to mobile agents. Security Sensitive. |

---

## PHASE 5: API Audit

| Mobile Supabase Action | Classification | Why |
|------------------------|----------------|-----|
| `auth.signIn` | **Online Only** | Cannot verify passwords locally. |
| `from('contacts').select`| **Requires Cache** | Must read from SQLite instead of network. |
| `from('expenses').insert`| **Requires Dependency Queue** | Must NOT insert until photos upload successfully. |
| `from('visits').insert` | **Requires Retry** | Idempotent based on UUID. Can safely retry until success. |

---

## PHASE 6: Permission Audit

- **Missing Permissions (Mobile):** Currently, mobile uses a global `profile` check. It lacks offline capability to check `employee_roles.permissions`. 
- **Future Requirement:** For SDS-001, the `employee_roles` JSON definition must be synced down to SQLite so the mobile UI can hide/show "Delete" buttons without an active internet connection.

---

## PHASE 7: UI Audit

- **Duplicate UI:** Multiple screens (Tasks, Contacts, Expenses) manually implement loading spinners and error states. 
- **Reusable UI Target:** `withSyncState` HOC (Higher Order Component). Screens should not handle `fetch` states. They should observe WatermelonDB/SQLite, which naturally re-renders when the background sync engine pulls new data.

---

## PHASE 8: Technical Debt

1. **CRITICAL:** Direct API calls in UI (`app/(tabs)/home.tsx` has `supabase.from('tracking_sessions').select()`). 
   - *Impact:* Guarantees the app breaks offline. 
   - *Recommendation:* Abstract all data calls into a Data Access Layer (DAL).
2. **HIGH:** Lack of UUID generation on client.
   - *Impact:* Cannot create Records offline because they rely on Supabase returning the generated ID.
   - *Recommendation:* Move all primary keys to UUIDv4 generated on the client before insert.
3. **MEDIUM:** Massive files (`auth-context.tsx` handles JWTs, device limits, and profiles).
   - *Recommendation:* Split into `auth.ts`, `device.ts`, and `session.ts`.

---

## PHASE 9: Implementation Preparation (Refactoring Opportunities)

*Note: Per strict instruction, NO actual refactoring or file splitting will occur until SDS-001 mandates it. These are proposed preparations.*

1. **Propose Data Access Layer (DAL):** Move all `supabase.from()` calls out of `app/` and into `lib/api/`. This ensures that when SDS-001 replaces `supabase` with `sqlite`, only `lib/api/` changes, not the UI.
2. **Propose UUID Generation:** Ensure `react-native-get-random-values` and `uuid` are installed to allow the client to define IDs for offline inserts.
3. **Propose Cleanup:** Remove unused imports across `wacrm-mobile/app/`.

---

## PHASE 10: Final Deliverables & Recommendations

### Risk Assessment
Migrating an existing app to Offline-First is extremely high risk. 
- **Risk 1:** Data collision (Two agents edit the same offline contact).
- **Risk 2:** Photo orphanization (Expense uploads but photos fail).
- **Risk 3:** Memory limits (Downloading 100,000 CRM contacts to a low-end Android device).

### Implementation Strategy for SDS-001
When SDS-001 arrives, it should be implemented in this strict order:
1. **Sprint 1B (Foundation):** Install WatermelonDB. Implement client-side UUIDs. Build the SQLite Schema.
2. **Sprint 2 (One-Way Sync):** Build the Pull Engine. Sync Down profiles, contacts, and tasks. Change UI to read from SQLite.
3. **Sprint 3 (Two-Way Sync):** Build the Push Engine. Intercept inserts (Punch In, Expenses) into the SQLite `pending_operations` table.
4. **Sprint 4 (Binary Sync):** Implement the background chunked-upload queue for `expo-camera` photos.

**Status:** The codebase is fully audited, classified, and understood. WACRM is ready to receive SDS-001.
