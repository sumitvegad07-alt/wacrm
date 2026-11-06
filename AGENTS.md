<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:working-agreement -->
# Read this before changing anything

`docs/engineering/WORKING-AGREEMENT.md` is the process for this repo: the five
gates every change passes, the five questions every schema change answers, and
why "local testing" is not yet what it sounds like here.

It exists because on 2026-11-03 a one-line additive migration — a nullable
column with a foreign key — took the order screens down on web and mobile for
three days. Adding a column was the second FK from `orders` to `contacts`, and
PostgREST stopped resolving `contacts(*)`. Nothing caught it: `tsc` does not
read PostgREST select strings, and there was nowhere safe to click.

The short version:

1. `npx tsc --noEmit`, `npx vitest run`, `npm run lint:ui` and
   `bash scripts/run-db-tests.sh` all pass before anything reaches `main`.
2. Adding a second foreign key between two tables means every embed between
   them needs `child!<constraint>(...)`, and the pair goes in
   `AMBIGUOUS_EMBEDS` in `src/lib/supabase/ambiguous-embeds.test.ts`.
3. `.env.local` points at PRODUCTION (Mumbai). There is no local database yet.
   Exercise schema and rule changes on the local PostgreSQL harness
   (`scripts/run-db-tests.sh`), which is genuinely isolated.
4. Every bug gets a test that is seen to FAIL first.
<!-- END:working-agreement -->
