*WACRM Engineering Bible* > *Core Architecture* > *Project Overview*
[← None] | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [02_Module_Inventory →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/02_Module_Inventory.md)
---

# WACRM Engineering Bible - Project Overview

## 1. Core Identity & Market Positioning

WACRM (WhatsApp CRM & Field Force) is a multi-tenant B2B Software-as-a-Service (SaaS). It unifies inside sales, field operations, and customer support into a single operating environment.

Instead of generic CRM records, WACRM is explicitly built around two operational anchors:
1. **WhatsApp Inbound/Outbound** (Inside Sales & Support).
2. **GPS Attendance & Site Visits** (Field Agent & Field Service).

### Target Audience
- Small-to-Medium Businesses (SMBs) with hybrid workforces.
- Sales organizations requiring proof-of-visit (Odometer/Location matching).
- Service organizations deploying technicians who need to submit expenses and check-in to geofenced client sites.

## 2. Product Packaging Architecture

The system is fundamentally designed to be modular. While the code currently houses everything in a monorepo, the product packaging is defined as follows:

| Product Tier | Capability Included | Primary Persona |
|--------------|---------------------|-----------------|
| **Core CRM** | Contacts, Pipelines, Deals, Basic Tasks | Office Admin, Field Agent |
| **WhatsApp Add-on** | Shared Inbox, Meta Webhooks, Message Templates, Broadcasts | Support Agent, Marketer |
| **Field Force Add-on** | Mobile App, GPS Tracking, Punch In/Out, Geofence Visits, Expenses, Odometer Proof | Field Agent, Field Agent |
| **Automation Add-on** | Interactive Flows, Trigger-based Automations, AI Bot Knowledge Base | Operations Manager |

## 3. Monorepo Architecture Overview

### 3.1 Backend: Supabase (BaaS)
WACRM relies entirely on Supabase for backend infrastructure, bypassing a traditional Node.js API layer for most CRUD operations.
- **PostgreSQL:** The absolute source of truth. All tenant isolation is handled at the database level via Row Level Security (RLS) using `account_id`.
- **Auth:** Supabase Auth issues JWTs containing the user's ID.
- **Storage:** Amazon S3-compatible buckets handle Avatars, Expense Receipts (Odometer photos), and WhatsApp media.
- **Realtime:** Postgres changes (like new GPS pings or WhatsApp messages) are streamed to the Next.js dashboard via WebSockets.

### 3.2 Web Frontend: Next.js 16 (App Router)
Located in `c:\Users\Xitij\Desktop\wacrm`
- **Rendering:** Heavily relies on Server Components to securely query Supabase without exposing RLS logic to the client.
- **State:** React 19, avoiding global state (Redux) in favor of Server Actions and optimistic UI updates.
- **Styling:** Tailwind CSS, Shadcn UI primitives, deep dark-mode design system.

### 3.3 Mobile Companion: Expo 57 / React Native
Located in `c:\Users\Xitij\Desktop\wacrm-mobile`
- **Routing:** Expo Router (file-based routing mimicking Next.js).
- **Core Value:** Utilizes native device APIs that the web cannot access: `expo-location` (Background Foreground Services), `expo-camera` (fraud-proof odometer photos), and `expo-file-system` (offline sync queues).

## 4. The Unified Operating Loop

Every module in WACRM is designed to feed into the next step of this loop:

1. **Lead Generation:** A customer messages the WhatsApp business number.
2. **Ingestion:** The Meta Webhook (`/api/whatsapp/webhook`) creates a Contact and a Conversation.
3. **Dispatch:** An office Admin assigns a Task to a Field Agent.
4. **Execution:** The Field Agent punches in (Mobile App), starting background GPS tracking.
5. **Verification:** The Agent checks in at the customer site, uploading an odometer photo.
6. **Reconciliation:** The Agent submits an Expense claim tied to the visit distance.
7. **Closure:** The Admin reviews the route on the web dashboard map, approves the expense, and converts the Deal to Won.
