// ============================================================
// ASK OZZO — retrieval (embed the question, match the GLOBAL corpus)
//
// Reuses the existing Gemini embedding (src/lib/ai/knowledge-base.ts,
// 768-dim gemini-embedding-2) on the PLATFORM key GEMINI_API_KEY — NOT a
// tenant key. The match runs through the caller's RLS client, and
// match_ozzo_chunks only ever returns chunks of PUBLISHED docs.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding } from '@/lib/ai/knowledge-base';
import type { OzzoChunk } from './types';

const MATCH_THRESHOLD = 0.3;
const MATCH_COUNT = 6;

/** Platform embedding key. Server-only; never shipped to the client. */
function embeddingKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY is not configured (ASK OZZO embeddings)');
  }
  return key;
}

/**
 * Embed a piece of text with the platform embedding key.
 * Exported so the ingestion script can reuse the exact same model/dim.
 */
export async function embedForOzzo(text: string): Promise<number[]> {
  return generateEmbedding(text, embeddingKey());
}

/**
 * Retrieve the most relevant published documentation chunks for a question.
 * `currentModule` (if any) gives a soft ranking boost to same-module docs.
 */
export async function retrieveOzzoChunks(
  supabase: SupabaseClient,
  question: string,
  currentModule?: string,
): Promise<OzzoChunk[]> {
  const embedding = await embedForOzzo(question);

  const { data, error } = await supabase.rpc('match_ozzo_chunks', {
    query_embedding: `[${embedding.join(',')}]`,
    match_threshold: MATCH_THRESHOLD,
    match_count: MATCH_COUNT,
    p_module: currentModule ?? null,
  });

  if (error) {
    console.error('[ozzo] match_ozzo_chunks failed:', error.message);
    throw new Error('Knowledge retrieval failed');
  }

  return (data ?? []) as OzzoChunk[];
}
