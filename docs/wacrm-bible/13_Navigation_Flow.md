*WACRM Engineering Bible* > *Deep Specifications* > *Navigation Flow*
[← 12_Offline_First_Architecture](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/12_Offline_First_Architecture.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [14_Component_Library →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/14_Component_Library.md)
---

# WACRM Engineering Bible - Navigation Flow

*This document outlines every navigation path, deep link, and role-based guard across the Web and Mobile applications.*

## 1. Web Application Navigation (`src/app`)

### 1.1 Unauthenticated Flow
- `/join` -> Registration page. (Checks `account_invitations` table based on a token).
- `/(auth)/login` -> Main email/password entry.
- `/(auth)/magic-link` -> OTP / Email Link fallback.

### 1.2 The Dashboard `/(dashboard)`
*Protected by Next.js Middleware. Requires valid Supabase JWT.*
- **CRM:**
  - `/` -> Main Analytics Dashboard.
  - `/contacts` -> CRM List View.
    - `/contacts/[id]` -> Contact Detail (Drawer/Sheet).
  - `/leads` -> Leads management.
  - `/orders`, `/quotations`, `/products`, `/dispatches`, `/pending-dispatch` -> Order and Product workflows.
- **WhatsApp:**
  - `/inbox` -> WhatsApp Shared Inbox.
  - `/broadcasts`, `/automations`, `/flows` -> WhatsApp campaigns and flows.
  - `/settings?tab=templates`, `/settings?tab=ai` -> Templates and Knowledge Base.
- **Location Tracking:**
  - `/location-tracking/overview`, `/location-tracking/dashboard`, `/location-tracking/all-locations`, `/location-tracking/visits`, `/location-tracking/track-report`, `/location-tracking/attendance` -> Map and attendance views.
- **Team:**
  - `/team/employees` -> Employees management.
  - `/team/roles` -> Employee Roles management.
  - `/expenses` -> Approvals and expense claims.
- **Account (Collapsible Sub-Menu):**
  - `/settings?tab=profile` -> User Profile settings.
  - `/settings?tab=security` -> Login & security settings.
- **Settings (Collapsible Sub-Menu):**
  - `/settings?tab=whatsapp` -> WhatsApp Settings.
  - `/settings?tab=fields` -> Fields & tags.
  - `/settings?tab=deals` -> Currency.
  - `/settings?tab=leads` -> Leads settings.
  - `/settings?tab=tasks` -> Task types.
  - `/settings?tab=orders` -> Orders settings.
  - `/settings?tab=pricing` -> Pricing & Schemes.
  - `/settings?tab=members` -> Team members settings (kept separate from main Team module).
  - `/settings?tab=api` -> API keys.
  - `/settings?tab=expense_types` -> Expense policies.
  - `/settings?tab=appearance` -> Appearance & Theme settings.

### 1.3 Superadmin `/(superadmin)`
*Protected by `is_superadmin` flag in the `profiles` table.*
- `/admin/accounts` -> View all tenants for billing/support.
- `/admin/feature-flags` -> Global rollout controls.

## 2. Mobile Application Navigation (`app/`)

The mobile app uses Expo Router with a strict Tab-based paradigm layered with Modals.

### 2.1 Authentication & Gating
- `/` (Index) -> Checks session. If none -> `/(auth)/login`.
- **Device Approval Guard:** If logged in, but device is `Pending`, intercepts route and shows `PendingApprovalScreen`.

### 2.2 Tab Navigation `/(tabs)`
- **Home:** Quick stats and the massive "Punch In" button.
- **Contact:** Mobile-optimized Contact list.
- **Activity:** Assigned Tasks.
- **Map:** Agent's daily trail.
- **Expense:** Agent's submitted claims.
- **Profile:** Settings, Force Sync, Logout.

### 2.3 Stack & Modal Navigation
*Pushed on top of the active tab, obscuring the bottom bar.*
- `/punch` -> The Selfie / Permission request flow before starting the tracker.
- `/visit` -> Check In/Out flow with Geofence validation.
- `/expense/[id]` -> Stack screen to view a past claim's rejection notes.
