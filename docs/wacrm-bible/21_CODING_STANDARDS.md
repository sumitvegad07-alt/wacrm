*WACRM Engineering Bible* > *AIOS Standards* > *Enterprise Coding Standards*
[← 20_ARCHITECTURE_DECISIONS](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/20_ARCHITECTURE_DECISIONS.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [22_RELEASE_PROCESS →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/22_RELEASE_PROCESS.md)
---

# WACRM AIOS - Enterprise Coding Standards

*Version: v1.0 | Type: Engineering Process Standard*

## 1. Purpose
To ensure the WACRM codebase looks like it was written by a single, hyper-consistent Senior Engineer, regardless of how many humans or AI agents contribute to it.

## 2. Architecture & File Structure

### 2.1 Web (Next.js)
- **Domain Logic:** Must reside in `src/lib/`. Never put complex business logic (e.g., Haversine calculations) directly inside a React component.
- **Components:** Generic UI primitives go in `src/components/ui`. Domain-specific components go in `src/components/[domain]` (e.g., `src/components/contacts`).
- **Server Actions:** Place in `src/app/actions/` or alongside the domain component. Always suffix with `Action` (e.g., `createContactAction`).

### 2.2 Mobile (Expo)
- **Routing:** Use `app/` strictly for navigation.
- **UI:** Place reusable screens/components in `components/`.
- **State:** Use `React Context` for global state (e.g., Auth, Location Tracking status). Avoid Redux.

## 3. Database & SQL (Supabase)

### 3.1 Migrations
- **Naming:** Must be sequential and descriptive: `066_add_expense_categories.sql`.
- **Idempotency:** Always use `IF NOT EXISTS` for tables/columns. 
- **Destruction:** Never drop a column in a standard migration if data exists. Rename it to `deprecated_[name]` first, migrate the data, then drop in a future release.

### 3.2 Row Level Security (RLS)
- **Mandatory:** Every table must have RLS.
- **Pattern:** Use the `is_account_member(account_id, role)` RPC. Do not duplicate role-checking logic in every policy.

## 4. Frontend & UI Conventions

### 4.1 React Components
- **TypeScript:** `any` is strictly prohibited. Define explicit `interface` or `type` for all props.
- **"use client":** Push this directive as far down the component tree as possible. Do not put `"use client"` on a `page.tsx` file unless absolutely necessary.
- **Tailwind:** Use `cn()` from `clsx` and `tailwind-merge` to combine classes dynamically.

### 4.2 Validation & Error Handling
- **Zod:** All API inputs, Server Action inputs, and Forms must be validated using a Zod schema.
- **Errors:** Never expose raw database errors to the client. Catch Supabase errors and return a sanitized, user-friendly message.

## 5. Comments & Documentation
- **Why, not What:** Do not comment what the code does (e.g., `// loop through contacts`). Comment *why* it does it (e.g., `// O(n) loop acceptable here because contacts array is paginated to max 50 items`).
- **Deprecation:** Use `/** @deprecated Use newFunction() instead. Will be removed in v2.0 */` to mark old code.

## 6. Performance & Caching
- **N+1 Problem:** Avoid querying the database inside a loop. Use SQL `JOIN`s or Supabase relational queries (`contacts(*, tasks(*))`).
- **Next.js Cache:** Understand `revalidatePath` and `revalidateTag`. After a Server Action mutates data, always invalidate the relevant path so the UI updates.
