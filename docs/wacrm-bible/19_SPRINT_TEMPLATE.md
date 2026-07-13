*WACRM Engineering Bible* > *AIOS Standards* > *Sprint Template*
[← 18_AI_OPERATING_SYSTEM](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/18_AI_OPERATING_SYSTEM.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [20_ARCHITECTURE_DECISIONS →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/20_ARCHITECTURE_DECISIONS.md)
---

# WACRM AIOS - Sprint Template

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
This document provides the mandatory structure for defining a Development Sprint or Feature Epic. No feature may enter the "Development" phase until this template is fully populated and approved by the Architecture Team.

**Why it exists:** To prevent scope creep, ensure cross-platform parity (Web + Mobile), and force engineers to consider offline/RLS constraints before coding.
**Who uses it:** Product Managers (to define the "What") and Principal Engineers (to define the "How").

---

# [Insert Feature/Sprint Name Here]

## 1. Business Context
- **Sprint Goal:** (e.g., "Allow field agents to capture multiple photos per expense claim.")
- **Business Value:** (e.g., "Reduces fraudulent claims by requiring both receipt and odometer visual proof.")
- **Primary Persona:** (e.g., Field Agent submitting, Office Admin reviewing).

## 2. Scope Boundaries
- **In Scope:** (e.g., Updating mobile UI to accept multiple photos, updating web UI to display a photo carousel).
- **Out of Scope:** (e.g., AI-based receipt OCR scanning - to be handled in a future sprint).

## 3. Impact Analysis

### 3.1 Database & Security
- **Affected Tables:** (e.g., `expenses`, `expense_attachments` [NEW]).
- **Permission Impact:** (e.g., Agents can insert into `expense_attachments` where `expense.user_id = auth.uid()`).
- **Migration Required:** YES / NO.

### 3.2 Platform Impact
- **Affected Web Screens:** (e.g., `/(dashboard)/expenses/[id]/page.tsx`).
- **Affected Mobile Screens:** (e.g., `app/(tabs)/expense/[id].tsx`).
- **Affected APIs:** (e.g., Supabase Storage Bucket rules for `expenses`).

### 3.3 Offline Impact (Crucial for Mobile)
- **Offline Behavior:** (e.g., Photos are saved to `expo-file-system`. Background sync task attempts upload. Expense is marked 'Pending Sync' until all photos upload successfully).

## 4. Acceptance Criteria & Testing
- **Scenario 1 (Happy Path):** User attaches 3 photos, submits, admin sees all 3.
- **Scenario 2 (Offline Path):** User attaches 2 photos in Airplane mode. Submits. App queues. User regains signal. Photos upload in background.
- **Scenario 3 (Security Path):** Agent B attempts to fetch Agent A's expense attachment via direct URL. Supabase Storage denies access.

## 5. Risks & Dependencies
- **Dependencies:** Requires Expo Camera SDK update?
- **Risks:** High memory usage on low-end Android devices if user attaches 10 high-res photos at once. Mitigation: Compress images before local save.

## 6. Deliverables Checklist
- [ ] Database Migrations applied.
- [ ] Web UI updated and deployed to Staging.
- [ ] Mobile UI updated and built to EAS Preview.
- [ ] `10_Module_Details.md` updated.
- [ ] QA Sign-off.
