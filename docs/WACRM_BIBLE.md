# WACRM Engineering Handbook - Master Index

*Version 5.0 | The Unified Source of Truth for WACRM Engineering & Product*

This document serves as the master index for the unified WACRM Engineering Handbook. It is the mandatory starting point for all AI agents, engineers, product managers, and architects. If a feature or logic rule is not defined in this Handbook or the database migrations, it does not exist.

---

## 📖 Table of Contents

### 1. Executive Summary & Vision
- **[Executive Summary & Product Vision](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/01_Project_Overview.md):** The core identity of WACRM—unifying inside sales (WhatsApp) and outside sales (Field Force GPS).
- **[Product Portfolio & Packaging](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/01_Project_Overview.md#2-product-packaging-architecture):** Breakdown of Core CRM, WhatsApp Add-on, Field Force Add-on, and Automation Add-on.

### 2. Module Index & Deep Specifications
*Detailed breakdowns of screen flows, CRUD rules, edge cases, and tables for every capability.*
- **[Module Inventory Overview](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/02_Module_Inventory.md)**
- **[Module Deep Dives](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/10_Module_Details.md)**
  - Contacts (CRM Core)
  - Leads & Sales Pipelines
  - Field Force: Location Tracking & Attendance
  - Field Force: Site Visits & Geofencing
  - Expense Management (Odometer & Receipts)
  - WhatsApp Inbox & Automations
- **[Web vs Mobile Feature Gap (Roadmap)](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/11_Web_vs_Mobile_Gap.md):** The matrix defining which modules exist on which platform.

### 3. Architecture & Infrastructure
- **[Web Architecture (Next.js)](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/06_Web_Architecture.md):** Server Components, App Router rules, and RLS handling.
- **[Mobile Architecture (Expo)](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/05_Mobile_Architecture.md):** React Native structure, Foreground Services, and hardware dependencies.
- **[Database Schema & Tenancy](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/03_Database.md):** Supabase migrations, Triggers, RPCs, and strict Row Level Security rules.
- **[Offline-First Architecture](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/12_Offline_First_Architecture.md):** Strategy for local SQLite (WatermelonDB), queue architecture, and LWW conflict resolution.

### 4. APIs & Integration
- **[API Documentation](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/04_API_Documentation.md):** Meta Webhook lifecycle, Public API constraints, and Server Actions.

### 5. Security & Navigation
- **[Permission Matrix](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/07_Permission_System.md):** System Roles (Owner/Admin/Agent/Viewer) vs. Business Scopes (Own/Team/All) and Mobile Device Approvals.
- **[Navigation Flows](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/13_Navigation_Flow.md):** All routing paths, tabs, modals, and deep links across both Web and Mobile.

### 6. UI Engineering & Standards
- **[UI Design System](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/08_UI_Design_System.md):** Premium Dark Mode, Glassmorphism, and engineering SOPs for UI creation.
- **[Component Library](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/14_Component_Library.md):** Inventory of Shadcn UI primitives and domain-specific reusable React components. Prevent duplicate UI development here.

### 7. Quality Assurance
- **[Testing Standards & Checklist](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/15_Testing_Checklist.md):** Enterprise acceptance criteria covering RLS bypass attempts, offline GPS queues, and Realtime race conditions.

### 8. Roadmap & Technical Debt
- **[Future Roadmap](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/09_Future_Roadmap.md):** Known technical debt (EAV bottlenecks, API rate limits) and future product expansions (HRMS, Advanced SFA).

### 9. AI Operating System (AIOS) & Engineering Standards
*The rules governing how WACRM is built, tested, and maintained.*
- **[Development Workflow](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/16_Development_Workflow.md):** The 12-step stage-gate process from idea to production.
- **[Definition of Done](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/17_Definition_of_Done.md):** The non-negotiable checklist for RLS, Offline-sync, and Quality.
- **[AI Operating System](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/18_AI_OPERATING_SYSTEM.md):** The core intelligence prompt and reasoning framework for AI agents.
- **[Sprint Template](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/19_SPRINT_TEMPLATE.md):** Standardized epic planning, scope boundaries, and impact analysis.
- **[Architecture Decisions (ADR)](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/20_ARCHITECTURE_DECISIONS.md):** The template and rules for preserving technical history and trade-offs.
- **[Coding Standards](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/21_CODING_STANDARDS.md):** Next.js RSCs, React Native structures, Zod validations, and SQL migration rules.
- **[Release Process](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/22_RELEASE_PROCESS.md):** The 11-step CI/CD pipeline, QA gates, and post-release validation.

### 10. Product Rules & Cognitive Governance
*The business rules that define WHY features exist, and the framework defining HOW architects must think.*
- **[Product Rules (The Business DNA)](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/23_PRODUCT_RULES.md):** The definitive module ownership, conversion rules, and lifecycle boundaries.
- **[Architectural Thinking Mode](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/24_ARCHITECTURAL_THINKING_MODE.md):** The pre-flight interrogation and 18-Vector Evaluation required before writing any code.

---

## 📝 Change Log
- **Version 5.0 (2026-07-14):** The Consistency Audit. Refactored all 24 documents into a single, cohesive, navigable Handbook. Removed redundancies between Module Details, Inventory, and Product Rules. Standardized terminology (e.g., "Field Agent").
- **Version 4.0 (2026-07-14):** Added Phase B.1 (Engineering Governance Expansion). Introduced Documents 23 and 24 to establish permanent Product Rules and the AI Architectural Thinking Framework.
