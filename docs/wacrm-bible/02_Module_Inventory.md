*WACRM Engineering Bible* > *Core Architecture* > *Module Inventory*
[← 01_Project_Overview](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/01_Project_Overview.md) | [📖 Master Index](file:///c:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [03_Database →](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/03_Database.md)
---

# WACRM Engineering Bible - Module Inventory

This document provides a high-level map of the WACRM ecosystem. 

> [!NOTE]
> **To understand the Business Rules (The "Why")**, read [23_PRODUCT_RULES.md](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/23_PRODUCT_RULES.md).
> **To understand the Technical Implementation (The "How")**, read [10_Module_Details.md](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/10_Module_Details.md).

## 1. Core Platform (CRM)
- **Identity & Access Management (IAM):** Tenant isolation and user authorization (`accounts`, `profiles`, `roles`).
- **Contacts:** The centralized record-keeping system (`contacts`, `custom_fields`).
- **Pipeline & Deals:** Tracking revenue potential (`leads`, `pipelines`, `deals`).

## 2. Engagement (WhatsApp Engine)
- **Inbox:** Multi-agent shared inbox communicating natively with Meta APIs (`conversations`, `messages`).
- **Broadcasts:** High-volume outbound marketing (`message_templates`, `broadcasts`).
- **Workflow Automation & AI:** Auto-replies and webhook interceptors (`automations`, `flows`, `bot_settings`).

## 3. Field Force Operations
- **Attendance & Location:** Tracking shift time and geographic movement (`tracking_sessions`, `location_pings`).
- **Site Visits:** Geofenced check-ins to prove physical presence (`site_visits`, `geofences`).
- **Expense Management:** Reimbursing employees for operations and mileage (`expenses`, `expense_types`).
- **Territory Master:** Configurable per-account geographic hierarchy (country/state/city/area, up to 5 renameable levels) + employee area assignment. The single source of truth for customer geography, replacing the flat `contacts.country/state/city/area` columns. Tables `territories`, `employee_area_assignments`; config in `accounts.settings.territory_settings` (jsonb); toggle in `accounts.module_settings.territory`. Foundation dependency for future Route Management. Migrations 101–104. (See `CLAUDE Web.md` → Territory Master for the full contract.)
- **Reporting Hierarchy:** Who-reports-to-whom, reusing `profiles.manager_id` (self-FK) as Reporting Manager + new `profiles.default_approver_id`. Provides the reusable chain-walking primitives (`get_reporting_chain`, `get_all_reports`, `is_in_downline`, `get_approver`) that back "Team" data scope and approval routing, plus DB-enforced cycle prevention. Toggle `accounts.module_settings.reporting_hierarchy` (defaults OFF). Wired into Expense approval as a **suggested** approver (not enforced). Managed inside Employee Master (no separate page). Foundation for Route Management. Migration 106. (See `CLAUDE Web.md` → Reporting Hierarchy.)
