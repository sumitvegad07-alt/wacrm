// ============================================================
// ASK OZZO — corpus ingestion (superadmin / server-side only)
//
// Chunk + embed a markdown article and (re)write its chunks. Uses the same
// Gemini 768-dim embedding as retrieval so vectors are comparable. Pass a
// service-role client (this bypasses RLS deliberately — corpus authoring is
// a platform operation, not a tenant one).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkText } from '@/lib/ai/knowledge-base';
import { embedForOzzo } from './retrieval';

export interface OzzoDocInput {
  slug: string;
  title: string;
  module: string;
  category: 'guide' | 'sop' | 'faq' | 'troubleshooting' | 'release_note' | 'concept';
  body_md: string;
  min_plan?: string | null;
  source_ref?: string | null;
  is_published?: boolean; // default true
}

/**
 * Upsert one doc by slug and (re)build its chunks + embeddings.
 * Idempotent: re-running replaces the chunk set for that doc.
 */
export async function upsertOzzoDoc(
  admin: SupabaseClient,
  input: OzzoDocInput,
): Promise<{ docId: string; chunks: number }> {
  const { data: doc, error: docErr } = await admin
    .from('ozzo_docs')
    .upsert(
      {
        slug: input.slug,
        title: input.title,
        module: input.module,
        category: input.category,
        body_md: input.body_md,
        min_plan: input.min_plan ?? null,
        source_ref: input.source_ref ?? null,
        is_published: input.is_published ?? true,
      },
      { onConflict: 'slug' },
    )
    .select('id')
    .single();

  if (docErr || !doc) {
    throw new Error(`upsert ozzo_docs failed for "${input.slug}": ${docErr?.message}`);
  }

  // Rebuild chunks from scratch for a clean, idempotent re-ingest.
  await admin.from('ozzo_doc_chunks').delete().eq('doc_id', doc.id);

  const pieces = chunkText(input.body_md, 1000);
  let index = 0;
  for (const content of pieces) {
    const embedding = await embedForOzzo(content);
    const { error: chErr } = await admin.from('ozzo_doc_chunks').insert({
      doc_id: doc.id,
      chunk_index: index,
      content,
      embedding: `[${embedding.join(',')}]`,
      token_count: Math.round(content.length / 4),
    });
    if (chErr) {
      throw new Error(`insert chunk ${index} for "${input.slug}" failed: ${chErr.message}`);
    }
    index += 1;
  }

  return { docId: doc.id, chunks: index };
}
