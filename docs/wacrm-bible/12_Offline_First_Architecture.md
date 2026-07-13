*WACRM Engineering Bible* > *Deep Specifications* > *Offline First Architecture (Roadmap)*
[← 11_Web_vs_Mobile_Gap](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/11_Web_vs_Mobile_Gap.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [13_Navigation_Flow →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/13_Navigation_Flow.md)
---

# WACRM Engineering Bible - Offline First Architecture (Roadmap)

*This document outlines the required engineering design to transition the WACRM Field Force mobile app from a "Requires Network" state to a true "Offline First" Enterprise application.*

## 1. Current State & Limitations
- **Current State:** Only GPS Location Pings have an offline fallback (saving to `expo-file-system`). All other operations (Punch In, Check In, Add Expense, Add Contact) require an active internet connection.
- **The Problem:** Field Agents often work in warehouses, basements, or rural areas with zero cellular reception. A failed "Punch Out" or "Check In" causes data loss and payroll disputes.

## 2. Required Architecture: Local Database
To achieve true offline-first, the app must never read/write directly to Supabase from the UI thread.
- **Technology Choice:** `WatermelonDB` or `PowerSync` (SQLite wrapper for React Native).
- **The Pattern:** 
  1. UI reads exclusively from the Local SQLite DB.
  2. UI writes exclusively to the Local SQLite DB.
  3. A background Sync Engine handles bidirectional synchronization with Supabase.

## 3. Queue Architecture & Conflict Resolution
- **Sync Status Indicators:** Every record in the local DB requires a `sync_status` column (`synced`, `pending_insert`, `pending_update`, `pending_delete`).
- **Conflict Resolution:** We will employ **LWW (Last Write Wins)** based on a highly accurate `updated_at` timestamp. 
- **Server Authority:** If the server rejects a change (e.g., due to an RLS violation), the local record is reverted to the server state and an alert is logged in the `Failed Sync Queue`.

## 4. Attachment Synchronization (Photos)
Photos (Selfies, Odometer readings) are massive and prone to network failure.
1. Camera captures photo.
2. Photo is compressed and saved to the local `expo-file-system`.
3. The local DB records the path: `file:///data/user/0/.../photo.jpg`.
4. The Background Sync Engine attempts a chunked upload to Supabase Storage.
5. Upon successful upload, the Sync Engine receives the public URL and updates the local DB record.

## 5. Cache Invalidation & Data Scoping
A mobile device cannot download the entire CRM database.
- **Scoping:** The sync engine will only pull Contacts and Tasks explicitly assigned to the Agent.
- **Pagination:** Sync must happen in paginated chunks to prevent OOM (Out of Memory) crashes on low-end Android devices.
- **Manual Sync:** Provide a "Force Sync" button on the mobile Profile screen.

## 6. Authentication Offline
- Supabase JWTs expire.
- If the app is launched offline, it must validate against the last known valid JWT stored securely in `expo-secure-store`. If the session is within a 7-day grace period, the app permits offline access.
