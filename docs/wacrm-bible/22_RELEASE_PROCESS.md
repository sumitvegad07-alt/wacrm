*WACRM Engineering Bible* > *AIOS Standards* > *Release Process*
[← 21_CODING_STANDARDS](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/21_CODING_STANDARDS.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [23_PRODUCT_RULES →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/23_PRODUCT_RULES.md)
---

# WACRM AIOS - Release Process

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
This document defines the strict lifecycle that every feature must follow to move from the `development` branch into the `production` environment. 

**Why it exists:** Deploying to a multi-tenant SaaS requires absolute caution. A broken release can halt operations for hundreds of companies simultaneously. Mobile apps cannot be hot-fixed instantly due to App Store review times.
**Who uses it:** Tech Leads, QA Engineers, and DevOps.

---

## 2. The 11-Step Release Pipeline

### Step 1: Development & Self Review
- Developer completes the feature.
- Developer strictly verifies the `17_Definition_of_Done.md`.
- Pull Request (PR) is opened against the `staging` branch.

### Step 2: Peer / AI Review
- A Senior Engineer or AI Agent reviews the PR.
- **Focus:** RLS policies, N+1 queries, UI consistency, and Zod validations.
- **Action:** Approved PR is merged into `staging`.

### Step 3: Staging Deployment
- Vercel automatically builds and deploys the `wacrm` web app to a staging URL.
- Supabase Staging environment receives the new SQL migrations.

### Step 4: QA & Regression (Staging)
- QA Team executes the `15_Testing_Checklist.md`.
- **Focus:** Does the new feature break the core loop (WhatsApp -> CRM -> Field Tracking)?

### Step 5: Mobile APK / TestFlight Build
- If the feature touches mobile, an EAS Build (`eas build --profile preview`) is triggered.
- The `.apk` or TestFlight build is distributed to internal testers.

### Step 6: Documentation Finalization
- The Engineer must update `docs/wacrm-bible/` to reflect the new reality.
- The `CHANGELOG.md` is updated with a human-readable summary of the changes.

### Step 7: Production Merge
- `staging` is merged into `main`.
- Vercel begins the Production build.

### Step 8: Database Migration (Production)
- **CRITICAL:** Before the Vercel build completes, the Supabase Production environment must receive the SQL migrations via the Supabase CLI (`supabase db push`).
- **Rollback Plan:** If the migration fails, the Vercel deployment must be cancelled immediately.

### Step 9: Mobile Production Build
- Trigger `eas build --profile production`.
- Submit to Google Play Console and Apple App Store.

### Step 10: Post-Release Smoke Test
- Immediately after deployment, a designated engineer logs into a test tenant on Production.
- They must manually verify:
  1. Login works.
  2. A WhatsApp message can be received.
  3. A GPS ping can be saved.

### Step 11: Lessons Learned (Retrospective)
- If a bug escaped into production, a blameless post-mortem is held.
- The `17_Definition_of_Done.md` or `15_Testing_Checklist.md` must be updated to ensure the bug is caught automatically next time.
