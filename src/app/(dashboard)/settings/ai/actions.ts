'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateEmbedding, chunkText } from '@/lib/ai/knowledge-base'
import { extractTextFromURL, extractTextFromYouTube, extractTextFromFile } from '@/lib/ai/document-parser'

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
  if (!user) return { error: 'Unauthorized' }

  const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).single()
  if (!profile?.account_id) return { error: 'No account found' }

  const title = formData.get('title') as string
  const sourceType = formData.get('source_type') as string // 'text', 'url', 'youtube', 'file'

  if (!title || !sourceType) {
    return { error: 'Title and source type are required' }
  }

  const { data: settings } = await supabase.from('bot_settings').select('gemini_api_key').eq('account_id', profile.account_id).single()
  const apiKey = settings?.gemini_api_key
  
  if (!apiKey) {
    return { error: 'You must provide a Gemini API Key in the settings first!' }
  }

  let content = '';

  // Extract text based on source type
  try {
    if (sourceType === 'text') {
      content = formData.get('content') as string;
      if (!content) throw new Error('Raw text content is required');
    } 
    else if (sourceType === 'url') {
      const url = formData.get('url') as string;
      if (!url) throw new Error('URL is required');
      content = await extractTextFromURL(url);
    }
    else if (sourceType === 'youtube') {
      const url = formData.get('youtube_url') as string;
      if (!url) throw new Error('YouTube URL is required');
      content = await extractTextFromYouTube(url);
    }
    else if (sourceType === 'file') {
      const file = formData.get('file') as File;
      if (!file || file.size === 0) throw new Error('File is required');
      content = await extractTextFromFile(file);
    }
    else {
      throw new Error('Invalid source type');
    }
  } catch (error: any) {
    return { error: `Failed to extract text: ${error.message}` };
  }

  if (!content || content.trim().length === 0) {
    return { error: 'No readable text could be extracted from this source.' };
  }

  // 1. Save Document
  const { data: doc, error: docError } = await supabase
    .from('kb_documents')
    .insert({
      account_id: profile.account_id,
      title,
      source_type: sourceType === 'url' || sourceType === 'youtube' ? 'url' : sourceType === 'file' ? 'file' : 'text',
      content_text: content,
      status: 'ready'
    })
    .select()
    .single()

  if (docError || !doc) {
    console.error('Error creating document:', docError)
    return { error: 'Failed to create document' }
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
      return { error: 'Failed to insert chunks' }
    }

  } catch (err: any) {
    console.error('Embedding generation failed:', err)
    // Mark document as failed so the user knows
    await supabase.from('kb_documents').update({ status: 'failed' }).eq('id', doc.id)
    return { error: 'Failed to generate embeddings: ' + (err.message || 'Unknown error') }
  }


  return { success: true }
}

export async function deleteKnowledgeDocument(docId: string) {
  const supabase = await createClient()
  
  // RLS will ensure they can only delete their own
  const { error } = await supabase.from('kb_documents').delete().eq('id', docId)
  
  if (error) {
    console.error('Error deleting document:', error)
    return { error: 'Failed to delete document' }
  }

  return { success: true }
}

export async function updateKnowledgeDocument(docId: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { data: profile } = await supabase.from('profiles').select('account_id').eq('user_id', user.id).single()
  if (!profile?.account_id) return { error: 'No account found' }

  const title = formData.get('title') as string
  const content = formData.get('content') as string

  if (!title || !content) {
    return { error: 'Title and content are required' }
  }

  const { data: settings } = await supabase.from('bot_settings').select('gemini_api_key').eq('account_id', profile.account_id).single()
  const apiKey = settings?.gemini_api_key
  
  if (!apiKey) {
    return { error: 'You must provide a Gemini API Key in the settings first!' }
  }

  // 1. Update Document status to processing
  const { error: docError } = await supabase
    .from('kb_documents')
    .update({
      title,
      content_text: content,
      status: 'processing'
    })
    .eq('id', docId)

  if (docError) {
    console.error('Error updating document:', docError)
    return { error: 'Failed to update document' }
  }

  // 2. Delete old chunks
  await supabase.from('kb_chunks').delete().eq('document_id', docId)

  // 3. Chunk text and generate new embeddings
  try {
    const chunks = chunkText(content)
    const records = []

    for (const chunk of chunks) {
      const embedding = await generateEmbedding(chunk, apiKey)
      records.push({
        document_id: docId,
        account_id: profile.account_id,
        content: chunk,
        embedding: `[${embedding.join(',')}]`
      })
    }

    const { error: chunkError } = await supabase.from('kb_chunks').insert(records)
    if (chunkError) {
      console.error('Error inserting chunks:', chunkError)
      return { error: 'Failed to insert chunks' }
    }

    // Mark as ready
    await supabase.from('kb_documents').update({ status: 'ready' }).eq('id', docId)

  } catch (err: any) {
    console.error('Embedding generation failed:', err)
    await supabase.from('kb_documents').update({ status: 'failed' }).eq('id', docId)
    return { error: 'Failed to generate embeddings: ' + (err.message || 'Unknown error') }
  }


  return { success: true }
}
