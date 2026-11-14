# OZZO DMS — Plan 3: the portal app a distributor signs into

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer who has been given a DMS login can open the portal, sign in with their email and password, and read their own business — their outstanding, what they bought from the company, what their own customers bought, who those customers are, and their receipts — and can see nothing of any other distributor and nothing of any other tenant.

**Architecture:** A separate Next.js app in its own repository at `C:\Wacrm\ozzo-dms`, holding the **anon key only**. Every screen is a server component that calls one of the eight `portal_*` functions built in Plan 2 and renders what comes back. The app has `select` on no table, mints no users, and contains no tenancy logic of its own: "who may see what" was decided once, in `portal_visible_contact_ids()`, and this app cannot widen it even with a bug. Spec §1: *duplicate what is cosmetic, never duplicate what is arithmetic* — the design tokens are copied from the CRM, the money is not.

**Tech Stack:** Next.js 16.2.6 (App Router), React 19.2.4, TypeScript 6, Tailwind 4 (`@tailwindcss/postcss`), `@supabase/ssr` 0.10.3, `@supabase/supabase-js` 2.107, `lucide-react` 1.29, Vitest 4.1.9 + `@testing-library/react` 16.3 + jsdom 26. Dev port **3100** (the CRM owns 3000).

**Spec:** `wacrm-web/docs/engineering/specifications/ozzo-dms-product-v1.md` — §4 (the eight screens and their names), §5.2 and §5.3 (login is email + password, there is no forgot-password), §6 (the portal reads through functions only), §8 (the order screen is new and slim, not the CRM's), §12 (what a portal user sees when something is wrong). Read §12 before Task 2; it is a table of specified behaviours, not suggestions.

**Builds on:** `2026-11-08-dms-plan-2-visibility-and-portal-app.md`, which is DONE and applied on production. The eight functions exist and are verified live. This plan writes **no SQL at all**.

**Plan 3 of 4.** Plan 4 is placing orders (`portal_place_order`, the slim order screen, schemes), then announcements, the private activity list and the four reports. At the end of this plan a distributor can sign in and look at their business; they cannot yet place an order, and the three screens that need Plan 4 are deliberately absent from the menu rather than present and dead.

## Global Constraints

- **Nothing is pushed, and nothing is deployed.** The founder's instruction stands: "once we will completely develop everything test everything than we will push everything to live." `C:\Wacrm\ozzo-dms` is a **local git repository with no remote**. No Vercel project, no `dms.ozzo.co.in` DNS record, in this plan.
- **This app never holds a service-role key.** Not in `.env.local`, not in `.env.local.example`, not in a comment. Task 1 Step 3 is a test that fails if one ever appears. If a feature seems to need one, it belongs in the CRM (that is why minting a login lives at `wacrm-web/src/app/api/portal-access/route.ts`).
- **The anon key and the project URL are the only secrets, and the anon key is already public** — it ships in every browser bundle. Reading production with it is therefore safe, and this app only ever reads, and only through `portal_*` functions. **Never** put `SUPABASE_SERVICE_ROLE_KEY` in this repo's env, and never run a migration or a script against production from it.
- **Dates are already account-local.** `orders.date` and `payments.payment_date` are `DATE` columns recorded in the account's own day. Format the string; never `new Date(s).toISOString()`, never a timezone conversion. `portal_me().timezone` exists for timestamps, and v1 renders none.
- **Money is formatted with `portal_me().currency`**, never a hardcoded `₹`.
- **No employee's name is ever shown.** Spec §17 q4 is answered no, and `portal_orders` does not return one. If a screen seems to want "who booked this", it says *Portal* or *Company* and stops.
- **No margin, no cost, no other customer's price.** A distributor sees their own prices and their own customers' prices, because those are the prices on their own orders — nothing else.
- **English only** (spec §17 q5).
- **Every sentence a distributor can read is plain English and says what to do.** Never a raw Supabase or Postgres message. §12 gives the exact wording for the cases that matter.
- Before every commit: `npm run typecheck` and `npm test` in `C:\Wacrm\ozzo-dms`.
- The CRM is untouched by this plan. If a change there seems necessary, stop and say so — it is a different repository with a different test suite.

---

## File structure

Everything lives in `C:\Wacrm\ozzo-dms`. Paths below are relative to it.

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.local.example`, `README.md` | the project |
| `app/globals.css` | the copied design tokens, and only those (§1: cosmetic may be duplicated) |
| `app/layout.tsx` | html shell, font, `data-mode` |
| `lib/supabase/client.ts` | browser client, anon key, used by the login form only |
| `lib/supabase/server.ts` | server client over cookies, anon key, used by every screen |
| `lib/supabase/no-privileged-key.test.ts` | the test that keeps this app powerless |
| `middleware.ts` | refreshes the session cookie, sends a signed-out visitor to `/login` |
| `lib/portal/api.ts` | one typed function per `portal_*` RPC. The ONLY place this app talks to the database |
| `lib/portal/types.ts` | the shapes those eight functions return |
| `lib/portal/format.ts` | money, dates, status words |
| `lib/portal/format.test.ts` | its tests |
| `lib/auth/sign-in-message.ts` | Supabase auth error → a sentence a distributor can act on |
| `lib/auth/sign-in-message.test.ts` | its tests |
| `app/login/page.tsx` | the sign-in screen |
| `app/(portal)/layout.tsx` | the signed-in shell: nav, company name, sign out, and the withdrawn-access sentence |
| `app/(portal)/page.tsx` | Dashboard |
| `app/(portal)/purchase-orders/page.tsx` | what they buy from the company |
| `app/(portal)/sales-orders/page.tsx` | what their customers buy from them |
| `app/(portal)/orders/[id]/page.tsx` | one order with its lines |
| `app/(portal)/customers/page.tsx` | My Customers |
| `app/(portal)/payments/page.tsx` | Payments and outstanding |
| `components/*.tsx` | `DataTable`, `StatCard`, `PageHeader`, `EmptyState`, `MoneyCell` — small and shared |

---

### Task 1: The repository, the shell, and the proof it can never hold a privileged key

The order matters: the key test is written in the first task, before there is anything to protect, because the one thing that must never become true of this app is that it holds a key which can read across tenants.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.local.example`, `README.md`
- Create: `app/globals.css`, `app/layout.tsx`
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `middleware.ts`
- Test: `lib/supabase/no-privileged-key.test.ts`

**Interfaces:**
- Produces: `createBrowserSupabase(): SupabaseClient` from `lib/supabase/client`; `createServerSupabase(): Promise<SupabaseClient>` from `lib/supabase/server`. Every later task uses the server one.

- [ ] **Step 1: Create the project files**

`package.json`:

```json
{
  "name": "ozzo-dms",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3100",
    "build": "next build",
    "start": "next start -p 3100",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/ssr": "^0.10.3",
    "@supabase/supabase-js": "^2.107.0",
    "lucide-react": "^1.29.0",
    "next": "16.2.6",
    "react": "19.2.4",
    "react-dom": "19.2.4"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^25.9.5",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.6",
    "jsdom": "^26.1.0",
    "tailwindcss": "^4",
    "typescript": "^6",
    "vitest": "^4.1.9"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app reads one database through eight functions. It serves no images
  // from anywhere, posts to no third party, and embeds nothing.
  reactStrictMode: true,
};

export default nextConfig;
```

`postcss.config.mjs`:

```js
const config = { plugins: ["@tailwindcss/postcss"] };
export default config;
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") },
  },
});
```

`.gitignore`:

```
node_modules/
.next/
out/
.env.local
.env*.local
*.tsbuildinfo
next-env.d.ts
.vercel
```

`.env.local.example`:

```
# The DMS portal reads ONE database, through eight portal_* functions, with the
# anon key. That key is public by design — it ships in every browser bundle.
#
# NEVER add a service-role key to this file or to .env.local. This app must not
# be able to mint a user or read across tenants even if it is compromised;
# creating a DMS login lives in the CRM, at src/app/api/portal-access/route.ts.
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

- [ ] **Step 2: Write the key test first**

Create `lib/supabase/no-privileged-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The whole security argument for shipping a second app is that this one is
// powerless: anon key only, select on no table, and no way to mint a user.
// A service-role key here would undo all of it in one line, so the rule is a
// test rather than a convention. Mirrors wacrm-web's own
// src/lib/supabase/service-role-key.test.ts, which exists for the opposite
// reason — there the key is required, here it is forbidden.
const FORBIDDEN = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SERVICE_ROLE_KEY",
  "service_role",
  "SUPABASE_SECRET",
  "supabaseServiceRole",
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "out", ".vercel"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs|json|css|md|example)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the portal app holds no privileged key", () => {
  const root = process.cwd();
  const files = walk(root);

  it("has files to scan, so a passing run means something", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it("mentions no service-role key anywhere", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith("no-privileged-key.test.ts")) continue; // this file names them on purpose
      const src = readFileSync(f, "utf8");
      for (const needle of FORBIDDEN) {
        if (src.includes(needle)) offenders.push(`${f.replace(root, "")} → ${needle}`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("creates its clients with the ANON key and nothing else", () => {
    for (const f of files.filter((f) => /lib[\\/]supabase[\\/](client|server)\.ts$/.test(f))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
      expect(src, f).not.toMatch(/process\.env\.(?!NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY))/);
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd /c/Wacrm/ozzo-dms && npm install && npx vitest run lib/supabase/no-privileged-key.test.ts`

Expected: the third test FAILS, because `lib/supabase/client.ts` and `lib/supabase/server.ts` do not exist yet, so the filter finds nothing and the loop asserts nothing — **and that is itself the fault to notice**. Add a fourth assertion before moving on:

```ts
  it("really found both client files, or the test above proved nothing", () => {
    const found = files.filter((f) => /lib[\\/]supabase[\\/](client|server)\.ts$/.test(f));
    expect(found.map((f) => f.replace(root, "")).sort().join(",")).toContain("client.ts");
    expect(found.map((f) => f.replace(root, "")).sort().join(",")).toContain("server.ts");
  });
```

Re-run. Expected: that fourth test fails with neither file found. This is the O10 lesson from Plan 2 — a loop over an empty list is a pass that measures nothing.

- [ ] **Step 4: Write the two clients and the middleware**

`lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// One client for the whole browser session. Several clients contend for the
// auth lock and fail requests intermittently — the CRM learned that the hard
// way (see wacrm-web src/lib/supabase/client.ts).
let cached: SupabaseClient | undefined;

export function createBrowserSupabase(): SupabaseClient {
  if (cached) return cached;
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}
```

`lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function createServerSupabase(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll();
        },
        setAll(toSet) {
          try {
            toSet.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // Called from a server component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
```

`middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Two jobs: keep the session cookie fresh, and send a signed-out visitor to the
// sign-in screen. It deliberately does NOT decide whether this user is a portal
// customer — that is portal_me()'s answer and the signed-in layout asks it.
// A middleware that tried would be a second place where "who may come in" is
// decided, and the two would drift.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isLogin = path === "/login";

  if (!data.user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (data.user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 5: Write the tokens and the html shell**

`app/globals.css`. **A deliberate decision: the CRM's `globals.css` is 554 token lines and this copies a dozen.** Spec §1 permits copying what is cosmetic, and a dozen tokens drifting looks slightly off, while a dozen of 554 copied wrongly looks broken. Same convention as the CRM — `html[data-mode="light"|"dark"]` — and the same brand violet `#7834e8`.

```css
@import "tailwindcss";

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-destructive: var(--destructive);
  --radius-card: 0.625rem;
}

/* Light is the default here, unlike the CRM: a distributor opens this on a
   phone in a shop, in daylight. The dark values are the CRM's own. */
:root,
html[data-mode="light"] {
  --background: #fbfcfd;
  --foreground: #16181d;
  --card: #ffffff;
  --card-foreground: #16181d;
  --muted: #f3f4f6;
  --muted-foreground: #5c6069;
  --border: #e4e6ea;
  --primary: #7834e8;
  --primary-foreground: #fafafa;
  --destructive: #c70009;
}

html[data-mode="dark"] {
  --background: #05070b;
  --foreground: #fafafa;
  --card: #0f1216;
  --card-foreground: #fafafa;
  --muted: #181b1f;
  --muted-foreground: #8c8f95;
  --border: #26292e;
  --primary: #7834e8;
  --primary-foreground: #fafafa;
  --destructive: #e7000b;
}

html,
body {
  background: var(--background);
  color: var(--foreground);
}

/* A table of money is read by column, so the figures must line up. */
.tabular {
  font-variant-numeric: tabular-nums;
}
```

`app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OZZO DMS",
  description: "Your orders, your customers and your account with the company.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="light">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 6: Run the tests and the type check**

Run: `cd /c/Wacrm/ozzo-dms && npm test && npm run typecheck`

Expected: all four tests in `no-privileged-key.test.ts` pass, `tsc --noEmit` clean.

- [ ] **Step 7: Write the README**

`README.md`: what this app is (the DMS portal, a second face on the CRM's database), what it is not (it holds no privileged key and writes nothing in Plan 3), how to run it (`npm run dev`, port 3100), where the rules live (`wacrm-web/supabase/migrations/20261108110000_*` and `20261108120000_*`), and the one-line warning that `.env.local` points at production and must never gain a service-role key.

- [ ] **Step 8: Commit**

```bash
cd /c/Wacrm/ozzo-dms
git init
git add -A
git commit -m "The DMS portal app: an empty shell that cannot read anything it should not"
```

---

### Task 2: Sign in, and what happens when access is withdrawn

Spec §5.2: email and password, exactly like an employee, and **no forgot-password** — the address need not be real, so nothing can be sent to it; the admin resets the password on the customer page. Spec §12: the two sentences that matter are specified, not left to the framework.

**Files:**
- Create: `lib/auth/sign-in-message.ts`, `app/login/page.tsx`
- Test: `lib/auth/sign-in-message.test.ts`

**Interfaces:**
- Consumes: `createBrowserSupabase()`.
- Produces: `signInMessage(raw: string | null | undefined): string` — a Supabase auth error turned into a sentence a distributor can act on. Used by the login form only.

- [ ] **Step 1: Write the failing test**

Create `lib/auth/sign-in-message.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { signInMessage } from "./sign-in-message";

describe("signInMessage", () => {
  it("turns bad credentials into what to do about it", () => {
    const m = signInMessage("Invalid login credentials");
    expect(m).toBe("That email or password is not right. Please check them, or ask your company to reset your password.");
  });

  it("explains an unconfirmed address without mentioning email, because none is ever sent", () => {
    // A DMS login's address need not be real, so "check your inbox" would be
    // advice nobody can follow. The admin creates these users already
    // confirmed; if one is not, it is the company's job to fix.
    const m = signInMessage("Email not confirmed");
    expect(m).toBe("This login is not active yet. Please ask your company to switch on your DMS access again.");
    expect(m.toLowerCase()).not.toContain("inbox");
  });

  it("says plainly when there are too many attempts", () => {
    expect(signInMessage("Request rate limit reached")).toBe(
      "Too many tries. Please wait a minute and try again.",
    );
  });

  it("never shows a raw database or network message", () => {
    const m = signInMessage('duplicate key value violates unique constraint "x"');
    expect(m).toBe("Could not sign you in just now. Please try again, or contact your company.");
    expect(m).not.toContain("constraint");
  });

  it("handles nothing at all", () => {
    expect(signInMessage(null)).toBe("Could not sign you in just now. Please try again, or contact your company.");
    expect(signInMessage(undefined)).toBe("Could not sign you in just now. Please try again, or contact your company.");
    expect(signInMessage("")).toBe("Could not sign you in just now. Please try again, or contact your company.");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd /c/Wacrm/ozzo-dms && npx vitest run lib/auth/sign-in-message.test.ts`
Expected: FAIL — cannot resolve `./sign-in-message`.

- [ ] **Step 3: Write it**

`lib/auth/sign-in-message.ts`:

```ts
// Spec §12: a portal user never sees a raw Supabase or Postgres message. Every
// sentence here says what the reader can do next, and the thing they can
// usually do is ask their own company — which is also the only way a password
// gets reset, because a DMS login's address need not be able to receive mail
// (spec §5.2).
const GENERIC =
  "Could not sign you in just now. Please try again, or contact your company.";

export function signInMessage(raw: string | null | undefined): string {
  if (!raw) return GENERIC;
  const s = raw.toLowerCase();

  if (s.includes("invalid login credentials") || s.includes("invalid credentials")) {
    return "That email or password is not right. Please check them, or ask your company to reset your password.";
  }
  if (s.includes("email not confirmed") || s.includes("not confirmed")) {
    return "This login is not active yet. Please ask your company to switch on your DMS access again.";
  }
  if (s.includes("rate limit") || s.includes("too many requests")) {
    return "Too many tries. Please wait a minute and try again.";
  }
  if (s.includes("failed to fetch") || s.includes("network")) {
    return "Could not reach the server. Please check your internet connection and try again.";
  }
  return GENERIC;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /c/Wacrm/ozzo-dms && npx vitest run lib/auth/sign-in-message.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Write the login screen**

`app/login/page.tsx`. A client component, because it is the one place this app writes anything (an auth request).

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { signInMessage } from "@/lib/auth/sign-in-message";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createBrowserSupabase();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (authError) {
      setError(signInMessage(authError.message));
      setBusy(false);
      return;
    }
    // Whether this user is a portal CUSTOMER is not decided here — the signed-in
    // layout asks portal_me(), which is the one place that answers it.
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-card-foreground">OZZO DMS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with the login your company gave you.
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        {/* Deliberately no "Forgot password?" link. Spec §5.2: a DMS login's
            address need not be able to receive mail, so a reset link would go
            nowhere. The company resets it on the customer page. */}
        <p className="mt-6 text-xs text-muted-foreground">
          Forgotten your password? Your company can set a new one for you on your
          customer page.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 6: Pin the absence of a reset link**

Append to `lib/auth/sign-in-message.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("the login screen", () => {
  const src = readFileSync(resolve(process.cwd(), "app/login/page.tsx"), "utf8");

  it("offers no password reset, because nothing can be sent to these addresses", () => {
    expect(src).not.toMatch(/resetPasswordForEmail|\/forgot-password|Forgot password\?/);
  });

  it("tells the reader who CAN reset it instead", () => {
    expect(src).toContain("Your company can set a new one for you");
  });

  it("asks Supabase to sign in with a password, and writes nothing else", () => {
    expect(src).toContain("signInWithPassword");
    expect(src).not.toMatch(/\.from\(|\.insert\(|\.update\(|\.delete\(/);
  });
});
```

- [ ] **Step 7: Run everything and commit**

Run: `cd /c/Wacrm/ozzo-dms && npm test && npm run typecheck`
Expected: all pass.

```bash
git add -A
git commit -m "Sign in with the login your company gave you, and no reset link that could not work"
```

---

### Task 3: The data layer and the signed-in shell

One file talks to the database, so there is one place to look when a number is wrong. The shell is where spec §12's first row lives: **access revoked mid-session shows a plain sentence, not an error page.**

**Files:**
- Create: `lib/portal/types.ts`, `lib/portal/api.ts`, `lib/portal/format.ts`
- Create: `components/page-header.tsx`, `components/stat-card.tsx`, `components/data-table.tsx`, `components/empty-state.tsx`
- Create: `app/(portal)/layout.tsx`, `app/(portal)/page.tsx`
- Test: `lib/portal/format.test.ts`

**Interfaces:**
- Consumes: `createServerSupabase()`.
- Produces, all from `lib/portal/api.ts`, each returning exactly what its SQL function returns and `null`/empty on no caller:
  - `portalMe(): Promise<PortalMe | null>`
  - `portalCustomers(): Promise<PortalCustomer[]>`
  - `portalOrders(kind: "all" | "purchase" | "sales", opts?: { from?: string; to?: string; limit?: number; offset?: number }): Promise<{ total: number; rows: PortalOrderRow[] }>`
  - `portalOrderDetail(id: string): Promise<PortalOrderDetail | null>`
  - `portalOutstanding(): Promise<PortalOutstanding | null>`
  - `portalPayments(opts?: { from?: string; to?: string; limit?: number; offset?: number }): Promise<{ total: number; rows: PortalPaymentRow[] }>`
- Produces from `lib/portal/format.ts`: `money(value: number | string | null, currency: string): string`, `shortDate(iso: string | null): string`, `titleCase(s: string | null): string`.

- [ ] **Step 1: Write the types, copied from the SQL**

`lib/portal/types.ts`. Every field here exists because a `jsonb_build_object` in Plan 2 emits it; nothing is invented.

```ts
/** portal_me() — 20261108110000_portal_resolver_and_identity.sql */
export type PortalMe = {
  contact_id: string;
  account_id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  hierarchy_level: number | null;
  credit_limit: number | null;
  outstanding_balance: number | null;
  account_name: string | null;
  currency: string;
  timezone: string;
};

/** portal_customers() */
export type PortalCustomer = {
  id: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  hierarchy_level: number | null;
  parent_id: string | null;
  parent_name: string | null;
  is_active: boolean | null;
  buying_status: string | null;
  outstanding_balance: number | null;
  credit_limit: number | null;
  has_portal_login: boolean;
};

/** portal_orders() — 20261108120000_portal_orders_and_money.sql */
export type PortalOrderRow = {
  id: string;
  order_number: string | null;
  date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  classification: string | null;
  status: string | null;
  pricing_status: string | null;
  total_amount: number | null;
  item_count: number;
  /** 'portal' or 'company'. Never an employee's name — spec §17 q4. */
  placed_via: "portal" | "company";
};

export type PortalOrderLine = {
  position: number | null;
  product_name: string | null;
  unit: string | null;
  quantity: number | null;
  price: number | null;
  discount_amount: number | null;
  scheme_discount_amount: number | null;
  is_scheme_goods: boolean | null;
  tax_rate: number | null;
  tax_amount: number | null;
  sub_total: number | null;
  total: number | null;
};

export type PortalOrderDetail = {
  id: string;
  order_number: string | null;
  date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  classification: string | null;
  status: string | null;
  pricing_status: string | null;
  notes: string | null;
  sub_total: number | null;
  discount_total: number | null;
  tax_total: number | null;
  total_amount: number | null;
  placed_via: "portal" | "company";
  lines: PortalOrderLine[];
};

/** portal_outstanding() */
export type PortalOutstanding = {
  mine: number;
  mine_credit_limit: number | null;
  customers_total: number;
  customers: {
    id: string;
    name: string | null;
    company: string | null;
    outstanding_balance: number | null;
    credit_limit: number | null;
  }[];
};

/** portal_payments() */
export type PortalPaymentRow = {
  id: string;
  payment_number: string | null;
  payment_date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  amount: number | null;
  verified_amount: number | null;
  payment_type: string | null;
  status: string | null;
  reference_number: string | null;
};
```

- [ ] **Step 2: Write the one file that talks to the database**

`lib/portal/api.ts`:

```ts
import { createServerSupabase } from "@/lib/supabase/server";
import type {
  PortalCustomer,
  PortalMe,
  PortalOrderDetail,
  PortalOrderRow,
  PortalOutstanding,
  PortalPaymentRow,
} from "./types";

// Every screen reads through here, and here reads only through the eight
// portal_* functions. There is no `.from("contacts")` anywhere in this app, and
// there must never be one: the portal has SELECT on no table (spec §6), so a
// table read would simply return nothing and look like missing data instead of
// a mistake.
//
// Each function answers "nothing" rather than throwing when there is no portal
// caller, because that is what the SQL does — an employee, a revoked login, or
// an account whose add-on was withdrawn all resolve to no caller.

export async function portalMe(): Promise<PortalMe | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("portal_me");
  if (error) throw error;
  return (data as PortalMe | null) ?? null;
}

export async function portalCustomers(): Promise<PortalCustomer[]> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("portal_customers");
  if (error) throw error;
  return (data as PortalCustomer[] | null) ?? [];
}

export async function portalOrders(
  kind: "all" | "purchase" | "sales",
  opts: { from?: string; to?: string; limit?: number; offset?: number } = {},
): Promise<{ total: number; rows: PortalOrderRow[] }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("portal_orders", {
    p_kind: kind,
    p_from: opts.from ?? null,
    p_to: opts.to ?? null,
    p_limit: opts.limit ?? 200,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  const d = data as { total: number; rows: PortalOrderRow[] } | null;
  return { total: d?.total ?? 0, rows: d?.rows ?? [] };
}

export async function portalOrderDetail(id: string): Promise<PortalOrderDetail | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("portal_order_detail", { p_order_id: id });
  if (error) throw error;
  return (data as PortalOrderDetail | null) ?? null;
}

export async function portalOutstanding(): Promise<PortalOutstanding | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("portal_outstanding");
  if (error) throw error;
  return (data as PortalOutstanding | null) ?? null;
}

export async function portalPayments(
  opts: { from?: string; to?: string; limit?: number; offset?: number } = {},
): Promise<{ total: number; rows: PortalPaymentRow[] }> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("portal_payments", {
    p_from: opts.from ?? null,
    p_to: opts.to ?? null,
    p_limit: opts.limit ?? 200,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  const d = data as { total: number; rows: PortalPaymentRow[] } | null;
  return { total: d?.total ?? 0, rows: d?.rows ?? [] };
}
```

- [ ] **Step 3: Write the formatter test first**

Create `lib/portal/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { money, shortDate, titleCase } from "./format";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("money", () => {
  it("uses the account's own currency, never a hardcoded symbol", () => {
    expect(money(1234.5, "INR")).toBe("₹1,234.50");
    expect(money(1234.5, "USD")).toBe("$1,234.50");
  });

  it("accepts the strings PostgREST sends for numeric columns", () => {
    // numeric(15,2) arrives as a STRING over PostgREST, not a number. A naive
    // `value.toFixed()` throws, and `value + 0` gives "1000" + 0 = "10000".
    expect(money("1000.00", "INR")).toBe("₹1,000.00");
  });

  it("shows nothing-owed as zero rather than a blank", () => {
    expect(money(null, "INR")).toBe("₹0.00");
    expect(money(0, "INR")).toBe("₹0.00");
  });
});

describe("shortDate", () => {
  it("formats the date the database already recorded, with no timezone maths", () => {
    // orders.date and payments.payment_date are DATE columns, already in the
    // account's own day. Converting them is how a 1st becomes the 30th.
    expect(shortDate("2026-11-14")).toBe("14 Nov 2026");
    expect(shortDate("2026-01-01")).toBe("01 Jan 2026");
  });

  it("leaves nothing as a dash", () => {
    expect(shortDate(null)).toBe("—");
    expect(shortDate("")).toBe("—");
  });
});

describe("titleCase", () => {
  it("turns a database word into a readable one", () => {
    expect(titleCase("yet_to_buy")).toBe("Yet To Buy");
    expect(titleCase("Pending")).toBe("Pending");
    expect(titleCase(null)).toBe("—");
  });
});

describe("the formatter never converts a date", () => {
  it("calls no Date method that could shift the day", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/portal/format.ts"), "utf8");
    expect(src).not.toContain("toISOString");
    expect(src).not.toContain("getTimezoneOffset");
    expect(src).not.toContain("new Date(");
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd /c/Wacrm/ozzo-dms && npx vitest run lib/portal/format.test.ts`
Expected: FAIL — cannot resolve `./format`.

- [ ] **Step 5: Write the formatter**

`lib/portal/format.ts`:

```ts
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * A DATE column, formatted by splitting the string. Deliberately no Date
 * object: orders.date and payments.payment_date are already recorded in the
 * account's own day, and every timezone conversion is a chance to move a 1st
 * into the previous month. This is the rule the CRM's reports learned.
 */
export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "—";
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return "—";
  return `${d} ${month} ${y}`;
}

/** numeric(15,2) arrives as a string over PostgREST, so coerce before formatting. */
export function money(value: number | string | null, currency: string): string {
  const n = value === null || value === "" ? 0 : Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function titleCase(s: string | null): string {
  if (!s) return "—";
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
```

- [ ] **Step 6: Run the tests**

Run: `cd /c/Wacrm/ozzo-dms && npx vitest run lib/portal/format.test.ts`
Expected: 8 passed. If `money(1234.5, "USD")` comes back `US$1,234.50`, the `en-IN` locale is the cause — assert what Node actually produces and note it, rather than changing the locale, because `en-IN` is what gives Indian digit grouping.

- [ ] **Step 7: Write the four shared components**

`components/page-header.tsx`:

```tsx
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p> : null}
    </div>
  );
}
```

`components/stat-card.tsx`:

```tsx
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-card border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold text-card-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
```

`components/empty-state.tsx`:

```tsx
export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card border border-dashed border-border p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
```

`components/data-table.tsx`. One table for every list, so a phone shows the same thing the desktop does with less in it.

```tsx
import Link from "next/link";

export type Column<T> = {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Hidden below sm: for the columns a phone does not need. */
  secondary?: boolean;
  cell: (row: T) => React.ReactNode;
};

export function DataTable<T>({
  columns,
  rows,
  rowHref,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowHref?: (row: T) => string;
  empty: React.ReactNode;
}) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c.key}
                className={[
                  "px-3 py-2 font-medium",
                  c.align === "right" ? "text-right" : "",
                  c.secondary ? "hidden sm:table-cell" : "",
                ].join(" ")}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/50">
              {columns.map((c, j) => {
                const content = c.cell(row);
                return (
                  <td
                    key={c.key}
                    className={[
                      "px-3 py-2",
                      c.align === "right" ? "tabular text-right" : "",
                      c.secondary ? "hidden sm:table-cell" : "",
                    ].join(" ")}
                  >
                    {rowHref && j === 0 ? (
                      <Link href={rowHref(row)} className="font-medium text-primary hover:underline">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: Write the signed-in shell**

`app/(portal)/layout.tsx`. This is where spec §12's first row is implemented, and the reason the middleware does not try: a signed-in `auth.users` row that is not a portal customer — an employee who found the URL, a customer whose access was switched off a second ago, a tenant whose DMS was withdrawn — all arrive here and all get the same plain sentence.

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { portalMe } from "@/lib/portal/api";
import { createServerSupabase } from "@/lib/supabase/server";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/purchase-orders", label: "Purchase orders" },
  { href: "/sales-orders", label: "Sales orders" },
  { href: "/customers", label: "My customers" },
  { href: "/payments", label: "Payments" },
];

async function signOutAction() {
  "use server";
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await portalMe();

  // Spec §12, row 1: "A plain 'Your access has been withdrawn — please contact
  // your company'. Not an error page." portal_me() answers null for a revoked
  // login, an employee, and an account whose add-on was removed — one sentence
  // covers all three, because from the reader's side they are the same thing.
  if (!me) {
    return (
      <main className="grid min-h-dvh place-items-center p-4">
        <div className="w-full max-w-md rounded-card border border-border bg-card p-6 text-center">
          <h1 className="text-base font-semibold">Your access has been withdrawn</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Please contact your company to have it switched back on.
          </p>
          <form action={signOutAction} className="mt-5">
            <button
              type="submit"
              className="h-10 w-full rounded-md border border-border text-sm font-medium"
            >
              Sign out
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{me.company || me.name || "My business"}</p>
            <p className="truncate text-xs text-muted-foreground">{me.account_name}</p>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="text-sm text-muted-foreground hover:text-foreground">
              Sign out
            </button>
          </form>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 pb-2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
```

- [ ] **Step 9: Write the Dashboard**

`app/(portal)/page.tsx`. Spec §4: *their outstanding to the company, their customers' outstanding to them, orders awaiting approval.*

```tsx
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { portalMe, portalOrders, portalOutstanding } from "@/lib/portal/api";
import { money, shortDate } from "@/lib/portal/format";

export default async function DashboardPage() {
  const [me, outstanding, all] = await Promise.all([
    portalMe(),
    portalOutstanding(),
    portalOrders("all", { limit: 200 }),
  ]);
  if (!me) return null; // the layout has already said why

  const currency = me.currency;
  const pending = all.rows.filter((r) => r.status === "Pending");
  const recent = all.rows.slice(0, 5);

  return (
    <>
      <PageHeader
        title={`Hello, ${me.company || me.name || "there"}`}
        subtitle="Your account with the company, and your own customers."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="You owe the company"
          value={money(outstanding?.mine ?? 0, currency)}
          hint={
            outstanding?.mine_credit_limit != null
              ? `Credit limit ${money(outstanding.mine_credit_limit, currency)}`
              : undefined
          }
        />
        <StatCard
          label="Your customers owe you"
          value={money(outstanding?.customers_total ?? 0, currency)}
          hint={`${outstanding?.customers.length ?? 0} customers`}
        />
        <StatCard label="Orders awaiting approval" value={String(pending.length)} />
        <StatCard label="Orders in total" value={String(all.total)} />
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Latest orders</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-card border border-border bg-card">
            {recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <Link href={`/orders/${o.id}`} className="font-medium text-primary hover:underline">
                  {o.order_number}
                </Link>
                <span className="truncate text-muted-foreground">{o.customer_name}</span>
                <span className="text-muted-foreground">{shortDate(o.date)}</span>
                <span className="tabular font-medium">{money(o.total_amount, currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 10: Run, type-check and commit**

Run: `cd /c/Wacrm/ozzo-dms && npm test && npm run typecheck`
Expected: all pass.

```bash
git add -A
git commit -m "One file talks to the database, and the shell says plainly when access is gone"
```

---

### Task 4: Purchase orders, Sales orders, and one order in full

Spec §4: a purchase order is what they buy **from the company**; a sales order is what they sell **to their own customers**, including the ones the company's reps booked. Both lists come from the same function with a different `p_kind`, so the two screens share one component and cannot disagree.

**Files:**
- Create: `components/order-list.tsx`
- Create: `app/(portal)/purchase-orders/page.tsx`, `app/(portal)/sales-orders/page.tsx`, `app/(portal)/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: `portalOrders`, `portalOrderDetail`, `portalMe`, `money`, `shortDate`, `titleCase`, `DataTable`, `PageHeader`, `EmptyState`.
- Produces: `OrderList({ kind, title, subtitle, emptyTitle, emptyBody })` — a server component used by both order screens.

- [ ] **Step 1: Write the shared list**

`components/order-list.tsx`:

```tsx
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { portalMe, portalOrders } from "@/lib/portal/api";
import { money, shortDate, titleCase } from "@/lib/portal/format";
import type { PortalOrderRow } from "@/lib/portal/types";

export async function OrderList({
  kind,
  title,
  subtitle,
  emptyTitle,
  emptyBody,
}: {
  kind: "purchase" | "sales";
  title: string;
  subtitle: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  const [me, { total, rows }] = await Promise.all([portalMe(), portalOrders(kind)]);
  if (!me) return null;
  const currency = me.currency;

  const columns: Column<PortalOrderRow>[] = [
    { key: "order_number", header: "Order", cell: (r) => r.order_number ?? "—" },
    { key: "date", header: "Date", cell: (r) => shortDate(r.date) },
    { key: "customer", header: "Customer", cell: (r) => r.customer_name ?? "—" },
    { key: "status", header: "Status", cell: (r) => titleCase(r.status) },
    {
      key: "placed_via",
      header: "Placed via",
      secondary: true,
      // Spec §17 q4 is answered no: this says Portal or Company and never
      // names the employee who booked it.
      cell: (r) => (r.placed_via === "portal" ? "Portal" : "Company"),
    },
    { key: "items", header: "Items", align: "right", secondary: true, cell: (r) => r.item_count },
    {
      key: "total",
      header: "Total",
      align: "right",
      cell: (r) => money(r.total_amount, currency),
    },
  ];

  return (
    <>
      <PageHeader title={title} subtitle={`${subtitle} ${total} in total.`} />
      <DataTable
        columns={columns}
        rows={rows}
        rowHref={(r) => `/orders/${r.id}`}
        empty={<EmptyState title={emptyTitle} body={emptyBody} />}
      />
    </>
  );
}
```

- [ ] **Step 2: Write the two screens**

`app/(portal)/purchase-orders/page.tsx`:

```tsx
import { OrderList } from "@/components/order-list";

export default function PurchaseOrdersPage() {
  return (
    <OrderList
      kind="purchase"
      title="Purchase orders"
      subtitle="What you have bought from the company."
      emptyTitle="No purchase orders yet"
      emptyBody="Orders you place with the company will appear here, with their status and total."
    />
  );
}
```

`app/(portal)/sales-orders/page.tsx`:

```tsx
import { OrderList } from "@/components/order-list";

export default function SalesOrdersPage() {
  return (
    <OrderList
      kind="sales"
      title="Sales orders"
      subtitle="What your own customers have bought."
      emptyTitle="No sales orders yet"
      emptyBody="Orders belonging to your customers appear here, whether you placed them or the company's team booked them."
    />
  );
}
```

- [ ] **Step 3: Write the order detail**

`app/(portal)/orders/[id]/page.tsx`. Spec §12: *guessing an order id must reveal nothing, and must not look different from a typo* — so an order outside the tree and a nonexistent order get the same page.

```tsx
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { portalMe, portalOrderDetail } from "@/lib/portal/api";
import { money, shortDate, titleCase } from "@/lib/portal/format";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, order] = await Promise.all([portalMe(), portalOrderDetail(id)]);
  if (!me) return null;

  // portal_order_detail returns null both for an order that does not exist and
  // for one that belongs to somebody else. Deliberately the same page for both.
  if (!order) {
    return (
      <>
        <PageHeader title="Order not found" />
        <p className="text-sm text-muted-foreground">
          This order is not on your account.{" "}
          <Link href="/purchase-orders" className="text-primary hover:underline">
            Back to your orders
          </Link>
          .
        </p>
      </>
    );
  }

  const currency = me.currency;

  return (
    <>
      <PageHeader
        title={`Order ${order.order_number ?? ""}`}
        subtitle={`${order.customer_name ?? ""} · ${shortDate(order.date)} · ${titleCase(order.status)}`}
      />

      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Rate</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Discount</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Tax</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  {l.product_name}
                  {l.is_scheme_goods ? (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      Scheme goods
                    </span>
                  ) : null}
                </td>
                <td className="tabular px-3 py-2 text-right">
                  {l.quantity} {l.unit ?? ""}
                </td>
                <td className="tabular hidden px-3 py-2 text-right sm:table-cell">
                  {money(l.price, currency)}
                </td>
                <td className="tabular hidden px-3 py-2 text-right sm:table-cell">
                  {money((Number(l.discount_amount ?? 0) + Number(l.scheme_discount_amount ?? 0)), currency)}
                </td>
                <td className="tabular hidden px-3 py-2 text-right sm:table-cell">
                  {money(l.tax_amount, currency)}
                </td>
                <td className="tabular px-3 py-2 text-right font-medium">{money(l.total, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Sub total</span>
          <span className="tabular">{money(order.sub_total, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Discount</span>
          <span className="tabular">{money(order.discount_total, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Tax</span>
          <span className="tabular">{money(order.tax_total, currency)}</span>
        </div>
        <div className="flex justify-between border-t border-border pt-1 font-semibold">
          <span>Total</span>
          <span className="tabular">{money(order.total_amount, currency)}</span>
        </div>
      </div>

      {order.notes ? (
        <p className="mt-4 text-sm text-muted-foreground">Notes: {order.notes}</p>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Pin the two rules these screens must keep**

Create `components/order-list.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = [
  "components/order-list.tsx",
  "app/(portal)/orders/[id]/page.tsx",
  "app/(portal)/purchase-orders/page.tsx",
  "app/(portal)/sales-orders/page.tsx",
];

describe("the order screens", () => {
  const sources = files.map((f) => [f, readFileSync(resolve(process.cwd(), f), "utf8")] as const);

  it("found all four files, so the assertions below mean something", () => {
    expect(sources.length).toBe(4);
    for (const [f, src] of sources) expect(src.length, f).toBeGreaterThan(50);
  });

  it("never names an employee", () => {
    for (const [f, src] of sources) {
      expect(src, f).not.toMatch(/salesman|employee_name|user_id|profiles/);
    }
  });

  it("reads no table directly — the eight functions are the only way in", () => {
    for (const [f, src] of sources) {
      expect(src, f).not.toMatch(/\.from\(["']/);
    }
  });

  it("formats every figure through money(), so the account's currency is always used", () => {
    for (const [f, src] of sources) {
      if (!src.includes("total_amount") && !src.includes("price")) continue;
      expect(src, f).toContain("money(");
      expect(src, f).not.toMatch(/₹|\$\{.*toFixed/);
    }
  });
});
```

- [ ] **Step 5: Run and commit**

Run: `cd /c/Wacrm/ozzo-dms && npm test && npm run typecheck`
Expected: all pass.

```bash
git add -A
git commit -m "Purchase orders, sales orders, and one order with its lines"
```

---

### Task 5: My Customers, and Payments

Spec §4: My Customers is *everyone below them in the tree, read only*; Payments is *receipts and outstanding, read only* (founder decision 6). The payment list shows rejected and cancelled receipts **with their status** rather than hiding them — a distributor who paid and was rejected must be able to see that.

**Files:**
- Create: `app/(portal)/customers/page.tsx`, `app/(portal)/payments/page.tsx`

**Interfaces:**
- Consumes: `portalCustomers`, `portalPayments`, `portalOutstanding`, `portalMe`, `DataTable`, `StatCard`, `EmptyState`, `PageHeader`, `money`, `shortDate`, `titleCase`.
- Produces: nothing other tasks use.

- [ ] **Step 1: Write My Customers**

`app/(portal)/customers/page.tsx`:

```tsx
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { portalCustomers, portalMe } from "@/lib/portal/api";
import { money, titleCase } from "@/lib/portal/format";
import type { PortalCustomer } from "@/lib/portal/types";

export default async function CustomersPage() {
  const [me, customers] = await Promise.all([portalMe(), portalCustomers()]);
  if (!me) return null;
  const currency = me.currency;

  const columns: Column<PortalCustomer>[] = [
    { key: "name", header: "Customer", cell: (c) => c.company || c.name || "—" },
    { key: "phone", header: "Phone", secondary: true, cell: (c) => c.phone ?? "—" },
    { key: "city", header: "City", secondary: true, cell: (c) => c.city ?? "—" },
    { key: "supplied_by", header: "Supplied by", secondary: true, cell: (c) => c.parent_name ?? "—" },
    { key: "buying", header: "Buying status", cell: (c) => titleCase(c.buying_status) },
    {
      key: "outstanding",
      header: "Owes you",
      align: "right",
      cell: (c) => money(c.outstanding_balance, currency),
    },
  ];

  return (
    <>
      <PageHeader
        title="My customers"
        subtitle={`Everyone you supply. ${customers.length} in total.`}
      />
      <DataTable
        columns={columns}
        rows={customers}
        empty={
          <EmptyState
            title="No customers yet"
            body="Customers the company has mapped to you appear here. If one is missing, ask the company to map them to you."
          />
        }
      />
    </>
  );
}
```

- [ ] **Step 2: Write Payments**

`app/(portal)/payments/page.tsx`:

```tsx
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { portalMe, portalOutstanding, portalPayments } from "@/lib/portal/api";
import { money, shortDate, titleCase } from "@/lib/portal/format";
import type { PortalPaymentRow } from "@/lib/portal/types";

export default async function PaymentsPage() {
  const [me, outstanding, { total, rows }] = await Promise.all([
    portalMe(),
    portalOutstanding(),
    portalPayments(),
  ]);
  if (!me) return null;
  const currency = me.currency;

  const columns: Column<PortalPaymentRow>[] = [
    { key: "number", header: "Receipt", cell: (p) => p.payment_number ?? "—" },
    { key: "date", header: "Date", cell: (p) => shortDate(p.payment_date) },
    { key: "customer", header: "From", cell: (p) => p.customer_name ?? "—" },
    { key: "type", header: "Mode", secondary: true, cell: (p) => titleCase(p.payment_type) },
    { key: "ref", header: "Reference", secondary: true, cell: (p) => p.reference_number ?? "—" },
    // Shown, never hidden: a receipt that was rejected has to be visible to
    // the person who paid it, or the screen is lying to them.
    { key: "status", header: "Status", cell: (p) => titleCase(p.status) },
    { key: "amount", header: "Amount", align: "right", cell: (p) => money(p.amount, currency) },
  ];

  return (
    <>
      <PageHeader title="Payments" subtitle={`Your receipts and your outstanding. ${total} receipts.`} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <StatCard label="You owe the company" value={money(outstanding?.mine ?? 0, currency)} />
        <StatCard
          label="Your customers owe you"
          value={money(outstanding?.customers_total ?? 0, currency)}
          hint={`${outstanding?.customers.length ?? 0} customers`}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        empty={
          <EmptyState
            title="No receipts yet"
            body="Payments you make to the company, and payments your customers make to you, appear here once the company records them."
          />
        }
      />

      <p className="mt-3 text-xs text-muted-foreground">
        Receipts are recorded by the company. If one is missing or wrong, please contact them.
      </p>
    </>
  );
}
```

- [ ] **Step 3: Pin that nothing on these screens can write**

Create `app/portal-screens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Plan 3 is read-only by design (founder decision 6 for payments; ordering is
// Plan 4). A write that slipped in would not be refused by the database with a
// helpful message — portal_* are the only things this app may call, so a write
// would simply fail in a way nobody could explain.
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(e)) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e)) out.push(full);
  }
  return out;
}

describe("the portal app writes nothing in Plan 3", () => {
  const root = process.cwd();
  const files = walk(join(root, "app")).concat(walk(join(root, "components")), walk(join(root, "lib")));

  it("has files to scan", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("calls no insert, update, upsert or delete", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) continue;
      const src = readFileSync(f, "utf8");
      if (/\.(insert|update|upsert|delete)\(/.test(src)) offenders.push(f.replace(root, ""));
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("calls only the eight portal functions", () => {
    const allowed = new Set([
      "portal_me",
      "portal_customers",
      "portal_orders",
      "portal_order_detail",
      "portal_outstanding",
      "portal_payments",
      "portal_caller",
      "portal_visible_contact_ids",
    ]);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\.rpc\(\s*["']([a-z_]+)["']/g)) {
        expect(allowed.has(m[1]), `${f.replace(root, "")} calls ${m[1]}`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 4: Run and commit**

Run: `cd /c/Wacrm/ozzo-dms && npm test && npm run typecheck`
Expected: all pass.

```bash
git add -A
git commit -m "My customers, and the receipts with their status rather than only the good ones"
```

---

### Task 6: Run it, and see it with a real login

Everything so far is argued rather than seen. This task is the first time anybody looks at the app.

**Files:**
- Create: `C:\Wacrm\.claude\launch.json` (or add an entry if it exists)
- Create: `C:\Wacrm\ozzo-dms\.env.local` — **the anon key and URL only**

**Interfaces:** none.

- [ ] **Step 1: Point the app at the database**

Copy `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from `wacrm-web/.env.local` into `ozzo-dms/.env.local`. **Copy nothing else.** The anon key is public by design and this app can only reach `portal_*` functions with it, so reading production is safe — but a service-role key here would make the whole design a lie, and Task 1's test fails if one appears.

- [ ] **Step 2: Add the launch entry**

`C:\Wacrm\.claude\launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "ozzo-dms",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["--prefix", "C:/Wacrm/ozzo-dms", "run", "dev"],
      "port": 3100
    }
  ]
}
```

- [ ] **Step 3: Start it and read the login page**

Start the `ozzo-dms` server and open it. Expected: a redirect to `/login`, the OZZO DMS card, Email and Password, and the sentence about the company resetting a password. **No "Forgot password?" link.** Confirm by reading the page, not by screenshot alone.

- [ ] **Step 4: Prove the signed-out redirect**

Open `/customers` directly while signed out. Expected: redirected to `/login`. This is the middleware, and it is the difference between a private app and a public one.

- [ ] **Step 5: Sign in as a real portal customer**

This needs a login whose password is known. On production there is exactly one portal customer (`amrit@mahajan.com`). **Do not guess or reset it.** Ask the founder to either tell you a password he has set, or set one himself on that customer's page and then sign in while you watch, and say which he chose. With no password available, say so plainly and stop at Step 4 rather than reporting the screens as verified.

- [ ] **Step 6: Walk all five screens and check the numbers against the database**

With a session, open Dashboard, Purchase orders, Sales orders, My customers, Payments and one order. For each, compare what the screen shows against what the function returns, and report both. The screens must agree with the database exactly, because they do no arithmetic of their own.

- [ ] **Step 7: Check it on a phone-sized window**

Resize to 375×812 and walk the same five screens. Expected: no horizontal page scroll, the secondary columns hidden, the figures still readable. The audience for this app opens it in a shop.

- [ ] **Step 8: Read the console and the network log**

Expected: no errors, and every database request going to `/rest/v1/rpc/portal_*`. **A request to `/rest/v1/contacts` or any other table is a bug** even if the screen looks right, because it means this app is reading a table it should not know exists.

- [ ] **Step 9: Commit and report**

```bash
cd /c/Wacrm/ozzo-dms
git add -A
git commit -m "Point the portal at the database, and see it with a real login"
```

Report: what was seen on each screen, the numbers compared, and anything that could not be verified and why.

---

## Self-review against the spec

**Covered:** §4's Dashboard, Purchase order, Sales order, My Customers and Payments (Tasks 3–5). §5.2's email-and-password sign-in and the absence of forgot-password (Task 2). §5.3 is the CRM's job and is already done. §6's "reads through functions, no table" is enforced by a test, twice (Tasks 4 and 5). §12's revoked-access sentence (Task 3 Step 8), its "guessing an order id reveals nothing" (Task 4 Step 3) and its "the admin, not the distributor, sees the seat cap" (nothing to do — the portal never creates a login). §1's "duplicate what is cosmetic, never what is arithmetic" (Task 1 Step 5 copies a dozen tokens; no screen computes a total).

**Deliberately not covered, and why:** §4's Announcements, Activity management and Reports need `send_to_portal`, `portal_activities` and the four report functions — none of which exist yet. They are Plan 4, and they are **absent from the menu** rather than present and empty, because a dead menu item is a support call. §7's ordering is Plan 4 as well, so this app is read-only and a test enforces that. §13's Phase 2 is untouched.

**Known gaps in this plan, stated rather than hidden:** no pagination controls (the functions take `p_limit`/`p_offset` and every screen asks for 200, which is right until a distributor has more than 200 orders — the first real one will tell us). No date-range filter on the lists, for the same reason. No print or export, which Plan 4's reports will bring. No dark-mode toggle: the tokens are there and `data-mode` is hardcoded to light, because a toggle nobody asked for is a setting to maintain.
