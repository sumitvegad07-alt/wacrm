# Feature Specification: ASK OZZO — Support & Implementation Copilot

**Status:** Built by Claude Code 2026-08-30 (web-only) — LIVE-BLOCKED on `ANTHROPIC_API_KEY`

> **Build note (2026-08-30):** Implemented end-to-end on web. Migration
> `20260830120000_ask_ozzo_support_copilot_v1` applied to prod (dry-run validated).
> Corpus seeded (8 curated articles) via `scripts/ozzo-seed.mjs`; retrieval quality
> verified live (correct doc tops every test query). Files: `src/lib/ozzo/*`,
> `src/app/api/ozzo/ask/route.ts`, `src/components/ozzo/ask-ozzo.tsx` (mounted in
> `dashboard-shell.tsx`), `use_ask_ozzo` in the permission registry, `askOzzo` rate
> limit. TypeScript: 0 errors repo-wide. RLS verified: published-only global read +
> superadmin-only corpus write. **NOT YET VERIFIED (blocked):** the live Claude answer —
> requires `ANTHROPIC_API_KEY` in server env (`.env.local` + Vercel); the graceful-error
> path is coded and returns a friendly retry message until the key is added. Not built
> (deferred): an admin UI to toggle `accounts.settings.ask_ozzo_enabled` (defaults ON,
> enforced server-side) and a superadmin corpus-authoring UI.


**Module:** New Module (Platform) — read-only assistant layered over the whole product
**Date:** 2026-08-30
**Model:** Claude **Sonnet 5** (`claude-sonnet-5`) — founder-confirmed 2026-08-30
**Platform scope:** **WEB ADMIN ONLY** for now (founder decision 2026-08-30 — mobile ASK OZZO
deferred on cost grounds). All §6 Mobile Behavior is deferred; the backend is the Next.js
route `/api/ozzo/ask` (no Supabase Edge Function needed since mobile is out of scope).
**Embedding key:** reuse the existing platform `GEMINI_API_KEY` (already in server env).
**Requires provisioning:** `ANTHROPIC_API_KEY` must be added to server env (`.env.local` +
Vercel) — it does not exist yet.

---

## 1. Feature Overview

- **Problem:** New admins and field users don't know how OZZO works. Setting up schemes,
  permissions, beat plans, orders, or imports is done by trial-and-error, which produces
  misconfigured accounts and a stream of "how do I / why isn't this working" support
  tickets. There is no in-product help — users leave the app to ask a human.
- **Business justification:** Reduce onboarding time, cut implementation mistakes (which
  cause churn), and deflect repetitive support tickets. A grounded, cited assistant that
  explains features and walks users through configuration is the standard way modern SaaS
  products (Intercom Fin, Pylon, GitLab Duo Chat) lower support cost without adding headcount.
- **Target use case / industries:** Every OZZO customer during onboarding and ongoing use —
  distributors/dealers configuring SFA (schemes, hierarchy, orders, collections concepts),
  field-ops admins configuring attendance/beat/expense policies, and mobile field users who
  get stuck (e.g. "why can't I punch in?"). Admins get implementation help; field users get
  support.

**What ASK OZZO is:** a question-answering + step-by-step guidance assistant, grounded in
OZZO's own documentation, with source citations.

**What ASK OZZO is NOT** (hard product boundary — do not build any of this):
it does not query live business data, does not show collections/sales/outstanding/attendance
statistics, does not generate reports, does not create/edit/delete/update records, does not
execute workflows on the user's behalf, and is not an autonomous agent.

## 2. Scope

**In scope (Phase 1):**
- In-app chat assistant on **web (admin)** and **mobile (field user)**.
- Answers grounded ONLY in an OZZO knowledge corpus: implementation guides, SOPs, release
  notes, FAQs, troubleshooting articles, and feature explanations. **Claude-powered.**
- **Source citations** on every answer (which help article(s) the answer came from).
- **Context-aware** answers using SAFE, non-business context the client already holds: the
  user's role name, their plan/enabled modules, and the screen they're currently on. This
  lets Ozzo say "Scheme Management is currently OFF in your Catalogue Settings — here's how
  to turn it on" instead of generic steps.
- **Hybrid knowledge** (founder decision): auto-index existing product docs now for coverage
  (OZZO catalog, `PROJECT.md`, existing specs, release notes), then curate high-traffic
  articles over time.
- Read-only. No business-data access. No actions.
- Per-user conversation history + thumbs-up/down feedback (to find answer gaps).

**In scope (Phase 2 — separate build, not now):**
- **Deep-link navigation** — an answer can offer a "Take me to the right screen" button that
  navigates the user to the correct route (web path / mobile screen). Still no data querying,
  still no actions. Backed by a curated intent→route map.

**Out of scope (explicitly, to stop over-building):**
- Any query of `orders`, `payments`, `expenses`, `leads`, `tracking_sessions`, etc. — Ozzo
  never reads tenant business rows.
- Analytics, dashboards, BI, report generation.
- Any write/mutation, approval, or workflow execution.
- Tool-use / agentic behavior, function calling against the app.
- Ticket-system integration / live human handoff (Phase 3+ candidate, not now).
- Reusing the tenant's WhatsApp-bot knowledge base — that corpus is the *customer's* business
  FAQ for *their* customers; ASK OZZO's corpus is OZZO *product* documentation. They are
  separate and must not be mixed.

## 3. User Roles & Permissions

| Role | Can see | Can do | Tenant/RLS implications |
|---|---|---|---|
| Owner / Admin | The Ask Ozzo panel; all product docs | Ask questions; read own conversation history | Docs are global (same for every tenant); conversations are scoped to the user |
| Agent / Field user | The Ask Ozzo panel; all product docs | Ask questions; read own history | Same corpus; answers filtered by *role-awareness in the prompt*, not by hiding docs |
| Viewer | The Ask Ozzo panel | Ask questions | Read-only role; Ozzo is itself read-only so no conflict |

**Access model:**
- ASK OZZO is available to **every authenticated user by default** — it's help, not a
  privileged feature. Gate it with a single **account-level enable toggle** (default ON) so
  an org can disable it, plus a soft permission key `use_ask_ozzo` (default granted) for
  future per-role control. Do NOT hard-gate it behind an existing sensitive key.
- The knowledge corpus (`ozzo_docs`, `ozzo_doc_chunks`) is **global** and **superadmin-
  maintained** — customers never write to it.
- **Role-awareness is a prompt input, not a security boundary.** Because Ozzo is strictly
  read-only over product docs (no business data), there is no cross-tenant data risk in the
  answer content itself. The only tenant-scoped data are the user's own conversations.

## 4. Data Model

All new tables. Global corpus tables have **no `account_id`** (deliberate — the docs are the
same for every tenant); per-user tables carry `account_id` + `user_id` and full RLS.

**`ozzo_docs`** (global product documentation, superadmin-managed)
- `id` uuid pk default `gen_random_uuid()`
- `slug` text unique NOT NULL — stable id used in citations/deep-links
- `title` text NOT NULL
- `module` text NOT NULL — e.g. `schemes`, `orders`, `attendance`, `leads`, `permissions`,
  `imports`, `beat`, `payments`, `stock`, `platform`
- `category` text NOT NULL CHECK in (`guide`,`sop`,`faq`,`troubleshooting`,`release_note`,`concept`)
- `body_md` text NOT NULL — source markdown (the human-editable article)
- `min_plan` text NULL — optional plan gate for context-aware answers (`CRM`/`SFA`/`WFA`/null)
- `source_ref` text NULL — provenance for auto-ingested docs (e.g. `OZZO_FEATURE_MASTER_CATALOG.md#schemes`)
- `version` int NOT NULL default 1
- `is_published` boolean NOT NULL default false
- `created_at` / `updated_at` timestamptz (with `update_updated_at_column` trigger)

**`ozzo_doc_chunks`** (retrieval units — one doc → many chunks)
- `id` uuid pk
- `doc_id` uuid NOT NULL references `ozzo_docs(id)` on delete cascade
- `chunk_index` int NOT NULL
- `content` text NOT NULL
- `embedding` vector(768) NOT NULL — dimension MUST match the chosen embedding model
  (Gemini `text-embedding-004` = 768; if Voyage is chosen, change this). **STOP AND ASK if
  the existing `kb_chunks` table uses a different dimension — reuse that dimension.**
- `token_count` int NULL
- unique (`doc_id`,`chunk_index`)
- ivfflat/hnsw index on `embedding` for cosine search (mirror the existing `kb_chunks` index type)

**`ozzo_conversations`** (per-user chat threads)
- `id` uuid pk · `account_id` uuid NOT NULL · `user_id` uuid NOT NULL
- `surface` text NOT NULL CHECK in (`web`,`mobile`)
- `title` text NULL (first question, truncated) · `created_at` timestamptz

**`ozzo_messages`**
- `id` uuid pk · `conversation_id` uuid NOT NULL references `ozzo_conversations` on delete cascade
- `account_id` uuid NOT NULL (denormalized for RLS) · `role` text CHECK in (`user`,`assistant`)
- `content` text NOT NULL
- `cited_doc_ids` uuid[] NULL — docs the assistant cited (for the Sources UI + gap analysis)
- `model` text NULL · `input_tokens` int NULL · `output_tokens` int NULL (cost telemetry)
- `created_at` timestamptz

**`ozzo_feedback`**
- `id` uuid pk · `message_id` uuid NOT NULL references `ozzo_messages` on delete cascade
- `account_id` uuid NOT NULL · `user_id` uuid NOT NULL
- `rating` text CHECK in (`up`,`down`) · `reason` text NULL · `created_at` timestamptz

**Account setting:** add `ask_ozzo_enabled` boolean (default true) into the existing
`accounts.settings` jsonb (do NOT add a column — follow the `order_settings`/`task_types`
pattern already in `accounts.settings`).

**Permission key:** add `use_ask_ozzo` to the permission registry (`src/lib/auth/
permissions-registry.ts`) under a new `ASSISTANT` group. Default-granted; `has_permission()`
resolves owner/admin as all-true automatically — no SQL function change needed.

**Migration notes:** all tables new (`IF NOT EXISTS`), no existing data touched. Requires the
`vector` (pgvector) extension — **already enabled** (the WhatsApp `kb_chunks` table uses it;
confirm before assuming). Regenerate TypeScript types after migration.

**RLS policies:**
- `ozzo_docs`, `ozzo_doc_chunks`: `SELECT` allowed to any authenticated user **only where
  `is_published = true`**; `INSERT/UPDATE/DELETE` restricted to superadmin (`is_superadmin`).
  These tables have no `account_id`, so the SELECT policy is `is_published = true` (global
  read) — this is intentional and must be called out in the migration comment.
- `ozzo_conversations`, `ozzo_messages`, `ozzo_feedback`: standard tenant + owner scoping —
  `is_account_member(account_id)` AND `user_id = auth.uid()` for SELECT/INSERT; no cross-user
  visibility (a user sees only their own threads). Admins do NOT get to read other users'
  Ozzo chats in Phase 1 (privacy default; revisit if an admin "support view" is wanted).

## 5. API Contract

**Reuse the existing RAG pattern** in `src/lib/ai/knowledge-base.ts` (`generateEmbedding`,
the `match_*` RPC pattern) and `src/lib/ai/engine.ts` (retrieve → prompt → generate). ASK
OZZO is a **second consumer** of that pattern with a different corpus, a Claude generation
call (not Gemini), and a global — not per-account — knowledge base.

### `POST /api/ozzo/ask` (Next.js Route Handler — the "20% rule": secrets server-side, streaming)
The Anthropic API key and the embedding key live in server env and NEVER reach the client.

**Request:**
```ts
{
  conversationId?: string;      // omit to start a new thread
  question: string;             // required, 1..2000 chars (Zod-validated)
  surface: 'web' | 'mobile';
  context: {                    // SAFE, non-business context from the client
    roleName?: string;          // business role label, e.g. "Sales Executive"
    accountRole?: string;       // owner/admin/agent/viewer
    plan?: string;              // CRM | SFA | WFA | ...
    enabledModules?: string[];  // from module settings (e.g. schemeManagement:false)
    currentModule?: string;     // screen the user is on, e.g. "schemes"
  }
}
```

**Response:** `text/event-stream` (streamed answer), terminating with a JSON trailer:
```ts
{ conversationId: string;
  messageId: string;
  citations: { slug: string; title: string; module: string }[]; // Sources chips
  suggestedNavigation?: null;   // Phase 1 always null; Phase 2 fills {label, webPath, mobileRoute}
}
```

**Server flow:**
1. Auth: resolve the caller from the Supabase session (RLS session — the user's own JWT).
   Reject if `ask_ozzo_enabled` is false for the account or `use_ask_ozzo` is not granted.
2. Zod-validate the body. Rate-limit per user (e.g. 20 questions / 5 min) → `429`.
3. Embed `question` via the platform embedding key (server env
   `OZZO_EMBEDDING_API_KEY` — a PLATFORM key, not the tenant's WhatsApp `gemini_api_key`).
4. `match_ozzo_chunks(query_embedding, match_count: 6, match_threshold: 0.3, p_module: context.currentModule)`
   — an RPC mirroring `match_kb_chunks`, but global (no `p_account_id`) and with an optional
   soft module boost. Returns chunks + their `doc_id`/`slug`/`title`.
5. Build the grounded prompt (see system prompt below); call Claude with **streaming**.
6. Persist user + assistant messages, `cited_doc_ids`, token usage.
7. Stream text to the client; send the JSON trailer with citations.

**System prompt (the safety spine — implement verbatim in intent):**
> You are ASK OZZO, the in-product support and implementation assistant for the OZZO
> platform. Answer ONLY using the provided documentation excerpts. If the answer is not in
> them, say you don't have that information and suggest where in the product to look or to
> contact support — never invent steps. You explain features, guide configuration, and
> troubleshoot. You must NOT report the user's live business data, numbers, statistics, or
> records; if asked "show/how many/which customer/who has the most…", explain how they can
> find it in the relevant screen instead of answering with data. You cannot perform actions,
> create/edit/delete anything, or run anything on the user's behalf. Cite the documents you
> used by their titles. Tailor steps to the user's role and enabled modules given in context.

**Model decision:** default to **`claude-opus-5`** for answer quality. **However**, this is a
high-volume, latency-sensitive support chat — I recommend running it on **`claude-sonnet-5`**
(or `claude-haiku-4-5` for the highest-volume tier) to control cost, since grounded RAG Q&A
is not a hard reasoning task. **This is the one Open Question for the founder (§10).** Use
adaptive thinking off/low effort for a snappy chat; stream responses; `max_tokens ≈ 1024`
(answers are short). Use the official `@anthropic-ai/sdk`.

**Errors:** `400` invalid input · `401` not signed in · `403` disabled for account/role ·
`429` rate-limited · `503` model/embedding upstream failure (return a friendly "I'm having
trouble right now, please try again" — never leak raw errors, per code standards).

### `GET /api/ozzo/conversations` / `GET /api/ozzo/conversations/:id`
Read the user's own threads/messages (RLS enforces ownership). Standard JSON.

### Ingestion (superadmin, offline job — not a public endpoint)
A script/Server Action `ingestOzzoDocsAction` (superadmin-only): reads markdown sources
(hybrid: auto-pull `OZZO_FEATURE_MASTER_CATALOG.md`, `PROJECT.md`, published specs; plus
hand-curated articles), upserts `ozzo_docs`, chunks (`~500` tokens, overlap `~50`), embeds
each chunk with the platform key, writes `ozzo_doc_chunks`. Reuse the chunking approach in
`knowledge-base.ts`. Re-runnable idempotently by `slug` + `version`.

## 6. Mobile Behavior

- **Requires connectivity — explicitly.** ASK OZZO is a live model call; it cannot work
  offline. This is an accepted limitation (per handbook DoD: scope it as "requires
  connectivity" rather than a silent gap). When offline, the mobile chat shows a clear
  "Ask Ozzo needs an internet connection" empty state and disables the input.
- **No `SyncEngine` involvement.** Nothing here queues or mutates business data, so it is NOT
  wired into `SyncEngine.enqueueMutation`. (Handbook §Offline Architecture reviewed — Sync
  covers only `site_visits`/`activities`/`tracking_sessions`/`location_pings`; none relevant.)
- Mobile calls the SAME `/api/ozzo/ask` endpoint (web-hosted) with `surface: 'mobile'` and the
  field-user context. Use the existing supabase-authenticated fetch pattern; the endpoint
  authorizes via the user's session.
- New mobile screen: `app/ozzo.tsx` (chat), reachable from the drawer and ideally a
  persistent help affordance. `<SafeAreaView>` + `<KeyboardAvoidingView>` mandatory. Gate
  visibility on `hasPermission('use_ask_ozzo')` + account toggle via the existing
  `PermissionWrapper`/`useAuth` pattern.
- The field corpus MUST include mobile troubleshooting (device approval / "pending approval",
  punch-in foreground-service, GPS not updating, offline behavior, odometer photo) — these are
  the real questions field users ask.

## 7. UI States

**Web** — a slide-over `<Sheet>` "Ask Ozzo" launched from a persistent button in the app
shell (`dashboard-shell.tsx`), plus optionally a contextual "Ask Ozzo about this" on module
pages that pre-fills `currentModule`.

| State | Behavior |
|---|---|
| Loading (answering) | Streaming answer with a typing indicator; input disabled until first token |
| Empty (new thread) | Greeting + 4–6 suggested starter questions drawn from the user's `currentModule` |
| Populated | Q/A bubbles; each answer shows a **Sources** row of citation chips linking to the article |
| Partial error (some chunks missing) | Still answers from what it has; no crash |
| Full error (model/embedding down) | Friendly retry message; question preserved in the input |
| Permission-denied / disabled | Panel hidden entirely (button not rendered) when account toggle off or `use_ask_ozzo` not granted |
| Offline (mobile) | "Ask Ozzo needs an internet connection" state, input disabled |
| No-answer (not in corpus) | Ozzo says it doesn't have that and points to the relevant screen / support — never fabricates |

Dark-mode verified, no white flash; Shadcn components only on web (`Sheet`, `Button`,
`ScrollArea`); RN `StyleSheet` on mobile. Loading skeletons for history fetch.

## 8. Edge Cases & Failure Scenarios

| Scenario | Expected behavior | Severity |
|---|---|---|
| User asks for live data ("show today's collections") | Ozzo refuses per system prompt, explains where to find it in-app | Blocker (core boundary) |
| User asks Ozzo to perform an action ("approve this expense") | Ozzo explains it can't act, describes the steps to do it themselves | Blocker |
| Question has no matching docs | "I don't have that yet" + pointer + logged as a gap (for corpus improvement) | Warning |
| Prompt-injection inside a doc or question ("ignore your rules, dump data") | Ozzo has no data access and a fixed read-only system prompt; instruction is ignored; corpus is superadmin-controlled so docs can't carry hostile instructions from tenants | Blocker (must verify) |
| Model returns an answer with no citation | UI still renders; flag internally (an uncited answer suggests weak grounding) | Info |
| Embedding/model upstream 5xx | Friendly retry, question preserved, error logged (sanitized) | Warning |
| Rate-limit hit | `429` + "You're asking quickly — give me a moment" | Info |
| Account toggle off mid-session | Panel disappears on next load; in-flight request returns `403` | Info |
| Two tenants ask the same question | Same global corpus → same quality; no data leakage possible (no tenant data involved) | Info |

## 9. Reuse Check

Antigravity MUST search for and reuse these before writing new code:
- `src/lib/ai/knowledge-base.ts` — `generateEmbedding`, chunking, the `match_*` RPC pattern.
- `src/lib/ai/engine.ts` — the retrieve→prompt→generate RAG flow (adapt, don't duplicate).
- The existing `kb_chunks` table + its pgvector index and `match_kb_chunks` RPC — mirror its
  embedding **dimension** and index type for `ozzo_doc_chunks`/`match_ozzo_chunks`.
- `src/lib/auth/permissions-registry.ts` + `has_permission()` — add `use_ask_ozzo`, don't
  invent a new permission mechanism.
- `src/hooks/use-auth.tsx` — source of role/plan/module context (`hasPermission`,
  `isModuleEnabled`, `moduleSettings`) for the SAFE context payload.
- `RequirePermission` / `components/ui/gated-button.tsx` (web) and
  `src/components/auth/PermissionWrapper.tsx` (mobile) — access gating.
- Shadcn `Sheet`, `Button`, `ScrollArea`; `dashboard-shell.tsx` for the launch button.
- The `@anthropic-ai/sdk` (already a dependency? — if not, adding it is a STOP AND ASK per
  contract, but it is the correct SDK for Claude).
- `accounts.settings` jsonb (`order_settings`/`task_types` precedent) for `ask_ozzo_enabled`.

Explicit statement for Antigravity: **search for `knowledge-base.ts`, `engine.ts`,
`match_kb_chunks`, `kb_chunks`, `generateEmbedding`, `permissions-registry`, `has_permission`,
`dashboard-shell` before writing any new file.**

## 10. Open Questions

1. **Model tier (needs founder answer):** `claude-opus-5` (best answers, highest cost) vs
   `claude-sonnet-5` (recommended — strong + far cheaper for RAG chat) vs `claude-haiku-4-5`
   (cheapest, for a high-volume tier). Recommendation: **Sonnet 5**. — *Owner: founder.*
2. **Embedding provider:** reuse Gemini `text-embedding-004` (768-dim, already wired via
   `knowledge-base.ts`) on a **platform** key, or switch to Voyage (Anthropic's recommended
   embeddings)? Recommendation: reuse Gemini to ship fast; revisit later. Confirm the existing
   `kb_chunks` embedding dimension and match it. — *Owner: Antigravity to confirm dimension;
   founder to approve provider.*
3. **Admin support-view:** should admins be able to read their team's Ozzo conversations to
   see where people struggle? Phase 1 says no (privacy). Confirm. — *Owner: founder.*
4. **Corpus authoring surface:** Phase 1 ingests markdown via a superadmin script. Do we want
   a superadmin UI to edit `ozzo_docs` later? (Not in Phase 1.) — *Owner: founder, later.*

## 11. Acceptance Criteria

**Functional**
- A signed-in web admin can open Ask Ozzo, ask "How do I configure a scheme?", and receive a
  streamed, correct answer with at least one Source citation linking to a real `ozzo_docs`
  article. Verified manually against seeded corpus.
- A field user on mobile can ask "Why can't I punch in?" and get the device-approval / GPS
  troubleshooting answer. Verified on device.
- Asking "show today's collections" yields a refusal + guidance, NOT data. Verified.
- Asking to perform an action yields a refusal + self-serve steps. Verified.
- A question with no matching docs yields an honest "I don't have that" + pointer. Verified.

**Code Quality** — TypeScript strict, zero errors, no `any`; Zod validates the `/api/ozzo/ask`
body; no raw DB errors surfaced to the client.

**Architecture** — RAG flow reuses `knowledge-base.ts`/`engine.ts` patterns (no duplicate
embedding/generation stacks); corpus tables global, per-user tables tenant-scoped; secrets
server-side only; business logic in `src/lib/`, not in components.

**Testing** — unit test the retrieval + prompt-assembly (grounding) and the refusal boundary
(a data question returns guidance, not data); RLS check: user A cannot read user B's
`ozzo_messages` (cross-user query returns `[]`); unauthenticated `/api/ozzo/ask` returns 401.

**Security** — Anthropic + embedding keys never shipped to client; corpus write = superadmin
only; injection test (a question trying to override the system prompt cannot extract data —
there is none to extract, verify the boundary holds); rate-limit enforced.

**Performance** — first token < ~2s on Sonnet/Haiku; `match_ozzo_chunks` uses the vector index
(no full scan); prompt caching applied to the stable system prompt to cut cost; per-message
token usage recorded.

**Documentation** — engineering-handbook updated with the ASK OZZO module + the new
"global corpus, no account_id" RLS exception; this spec's Open Questions resolved and recorded.

**Production Readiness** — account toggle + permission gate work; disabled state hides the
panel; mobile offline state present; telemetry (tokens, thumbs-down) queryable so the corpus
can be improved; core operating loop unaffected (this feature is additive and read-only).

## 12. Antigravity Implementation Contract

You are implementing the feature described above. Follow this process in order. Do not skip
steps, and do not proceed past a "STOP AND ASK" trigger without getting an answer first.

### Step 1 — Read before writing anything
1. Read the full Engineering Handbook for the current tech stack, architecture principles,
   and code standards.
2. Read this entire specification, including Open Questions.
3. Search the existing codebase before writing new code. Specifically search for:
   `knowledge-base.ts`, `engine.ts`, `match_kb_chunks`, `kb_chunks`, `generateEmbedding`,
   `bot_settings`, `permissions-registry.ts`, `has_permission`, `use-auth.tsx`,
   `dashboard-shell.tsx`, `RequirePermission`, `gated-button.tsx`, `PermissionWrapper.tsx`,
   and the `accounts.settings` jsonb usage (`order_settings`, `task_types`).
4. Identify the real naming conventions by inspecting actual files — do not assume.
5. **Do not assume offline support exists.** This feature is online-only by design and must
   NOT be wired into `SyncEngine`; it must show a clear offline state on mobile instead.
   Confirm the handbook's offline notes are still accurate against the live repo.

### Step 2 — STOP AND ASK triggers
Stop and ask a specific question (never silently default) if:
- Any Open Question in §10 is relevant to code you're about to write — especially the **model
  tier** and the **embedding dimension/provider**.
- The existing `kb_chunks` embedding dimension differs from the `vector(768)` assumed here —
  match the existing dimension, ask if unclear.
- `@anthropic-ai/sdk` is not already a dependency (adding a new dependency is a STOP AND ASK).
- You find existing code that conflicts with this spec (e.g. an existing Ozzo/assistant
  surface).
- The spec doesn't specify behavior for a case you hit (an error state, a permission edge).
- You're about to change a shared component/service/table affecting other features.

Ask a specific, answerable question — e.g. "The existing `kb_chunks.embedding` is
`vector(1536)`, not 768 — should `ozzo_doc_chunks` use 1536 and the same embedding model?"

### Step 3 — Implementation rules
- TypeScript strict: zero errors, no `any` without a justifying comment.
- Reuse Before Create / Extend Before Replace — reuse the `knowledge-base.ts`/`engine.ts` RAG
  pattern rather than building a second embedding/generation stack.
- Match the data model and API contract exactly; deviations are STOP AND ASK.
- Respect multi-tenant isolation (RLS) on every per-user table; the corpus tables are
  deliberately global-read (published only) / superadmin-write — comment this clearly.
- Keep all secrets (Anthropic key, embedding key) server-side in the Route Handler; never
  ship them to web or mobile.
- Enforce the read-only boundary in the system prompt AND by simply never giving the model any
  business-data tool or query — there is no code path from Ozzo to tenant business rows.
- Mobile: online-only, graceful offline state, `<SafeAreaView>` + `<KeyboardAvoidingView>`.

### Step 4 — Self-verification before declaring done
Check against every item in §11, category by category (Functional, Code Quality,
Architecture, Testing, Security, Performance, Documentation, Production Readiness). Explicitly
confirm the refusal boundary (a data question returns guidance, not data) and the RLS
cross-user check. If any item can't be verified in your environment, say so.

### Step 5 — Report back
Report: (1) what was implemented mapped to spec sections; (2) any deviations and why; (3) any
new conventions discovered/introduced (for the handbook); (4) any Acceptance Criteria that
couldn't be fully verified and why.
