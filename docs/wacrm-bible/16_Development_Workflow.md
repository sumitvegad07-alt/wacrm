*WACRM Engineering Bible* > *AIOS Standards* > *Development Workflow*
[← 15_Testing_Checklist](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/15_Testing_Checklist.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [17_Definition_of_Done →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/17_Definition_of_Done.md)
---

# WACRM AIOS - Development Workflow

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
This document defines the exact sequence of events required to move a feature from a business idea into the production environment of WACRM.

**Why it exists:** WACRM is a Multi-Tenant SaaS with an Offline-First Mobile architecture. Ad-hoc development guarantees data leaks (via missed RLS) or data loss (via missed offline sync queues). This strict, linear workflow prevents architectural drift.

**Who uses it:** Product Managers, Architects, AI Agents, and Engineers.
**When to use it:** At the inception of every single feature, large or small.

---

## 2. The 12-Step Development Workflow

### Phase 1: Business Idea & Product Review
Every feature begins as a business requirement.
- **Inputs:** User feedback, PM request, or Roadmap mandate.
- **Deliverables:** Draft of `19_SPRINT_TEMPLATE.md`.
- **Exit Criteria:** The business value and scope boundaries are explicitly defined.
- **Anti-pattern:** "Let's just build it and see if they use it."

### Phase 2: Architecture Review
Before a single line of code is written, the architecture must be verified.
- **Inputs:** Approved Sprint Template.
- **Deliverables:** Draft of `20_ARCHITECTURE_DECISIONS.md` (ADR) if the feature introduces new external dependencies or modifies the offline sync engine.
- **Approval Gate:** CTO or Principal Architect must approve the ADR.

### Phase 3: Database & Permissions (The Foundation)
Because WACRM uses Supabase, the database *is* the backend API.
- **Inputs:** Approved Architecture.
- **Deliverables:** New SQL migration file in `supabase/migrations/`.
- **Exit Criteria:** 
  - Table contains `account_id`.
  - Row Level Security (RLS) is enabled and tested via `is_account_member`.
  - Supabase CLI has generated updated TypeScript types.
- **Common Mistake:** Forgetting to add the `set_updated_at` trigger to a new table.

### Phase 4: Backend Logic & API
Building the bridge between the DB and UI.
- **Inputs:** Applied Migrations.
- **Deliverables:** Next.js Server Actions (for mutations) or `/api/` route handlers (for webhooks/crons).
- **Exit Criteria:** Input is strictly validated using Zod schemas.

### Phase 5: Web UI Development
- **Inputs:** Server Actions & DB Types.
- **Deliverables:** React Server Components (RSCs) and Client Components placed in `src/app`.
- **Exit Criteria:** Follows the Tailwind/Shadcn design system. Dark mode flash is non-existent.

### Phase 6: Mobile Development
- **Inputs:** The same DB Types used for Web.
- **Deliverables:** Expo Router screens in `app/`.
- **Exit Criteria:** Safe Area Contexts and Keyboard Avoiding Views are implemented.

### Phase 7: Offline Architecture Implementation
*Crucial step for Field Force.*
- **Inputs:** Mobile screens.
- **Deliverables:** Integration with the local SQLite (WatermelonDB) schema and sync queue logic.
- **Exit Criteria:** The feature functions flawlessly with the device in Airplane Mode.

### Phase 8: Quality Assurance (QA)
- **Inputs:** Feature complete on both Web and Mobile.
- **Deliverables:** Executed `15_Testing_Checklist.md`.
- **Exit Criteria:** All edge cases (RLS bypass, fake GPS, concurrency) pass.

### Phase 9: Regression Testing
- **Exit Criteria:** The new feature did not break the core loop (WhatsApp Inbound -> CRM -> Field Tracking -> Expense).

### Phase 10: Documentation
- **Inputs:** QA Passed.
- **Deliverables:** Updates to `10_Module_Details.md` and `11_Web_vs_Mobile_Gap.md`.
- **Exit Criteria:** If a new developer joins tomorrow, they can read the docs and understand the new feature completely.

### Phase 11: Release
Follows the exact steps outlined in `22_RELEASE_PROCESS.md`.

### Phase 12: Post-Release Validation
- **Exit Criteria:** Telemetry and error logs (Sentry/Datadog) confirm 0 immediate regressions in the production environment.
