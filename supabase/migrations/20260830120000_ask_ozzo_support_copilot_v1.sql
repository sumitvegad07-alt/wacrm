-- ============================================================
-- ASK OZZO — Support & Implementation Copilot (v1, web-only)
-- Spec: docs/engineering/specifications/ask-ozzo-support-copilot.md
--
-- Read-only, Claude-powered, RAG over a GLOBAL product-doc corpus.
-- NOT a data/BI copilot, NOT an agent. Never reads tenant business rows.
--
-- Two table families:
--   1. GLOBAL corpus (ozzo_docs, ozzo_doc_chunks) — SAME docs for every
--      tenant, so deliberately NO account_id. Superadmin-writable,
--      any-authenticated readable (published only).
--   2. Per-user chat (ozzo_conversations, ozzo_messages, ozzo_feedback) —
--      account_id + user_id scoped, standard RLS, private to the user.
--
-- pgvector already enabled (kb_chunks uses it). Embeddings are 768-dim
-- (Gemini gemini-embedding-2) — MUST match src/lib/ai/knowledge-base.ts.
-- ============================================================

create extension if not exists vector;

-- ------------------------------------------------------------
-- 1. GLOBAL CORPUS
-- ------------------------------------------------------------
create table if not exists public.ozzo_docs (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  module       text not null,           -- schemes | orders | attendance | leads | permissions | imports | beat | payments | stock | platform | ...
  category     text not null check (category in ('guide','sop','faq','troubleshooting','release_note','concept')),
  body_md      text not null,
  min_plan     text,                    -- optional plan gate for context-aware answers (CRM/SFA/WFA/null)
  source_ref   text,                    -- provenance for auto-ingested docs
  version      int not null default 1,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.ozzo_doc_chunks (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references public.ozzo_docs(id) on delete cascade,
  chunk_index int not null,
  content     text not null,
  embedding   vector(768) not null,     -- MUST match kb_chunks dimension
  token_count int,
  unique (doc_id, chunk_index)
);

-- HNSW cosine index — no training/lists tuning needed, robust for a small/medium corpus.
create index if not exists ozzo_doc_chunks_embedding_idx
  on public.ozzo_doc_chunks using hnsw (embedding vector_cosine_ops);

drop trigger if exists trg_ozzo_docs_updated on public.ozzo_docs;
create trigger trg_ozzo_docs_updated before update on public.ozzo_docs
  for each row execute function public.update_updated_at_column();

-- ------------------------------------------------------------
-- 2. PER-USER CHAT
-- ------------------------------------------------------------
create table if not exists public.ozzo_conversations (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id    uuid not null,
  surface    text not null default 'web' check (surface in ('web','mobile')),
  title      text,
  created_at timestamptz not null default now()
);
create index if not exists ozzo_conversations_user_idx
  on public.ozzo_conversations (account_id, user_id, created_at desc);

create table if not exists public.ozzo_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ozzo_conversations(id) on delete cascade,
  account_id      uuid not null,        -- denormalized for RLS
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  cited_doc_ids   uuid[],
  model           text,
  input_tokens    int,
  output_tokens   int,
  created_at      timestamptz not null default now()
);
create index if not exists ozzo_messages_conversation_idx
  on public.ozzo_messages (conversation_id, created_at);

create table if not exists public.ozzo_feedback (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.ozzo_messages(id) on delete cascade,
  account_id uuid not null,
  user_id    uuid not null,
  rating     text not null check (rating in ('up','down')),
  reason     text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 3. RLS
-- ------------------------------------------------------------
alter table public.ozzo_docs        enable row level security;
alter table public.ozzo_doc_chunks  enable row level security;
alter table public.ozzo_conversations enable row level security;
alter table public.ozzo_messages    enable row level security;
alter table public.ozzo_feedback    enable row level security;

-- Corpus: GLOBAL read of PUBLISHED docs for any signed-in user (no account_id
-- by design — the docs are identical for every tenant). Writes = superadmin only.
drop policy if exists ozzo_docs_select on public.ozzo_docs;
create policy ozzo_docs_select on public.ozzo_docs
  for select to authenticated using (is_published = true);

drop policy if exists ozzo_docs_write on public.ozzo_docs;
create policy ozzo_docs_write on public.ozzo_docs
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_superadmin = true))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_superadmin = true));

drop policy if exists ozzo_doc_chunks_select on public.ozzo_doc_chunks;
create policy ozzo_doc_chunks_select on public.ozzo_doc_chunks
  for select to authenticated using (
    exists (select 1 from public.ozzo_docs d where d.id = doc_id and d.is_published = true)
  );

drop policy if exists ozzo_doc_chunks_write on public.ozzo_doc_chunks;
create policy ozzo_doc_chunks_write on public.ozzo_doc_chunks
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_superadmin = true))
  with check (exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.is_superadmin = true));

-- Per-user chat: private to the creating user, within their account.
drop policy if exists ozzo_conversations_rw on public.ozzo_conversations;
create policy ozzo_conversations_rw on public.ozzo_conversations
  for all to authenticated
  using (is_account_member(account_id) and user_id = auth.uid())
  with check (is_account_member(account_id) and user_id = auth.uid());

drop policy if exists ozzo_messages_rw on public.ozzo_messages;
create policy ozzo_messages_rw on public.ozzo_messages
  for all to authenticated
  using (
    is_account_member(account_id) and exists (
      select 1 from public.ozzo_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    is_account_member(account_id) and exists (
      select 1 from public.ozzo_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists ozzo_feedback_rw on public.ozzo_feedback;
create policy ozzo_feedback_rw on public.ozzo_feedback
  for all to authenticated
  using (is_account_member(account_id) and user_id = auth.uid())
  with check (is_account_member(account_id) and user_id = auth.uid());

-- ------------------------------------------------------------
-- 4. RETRIEVAL RPC — mirrors match_kb_chunks but GLOBAL (no account filter),
-- with an optional soft module boost. SECURITY INVOKER so corpus RLS applies
-- (only published docs' chunks are ever returned).
-- ------------------------------------------------------------
create or replace function public.match_ozzo_chunks(
  query_embedding vector,
  match_threshold double precision,
  match_count integer,
  p_module text default null
)
returns table (
  chunk_id uuid,
  doc_id uuid,
  slug text,
  title text,
  module text,
  content text,
  similarity double precision
)
language sql
stable
as $$
  select
    ch.id as chunk_id,
    d.id  as doc_id,
    d.slug,
    d.title,
    d.module,
    ch.content,
    1 - (ch.embedding <=> query_embedding) as similarity
  from public.ozzo_doc_chunks ch
  join public.ozzo_docs d on d.id = ch.doc_id
  where d.is_published = true
    and 1 - (ch.embedding <=> query_embedding) > match_threshold
  order by
    (1 - (ch.embedding <=> query_embedding))
      + case when p_module is not null and d.module = p_module then 0.05 else 0 end desc
  limit match_count;
$$;
