# WACRM Engineering Bible - Master Consolidated Document

This document is the consolidated source of truth for WACRM product support, technical onboarding, architecture, and future scopes.

## 1. Project Overview

WACRM (WhatsApp CRM & Field Force) is a multi-tenant B2B Software-as-a-Service (SaaS). It unifies inside sales, field operations, and customer support into a single operating environment.

Instead of generic CRM records, WACRM is explicitly built around two operational anchors:
1. **WhatsApp Inbound/Outbound** (Inside Sales & Support).
2. **GPS Attendance & Site Visits** (Field Agent & Field Service).

### Target Audience
- Small-to-Medium Businesses (SMBs) with hybrid workforces.
- Sales organizations requiring proof-of-visit (Odometer/Location matching).
- Service organizations deploying technicians who need to submit expenses and check-in to geofenced client sites.

### Product Packaging Architecture
| Product Tier | Capability Included | Primary Persona |
|--------------|---------------------|-----------------|
| **Core CRM** | Contacts, Pipelines, Deals, Basic Tasks | Office Admin, Field Agent |
| **WhatsApp Add-on** | Shared Inbox, Meta Webhooks, Message Templates, Broadcasts | Support Agent, Marketer |
| **Field Force Add-on** | Mobile App, GPS Tracking, Punch In/Out, Geofence Visits, Expenses, Odometer Proof | Field Agent, Field Agent |
| **Automation Add-on** | Interactive Flows, Trigger-based Automations, AI Bot Knowledge Base | Operations Manager |

### Monorepo Architecture Overview
#### Backend: Supabase (BaaS)
WACRM relies entirely on Supabase for backend infrastructure, bypassing a traditional Node.js API layer for most CRUD operations.
- **PostgreSQL:** The absolute source of truth. All tenant isolation is handled at the database level via Row Level Security (RLS) using `account_id`.
- **Auth:** Supabase Auth issues JWTs containing the user's ID.
- **Storage:** Amazon S3-compatible buckets handle Avatars, Expense Receipts (Odometer photos), and WhatsApp media.
- **Realtime:** Postgres changes are streamed to the Next.js dashboard via WebSockets.

#### Web Frontend: Next.js 16 (App Router)
- **Rendering:** Heavily relies on Server Components to securely query Supabase without exposing RLS logic.
- **State:** React 19, avoiding global state in favor of Server Actions and optimistic UI updates.
- **Styling:** Tailwind CSS, Shadcn UI primitives, deep dark-mode design system.

#### Mobile Companion: Expo 57 / React Native
- **Routing:** Expo Router.
- **Core Value:** Utilizes native device APIs that the web cannot access: `expo-location`, `expo-camera`, and `expo-file-system`.

## 2. Module Inventory & Details

### Core Platform (CRM)
- **Identity & Access Management (IAM):** Tenant isolation and user authorization (`accounts`, `profiles`, `roles`).
- **Contacts:** The centralized record-keeping system (`contacts`, `custom_fields`). Unique phone numbers enforced per `account_id`.
- **Pipeline & Deals:** Tracking revenue potential (`leads`, `pipelines`, `deals`).
- **Leads:** High-volume ingestion and qualification. Leads can be converted to Contacts (one-way operation).

### Engagement (WhatsApp Engine)
- **Inbox:** Multi-agent shared inbox communicating natively with Meta APIs (`conversations`, `messages`).
- **Broadcasts:** High-volume outbound marketing (`message_templates`, `broadcasts`).
- **Workflow Automation & AI:** Auto-replies and webhook interceptors (`automations`, `flows`, `bot_settings`).

### Field Force Operations
- **Attendance & Location:** Tracking shift time and geographic movement (`tracking_sessions`, `location_pings`).
- **Site Visits:** Geofenced check-ins to prove physical presence (`site_visits`, `geofences`).
- **Expense Management:** Reimbursing employees for operations and mileage (`expenses`, `expense_types`).

## 3. Database Schema & Architecture

The WACRM database is entirely multi-tenant.
- Every table containing operational data has an `account_id` column referencing `accounts.id`.
- **Row Level Security (RLS)** is enabled on almost every table via `is_account_member(account_id, min_role)`.
- Schema changes are managed via sequentially numbered SQL files in `supabase/migrations/`.

### Key Tables
- **Identity:** `accounts`, `profiles`, `account_invitations`.
- **Contacts:** `contacts`, `custom_fields`, `contact_custom_values`.
- **WhatsApp:** `whatsapp_config`, `conversations`, `messages`, `message_templates`.
- **Field Force:** `tracking_sessions`, `location_pings`, `site_visits`.
- **Expenses:** `expense_types`, `expenses`.

### Triggers & RPCs
- **`set_updated_at`**: Bumps the `updated_at` column `BEFORE UPDATE`.
- **`compute_daily_distance`**: Haversine formula across all `location_pings` to validate fuel expenses.
- **`redeem_invitation`**: Links authenticated `auth.uid()` to target `account_id`.

## 4. Permission & Security System

### System Roles (Database Layer)
- **Owner:** Ultimate authority. Can bypass delete restrictions, transfer account ownership, access billing.
- **Admin:** Can insert/update/delete almost all operational and configuration tables.
- **Agent:** Restricted to operational tables (Contacts, Tasks, Messages). Cannot modify configurations.
- **Viewer:** Strictly SELECT only. Cannot INSERT or UPDATE.

### Business Roles & Scopes (UI Layer)
- **Own:** User can only see records where `user_id = auth.uid()`.
- **Team:** User can see records owned by users reporting to their `team_id`.
- **Company / All:** User can see all records across the `account_id`.

### Mobile Device Approval Flow
- First login stores device UUID as `Approved`. Subsequent logins log new device as `Pending` blocking access. Admins must manually approve new devices.

## 5. Web & Mobile Architecture Gaps and Sync

### Offline Synchronization Module (NEW)

To support our Field Force mobile application, we have implemented a robust offline-first synchronization architecture designed to handle low-connectivity environments. The architecture primarily lives under `src/lib/runtime/sync` and introduces the following components:

- **Delta Fetching Engine**: The mobile client polls for incremental server changes using cursor-based pagination (`DownloadEngine`). This ensures that only the data changed since the last fetch is downloaded, minimizing bandwidth and improving speed.
- **Conflict Resolution Engine**: When both the server and local client have modified the same record, the `ConflictResolutionEngine` handles the merge based on "server_wins" or "client_wins" rules depending on the entity type and timestamp.
- **Local Storage Manager**: A durable, local caching layer acts as the single source of truth for the mobile UI and functions as a queue for pending mutations. If the network drops, mutations are safely persisted locally.
- **Runtime Event Bus**: The `RuntimeEventBus` decoupled architecture allows UI components to react dynamically to repository events (e.g., `REPOSITORY_EVENT` for updates and deletions). This ensures the UI is immediately refreshed when offline data finally syncs with the server.

### Structural Improvements in All Modules

Alongside offline synchronization, we have made widespread architectural improvements across all modules:
- We have adopted a strict **Repository Pattern** to decouple the Next.js and React Native frontend logic from direct Supabase database calls.
- **TelemetryService**: Enhanced logging and observability across both the mobile client and web platform to monitor sync duration, error rates, and field agent adoption.
- **Runtime Services**: Cross-cutting concerns like permissions, analytics, and network monitoring have been abstracted into generic runtime services.

## 6. Future Scope and Roadmap

As WACRM continues to evolve, we are planning to incorporate the following highly requested modules and integrations to create a complete end-to-end enterprise platform:

1. **Order Management System**: End-to-end lifecycle management of customer orders directly from the field or office.
2. **Payment Collection**: Tracking invoices and facilitating online/offline payment collections.
3. **Scheme Management System**: Handling complex discounts, promotions, and B2B loyalty schemes.
4. **Targets for Employees**: Setting and tracking sales and performance quotas for the field force.
5. **Route/Beat Management System**: Optimizing travel routes for agents and managing recurring field visit schedules.
6. **Complaint Management System (Service Industry)**: Comprehensive ticketing and resolution workflows for customer support and post-sales service.
7. **Complaint Visit Module**: Dispatching technicians specifically for complaint resolution and verifying service delivery on-site.
8. **Accounting Integrations**: Out-of-the-box native integrations with leading accounting software, including:
   - Tally
   - Zoho Books
   - Marg
   - And other major accounting platforms

## 7. UI Design System & SOP
- **Dark Mode First:** Deep, sophisticated dark backgrounds.
- **Glassmorphism:** Subtle blurs and translucent background layers.
- **High Contrast Actions:** Primary actions must use solid, vibrant backgrounds.
- **Web Library:** Shadcn UI (Radix UI underneath). `<Button>`, `<Dialog>`, `<Sheet>`, `<DataTable>`.
- **Mobile UI:** React Native `StyleSheet`. Safe areas and Keyboard avoiding views are mandatory.

## 8. Definition of Done (DoD)
- Every new operational table has an `account_id` column.
- RLS is explicitly enabled and tested via `is_account_member(account_id, role)`.
- Inputs to Server Actions / APIs are validated with `zod`.
- Mobile features must function in Airplane Mode and queue mutations locally.
- Realtime subscriptions must filter by `account_id`.
- Code changes must update technical documentation dynamically.

## 9. Architectural Thinking Mode (AIOS)
1. **The Codebase is Truth**: Always verify database schema before writing SQL.
2. **Security is Non-Negotiable**: Never bypass RLS without valid architectural reason.
3. **Offline-First Reasoning**: Mutations on mobile must be queued in WatermelonDB/SQLite. 
4. **Protect the Codebase**: Say NO to bad ideas, such as EAV queries on massive datasets, missing RLS, or bypassing offline sync.

---
*End of Master Document*
