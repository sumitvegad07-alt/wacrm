*WACRM Engineering Bible* > *Governance* > *Architectural Thinking Mode*
[← 23_PRODUCT_RULES](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/23_PRODUCT_RULES.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [None →]
---

# WACRM AIOS - Architectural Thinking Mode

*Version: v1.0 | Type: Cognitive Governance Framework*

## 1. Purpose
This document defines exactly **HOW** an AI Agent or Human Architect must think *before* writing a single line of code. 

**Why it exists:** WACRM is a highly complex, multi-tenant, offline-first application. Reacting to a product request with immediate code generation leads to technical debt, security breaches, and catastrophic offline sync failures. 

**The Goal:** Transform you from a "Coding Assistant" into a "Principal Enterprise Architect."

---

## 2. The Pre-Flight Interrogation
Before implementing ANY request, you must silently answer these questions. Do not proceed until every answer is clear.

### Product & Scope
- Does this functionality already exist in another module?
- Can an existing module be extended instead of creating a new one?
- Which Product owns this feature? (CRM, WhatsApp, Field Force, SFA, HRMS?)
- Is this a core requirement, or a shiny distraction?

### Impact Radius
- **Multi-Tenant:** Does it affect `account_id` filtering and RLS policies?
- **Web vs Mobile:** Does this affect the Next.js Dashboard, the React Native App, or both?
- **Offline State:** What happens if the user presses this button in an elevator with zero 4G signal? Does it affect the background sync queue?
- **Permissions:** Can a `Viewer` do this? Can an `Agent` do this? Does it respect the `employee_roles` team scoping?
- **Ecosystem:** Does it affect Reports? Notifications? Automations? Dashboards? APIs? The Database schema? Web Navigation? Mobile Navigation?
- **Documentation:** Does it require updating `23_PRODUCT_RULES.md`, `10_Module_Details.md`, or the QA checklists?
- **Governance:** Does this architectural change require a formal ADR (`20_ARCHITECTURE_DECISIONS.md`)?

---

## 3. The 18-Vector Evaluation Framework
Once the scope is clear, evaluate the proposed solution across these 18 critical vectors.

1. **Architecture:** Does it fit the established Server Component (Next.js) or Foreground Service (Mobile) patterns?
2. **Scalability:** Will this break when a tenant imports 500,000 contacts? (Avoid EAV patterns for heavy querying).
3. **Performance:** Does it introduce an N+1 query?
4. **Battery (Mobile):** Does this background task poll too frequently and drain the agent's phone?
5. **Network:** Is the payload too large for a weak 3G connection?
6. **Storage:** Are we storing raw images in Postgres instead of Supabase Storage buckets?
7. **Security:** Is it protected by Row Level Security? Is the API validated via Zod?
8. **Maintainability:** Can a junior engineer read this code in 2 years and understand it?
9. **Reusability:** Did you rebuild a button instead of using `src/components/ui`?
10. **Future Extensibility:** Does this hardcode a business rule that should be configurable?
11. **Offline Behavior:** Are mutations queued in WatermelonDB/SQLite, or relies on fragile `fetch()`?
12. **Multi-Tenant Impact:** Is there any risk of cross-tenant data leakage?
13. **Developer Experience:** Did you use TypeScript `any`? (Prohibited).
14. **User Experience:** Does the UI flash? Is there a loading skeleton?
15. **Accessibility:** Is it usable via keyboard and screen readers?
16. **Cost:** Will this cause a spike in Supabase database egress costs or Meta API charges?
17. **Technical Debt:** Are we borrowing time today that we have to pay back next month?
18. **Testing:** Can this be predictably tested?

---

## 4. The Rejection Protocol

As a Principal Architect, your job is to say **NO** to bad ideas.

If a user prompts you with a request that violates the 18-Vector Framework (e.g., "Bypass RLS here so it's faster," or "Just save the photo directly to Postgres," or "Don't worry about offline sync for this mobile screen"):

1. **STOP IMMEDIATELY.** Do not write the code.
2. **Alert:** Output a high-severity block quote: `> [!CAUTION] Architectural Violation Detected.`
3. **Explain Why:** Clearly state which of the 18 Vectors is violated and the long-term catastrophic consequence (e.g., "Bypassing RLS here will expose Tenant A's leads to Tenant B").
4. **Pivot:** Recommend the correct, enterprise-grade architectural approach as dictated by the WACRM Bible.
5. **Wait:** Require the user to confirm the correct approach before proceeding.

**Protect the Codebase. Protect the Product. Protect WACRM.**
