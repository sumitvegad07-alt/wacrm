*WACRM Engineering Bible* > *Governance* > *Product Business Rules*
[← 22_RELEASE_PROCESS](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/22_RELEASE_PROCESS.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [24_ARCHITECTURAL_THINKING_MODE →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/24_ARCHITECTURAL_THINKING_MODE.md)
---

# WACRM Engineering Bible - Product Business Rules

*Version: v1.0 | Type: Business Governance*

## 1. Purpose
This document defines the **BUSINESS DNA** of WACRM. While the codebase explains *how* a feature works, this document explains *why* it exists and the inviolable rules it must follow. Future engineers and AI agents must NEVER infer business behavior from reading SQL or React code. If a business rule is not defined here, the feature is not defined.

---

## 2. Definitive Product Ownership

No module exists in isolation. Every feature belongs to a core Product.

### Core CRM
- **Modules:** Contacts, Companies, Leads, Deals, Pipelines, Tasks.
- **Owner:** Core Platform Team.
- **Goal:** The foundational system of record for all external entities.

### WhatsApp CRM
- **Modules:** Inbox, Broadcasts, Templates, AI Replies, Automations.
- **Owner:** Engagement Team.
- **Goal:** Unifying inbound and outbound communication securely via Meta APIs.

### Field Force Tracking (FFT)
- **Modules:** Attendance (Punch), GPS Tracking, Site Visits, Expenses.
- **Owner:** Field Operations Team.
- **Goal:** Providing irrefutable proof of work, location, and expenditure for outside teams.

### Future Expansion: HRMS
- **Modules:** Leave Requests, Payroll, Shift Management.
- **Goal:** Evolving basic "Punch In" attendance into enterprise human resources.

### Future Expansion: Sales Force Automation (SFA)
- **Modules:** Beat Planning, Route Optimization, Orders, Quotations.
- **Goal:** Dictating *where* a field agent goes, rather than just reacting to where they went.

---

## 3. Deep Module Business Rules

### 3.1 Module: Contacts
- **Purpose:** The ultimate source of truth for an individual human interacting with the tenant.
- **Business Goal:** To provide a 360-degree view of communication, sales, and field visits for one person.
- **Primary Personas:** Admin, Agent.
- **Workflow Rules:** A Contact can be created manually, via WhatsApp webhook, or via Lead conversion.
- **Validation Rules:** Phone numbers MUST be unique per `account_id` and formatted in E.164.
- **Lifecycle Rules:**
  - *Deletion:* A Contact cannot be hard-deleted if they have associated financial records (Deals/Expenses). They must be archived.
  - *Merge:* If a duplicate phone number is detected, the newer contact must be merged into the older contact, transferring all `task_id` and `conversation_id` foreign keys.
- **Dependencies:** Required by WhatsApp, Visits, and Deals.
- **Offline Behavior:** Read-only on mobile. Cannot create offline yet.
- **Permission Behavior:** Agents can only see Contacts assigned to their Team (unless explicitly granted Company-wide access).

### 3.2 Module: Leads
- **Purpose:** To track unqualified potential business before they become formal Contacts or Deals.
- **Business Goal:** High-volume ingestion and qualification without polluting the core CRM.
- **Workflow & Conversion Rules:**
  - A Lead can be converted into a Contact.
  - A Lead may only be converted ONCE. Converted Leads cannot be converted again.
  - Deleting converted Leads is strictly prohibited (historical audit trail).
  - During conversion, all attached Activities and Tasks MUST migrate to the newly created Contact.
- **Limitations:** Leads do not have WhatsApp Conversations. They must be converted to Contacts first.

### 3.3 Module: Deals & Pipelines
- **Purpose:** To track revenue opportunities across discrete stages.
- **Validation Rules:** A Deal MUST belong to a Pipeline and a specific Stage. A Deal MUST be attached to a Contact or a Company.
- **Lifecycle Rules:** Once a Deal enters "Closed Won" or "Closed Lost", it is locked. Only an Admin can reopen a closed Deal.
- **Reporting Behavior:** Values are aggregated strictly based on the tenant's default currency.

### 3.4 Module: WhatsApp Inbox
- **Purpose:** To act as the central hub for all customer support and inside sales communication.
- **Workflow Rules:** 
  - Messages arrive via webhook.
  - If the sender does not exist, a Contact is silently created.
  - An AI Bot evaluates the message FIRST. If the AI cannot resolve it, it marks the conversation as "Unread" for a human Agent.
- **Notification Behavior:** Unread messages trigger an in-app badge increment.
- **Limitations:** Only Text, Images, and basic Documents are supported. Audio notes are currently not transcribed.

### 3.5 Module: Broadcasts (WhatsApp)
- **Business Goal:** To send templated marketing or operational blasts to thousands of Contacts simultaneously.
- **Validation Rules:** Cannot send arbitrary text. MUST use a Meta-approved Message Template.
- **Lifecycle Rules:** 
  - Once a Broadcast is in `sending` state, it CANNOT be cancelled or edited.
- **Reporting Behavior:** Delivery and Read receipts update incrementally in real-time.

### 3.6 Module: Attendance & GPS Tracking (FFT)
- **Purpose:** To generate irrefutable proof of working hours and geographic location.
- **Workflow Rules:** 
  - An Agent must "Punch In" to start a `tracking_session`.
  - The mobile app requests Foreground Location permissions.
- **Validation Rules:** The app MUST capture a "Selfie" during Punch In to prevent buddy-punching.
- **Offline Behavior (CRITICAL):** Location pings MUST queue locally in SQLite/FileSystem if the phone drops cellular signal. Data loss here causes payroll disputes and is unacceptable.
- **Lifecycle Rules:** Sessions older than 90 days are archived into cold storage, retaining only the aggregated daily distance.

### 3.7 Module: Site Visits (FFT)
- **Purpose:** To prove an Agent visited a specific Contact's physical location.
- **Workflow Rules:** Agent clicks "Check In" -> App records coordinates -> Agent works -> Agent clicks "Check Out".
- **Validation Rules:** 
  - Check-in cannot occur if the Agent's GPS coordinates are more than 500 meters from the Contact's saved Address. (Geofence Validation).
  - A Check-out cannot occur without an active Check-in.

### 3.8 Module: Expenses (FFT)
- **Purpose:** To reimburse Agents for operational costs (Fuel, Meals, Hotels).
- **Workflow Rules:** Agent submits claim + photos -> Admin reviews -> Admin approves/rejects.
- **Validation Rules:** 
  - If the Expense Type is "Fuel/Mileage", the Agent MUST upload a "Start Odometer" and "End Odometer" photo.
- **Lifecycle Rules:** Approved Expenses are locked. Only an Admin with `Owner` privileges can reverse an Approved Expense.
- **Offline Behavior:** Mobile app queues the textual data and the high-res photos locally, attempting chunked uploads when signal is restored.
