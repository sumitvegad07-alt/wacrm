-- ============================================================
-- Migration: AI Knowledge Base Core
-- Description: Adds pgvector and tables for the AI bot
-- ============================================================

-- 1. Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Modify conversations to track bot status
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS bot_status TEXT DEFAULT 'active' CHECK (bot_status IN ('active', 'paused'));

-- 3. Bot Settings
CREATE TABLE IF NOT EXISTS bot_settings (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  is_active BOOLEAN DEFAULT false,
  bot_name TEXT DEFAULT 'Assistant',
  system_prompt TEXT DEFAULT 'You are a helpful customer support assistant. Answer the user''s question based ONLY on the provided context. If the answer is not in the context, reply with the exact word: HANDOFF.',
  handoff_message TEXT DEFAULT 'I am unable to answer that right now, let me connect you with a human agent.',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE bot_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own bot settings" ON bot_settings;
CREATE POLICY "Users can manage own bot settings" ON bot_settings FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.account_id = bot_settings.account_id));

CREATE TRIGGER set_updated_at BEFORE UPDATE ON bot_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. Knowledge Base Documents
CREATE TABLE IF NOT EXISTS kb_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT DEFAULT 'text' CHECK (source_type IN ('file', 'url', 'text')),
  status TEXT DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'failed')),
  content_text TEXT, -- Raw text before chunking
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE kb_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own kb documents" ON kb_documents;
CREATE POLICY "Users can manage own kb documents" ON kb_documents FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.account_id = kb_documents.account_id));

-- 5. Knowledge Base Chunks (The Vectors)
CREATE TABLE IF NOT EXISTS kb_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(768) -- Gemini embeddings are 768 dimensions (text-embedding-004)
);

-- Index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS kb_chunks_embedding_idx ON kb_chunks USING ivfflat (embedding vector_cosine_ops);

ALTER TABLE kb_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own kb chunks" ON kb_chunks;
CREATE POLICY "Users can manage own kb chunks" ON kb_chunks FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = auth.uid() AND profiles.account_id = kb_chunks.account_id));

-- 6. RPC Function for similarity search
CREATE OR REPLACE FUNCTION match_kb_chunks (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_account_id uuid
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kb_chunks.id,
    kb_chunks.document_id,
    kb_chunks.content,
    1 - (kb_chunks.embedding <=> query_embedding) AS similarity
  FROM kb_chunks
  WHERE kb_chunks.account_id = p_account_id
    AND 1 - (kb_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY kb_chunks.embedding <=> query_embedding
  LIMIT match_count;
$$;
