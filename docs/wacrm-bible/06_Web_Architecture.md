*WACRM Engineering Bible* > *Core Architecture* > *Web Architecture*
[← 05_Mobile_Architecture](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/05_Mobile_Architecture.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [07_Permission_System →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/07_Permission_System.md)
---

# WACRM Engineering Bible - Web Architecture

*Version: v1.0 | Platform: Web Dashboard*

## 1. Core Technology Stack
- **Framework:** Next.js 16 (App Router)
- **UI Rendering:** React 19 (RSCs - React Server Components by default)
- **Styling:** Tailwind CSS + PostCSS
- **Component Primitives:** Shadcn UI (Radix UI underneath)
- **Language:** Strict TypeScript

## 2. Directory Structure (`c:\Users\Xitij\Desktop\wacrm\src`)
- `/app`: App Router structure.
  - `/(auth)`: Login, Join, Magic Links.
  - `/(dashboard)`: The main tenant application (Contacts, Tasks, Map).
  - `/(superadmin)`: Cross-tenant administration (Billing, Companies).
  - `/api`: Webhooks, Crons, External API routes.
- `/components`: Domain-segregated components.
  - `/ui`: Generic primitives (Buttons, Modals).
  - `/contacts`, `/location-tracking`, `/inbox`: Domain-specific assemblies.
- `/lib`: Core business logic.
  - `/supabase`: Server vs Client client-initializers.
  - `/whatsapp`: Meta Graph API adapters.
  - `/ai`: OpenAI / Google Gemini adapters.
- `/hooks`: React Client Hooks (e.g., `useAuth`, `usePermissions`).

## 3. Server Components vs Client Components

WACRM strictly follows the Next.js App Router paradigm to maximize security and performance.

### 3.1 Server Components (The Default)
All `page.tsx` and `layout.tsx` files are Server Components unless explicitly marked with `"use client"`.
- **Why?** Server components can directly query Supabase using the user's cookies without exposing Row Level Security logic or API keys to the browser.
- **Example:** Fetching the list of Contacts is done directly in the `page.tsx` server component and passed as static props to a client data table.

### 3.2 Client Components
Used only when interactivity is required (Forms, Modals, Realtime Subscriptions).
- **Rule of Thumb:** Push the `"use client"` directive down the tree as far as possible. Do not wrap entire pages in client components.

## 4. Multi-Tenant Routing & State

Unlike monolithic SaaS applications that use a subdomain for tenants (e.g., `tenant.wacrm.com`), WACRM relies on Supabase Auth JWTs.

1. User logs in.
2. Supabase issues a JWT containing their `account_id` and `role`.
3. The Next.js middleware reads this cookie on every request.
4. All Server Actions and Database Queries automatically apply RLS filtering based on that `account_id`.
5. No need to pass `?account_id=123` in the URL, preventing IDOR (Insecure Direct Object Reference) vulnerabilities.

## 5. Realtime Data (WebSockets)
Certain dashboard pages require instant updates (e.g., The Shared WhatsApp Inbox, The Live Field Map).
- We utilize `supabase.channel()` within a `useEffect` hook in Client Components.
- **Warning:** Realtime subscriptions do NOT inherently trigger RLS. You must explicitly filter the channel by the user's `account_id` when subscribing.
