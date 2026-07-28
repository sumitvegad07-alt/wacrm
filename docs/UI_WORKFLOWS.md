# WACRM Web UI Workflows & Navigation Hierarchy

This document serves as the canonical reference for user interface workflows, navigation structure, and information architecture across `wacrm-web`.

---

## 1. Main Sidebar Navigation Hierarchy (`src/components/layout/sidebar.tsx`)

The left-hand sidebar is organized into collapsible functional modules. Every item supports deep linking and active-state highlighting (blue background with text glow in dark mode) via URL pathname and query parameter matching (`?tab=` or `?section=`).

### 1.1 CRM
* Core sales and customer relationship management views.
- **Leads:** `/leads`
- **Customers:** `/contacts`
- **Dashboard:** `/dashboard`
- **My Activity:** `/follow-ups`
- **Pipelines:** `/pipelines`
- **Products:** `/products`
- **Quotations:** `/quotations`
- **Orders:** `/orders`
- **Dispatches:** `/dispatches`
- **Pending Dispatch:** `/pending-dispatch`

### 1.2 WhatsApp
* Conversational marketing, inbox, and automation suite.
- **Dashboard:** `/whatsapp/dashboard`
- **Inbox:** `/inbox`
- **Broadcasts:** `/broadcasts`
- **Automations:** `/automations`
- **Flows (Beta):** `/flows`
- **Templates:** `/settings?tab=templates`
- **Knowledge base:** `/settings?tab=ai`

### 1.3 Location Tracking
* Field agent tracking and attendance management.
- **Overview:** `/location-tracking/overview`
- **Live Feed:** `/location-tracking/dashboard`
- **All Locations:** `/location-tracking/all-locations`
- **Customer Visits:** `/location-tracking/visits`
- **Track report:** `/location-tracking/track-report`
- **User Attendance:** `/location-tracking/attendance`

### 1.4 Team
* Core employee and operational hierarchy module. **Note:** This is a distinct top-level module separate from Settings > Team.
- **Employees:** `/team/employees`
- **Employee Roles:** `/team/roles`
- **Expenses:** `/expenses`

### 1.5 Account
* User profile, authentication, and security settings. Collapsible main menu item with direct links to settings tabs.
- **Profile:** `/settings?tab=profile` (Icon: `User`)
- **Login & security:** `/settings?tab=security` (Icon: `Shield`)

### 1.6 Settings
* Collapsible dropdown menu in the main sidebar housing workspace and system configurations.
- **WhatsApp Settings:** `/settings?tab=whatsapp`
- **Fields & tags:** `/settings?tab=fields`
- **Currency:** `/settings?tab=deals`
- **Leads:** `/settings?tab=leads`
- **Task types:** `/settings?tab=tasks`
- **Orders:** `/settings?tab=orders`
- **Pricing & Schemes:** `/settings?tab=pricing`
- **Team:** `/settings?tab=members` (Workspace member settings panel)
- **API keys:** `/settings?tab=api`
- **Expense policies:** `/settings?tab=expense_types`
- **Appearance:** `/settings?tab=appearance`

---

## 2. Active-State Highlighting & Auto-Expansion

1. **Active-State Highlighting (`isNavItemActive`)**:
   - The navigation component parses both pathnames and URL query parameters (`?tab=` or `?section=`).
   - When a user navigates to `/settings?tab=orders` or `/settings?section=orders`, the corresponding item under the **Settings** sub-menu is highlighted (`bg-primary/10 text-primary`).
2. **Auto-Expansion**:
   - Whenever the route or search parameter changes, the sidebar automatically expands whichever collapsible group contains the active navigation link, ensuring the active sub-item is always visible.

---

## 3. Settings Page Full-Width Layout (`src/app/(dashboard)/settings/page.tsx`)
- Because all account and workspace configuration tabs are directly accessible via the Main Left Sidebar under **Account** and **Settings**, the redundant inner vertical menu rail (`SettingsRail`) on `/settings` is removed.
- Selecting any settings link in the main sidebar renders that section's control panel across the full available width of the settings page.
