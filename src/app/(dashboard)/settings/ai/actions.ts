'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateEmbedding, chunkText } from '@/lib/ai/knowledge-base'

export async function saveBotSettings(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).single()
  if (!profile?.account_id) throw new Error('No account found')

  const is_active = formData.get('is_active') === 'on'
  const bot_name = formData.get('bot_name') as string
  const system_prompt = formData.get('system_prompt') as string
  const handoff_message = formData.get('handoff_message') as string
  const gemini_api_key = formData.get('gemini_api_key') as string

  const { error } = await supabase
    .from('bot_settings')
    .upsert({
      account_id: profile.account_id,
      is_active,
      bot_name,
      system_prompt,
      handoff_message,
      gemini_api_key,
    })

  if (error) {
    console.error('Error saving bot settings:', error)
    throw new Error('Failed to save settings')
  }

  revalidatePath('/settings/ai')
  return { success: true }
}

export async function addKnowledgeDocument(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).single()
  if (!profile?.account_id) throw new Error('No account found')

  const title = formData.get('title') as string
  const content = formData.get('content') as string

  if (!title || !content) {
    throw new Error('Title and content are required')
  }

  const { data: settings } = await supabase.from('bot_settings').select('gemini_api_key').eq('account_id', profile.account_id).single()
  const apiKey = settings?.gemini_api_key
  
  if (!apiKey) {
    throw new Error('You must provide a Gemini API Key in the settings first!')
  }

  // 1. Save Document
  const { data: doc, error: docError } = await supabase
    .from('kb_documents')
    .insert({
      account_id: profile.account_id,
      title,
      source_type: 'text',
      content_text: content,
      status: 'ready'
    })
    .select()
    .single()

  if (docError || !doc) {
    console.error('Error creating document:', docError)
    throw new Error('Failed to create document')
  }

  // 2. Chunk text and generate embeddings
  try {
    const chunks = chunkText(content)
    const records = []

    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk, apiKey)
      records.push({
        document_id: doc.id,
        account_id: profile.account_id,
        content: chunk,
        embedding: `[${embedding.join(',')}]`
      })
    }

    const { error: chunkError } = await supabase.from('kb_chunks').insert(records)
    if (chunkError) {
      console.error('Error inserting chunks:', chunkError)
      throw new Error('Failed to insert chunks')
    }

  } catch (err: any) {
    console.error('Embedding generation failed:', err)
    // Mark document as failed so the user knows
    await supabase.from('kb_documents').update({ status: 'failed' }).eq('id', doc.id)
    throw new Error('Failed to generate embeddings: ' + (err.message || 'Unknown error'))
  }

  revalidatePath('/settings/ai')
  return { success: true }
}

export async function deleteKnowledgeDocument(docId: string) {
  const supabase = await createClient()
  
  // RLS will ensure they can only delete their own
  const { error } = await supabase.from('kb_documents').delete().eq('id', docId)
  
  if (error) {
    console.error('Error deleting document:', error)
    throw new Error('Failed to delete document')
  }

  revalidatePath('/settings/ai')
  return { success: true }
}
