import { createClient } from '@supabase/supabase-js';
import { generateEmbedding, generateRagResponse } from './knowledge-base';

// We need an admin client to bypass RLS in background worker contexts
function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function dispatchInboundToAI({
  accountId,
  conversationId,
  contactPhone,
  messageText,
  botStatus,
  accessToken,
  phoneNumberId,
}: {
  accountId: string;
  conversationId: string;
  contactPhone: string;
  messageText: string;
  botStatus: string;
  accessToken: string;
  phoneNumberId: string;
}): Promise<{ consumed: boolean }> {
  // 1. If bot is paused, do nothing
  if (botStatus === 'paused') {
    return { consumed: false };
  }

  const supabase = supabaseAdmin();

  // 2. Check if the account has AI enabled
  const { data: settings } = await supabase
    .from('bot_settings')
    .select('is_active, system_prompt, handoff_message, gemini_api_key')
    .eq('account_id', accountId)
    .maybeSingle();

  if (!settings) {
    return { consumed: false };
  }
  if (!settings.is_active) {
    return { consumed: false };
  }
  if (!settings.gemini_api_key) {
    await sendBotMessage(conversationId, "⚠️ AI Error: Gemini API Key is missing in settings.", contactPhone, accessToken, phoneNumberId);
    return { consumed: true };
  }

  // 3. Generate embedding for the user's message
  let queryEmbedding: number[];
  try {
    queryEmbedding = await generateEmbedding(messageText, settings.gemini_api_key);
  } catch (err: any) {
    console.error('[AI] Failed to generate embedding:', err);
    await sendBotMessage(conversationId, "⚠️ AI Error generating embedding: " + (err.message || 'Unknown'), contactPhone, accessToken, phoneNumberId);
    return { consumed: true };
  }

  // 4. Search for relevant context in the Knowledge Base
  const { data: matches, error: matchError } = await supabase
    .rpc('match_kb_chunks', {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      match_threshold: 0.3, // Require at least 30% cosine similarity
      match_count: 5,
      p_account_id: accountId,
    });

  if (matchError) {
    console.error('[AI] Failed to match kb chunks:', matchError);
    await sendBotMessage(conversationId, "⚠️ AI Error searching knowledge base: " + matchError.message, contactPhone, accessToken, phoneNumberId);
    return { consumed: true };
  }

  const contextChunks = matches?.map((m: any) => m.content) || [];

  // If no relevant context found, hand off immediately
  if (contextChunks.length === 0) {
    await handoffToHuman(conversationId, settings.handoff_message, contactPhone, accessToken, phoneNumberId);
    return { consumed: true }; // Consumed because the bot took the "Handoff" action
  }

  // 5. Generate reply via LLM
  let replyText = '';
  try {
    replyText = await generateRagResponse(messageText, contextChunks, settings.system_prompt, settings.gemini_api_key);
  } catch (err: any) {
    console.error('[AI] LLM generation failed:', err);
    await sendBotMessage(conversationId, "⚠️ AI Error generating reply: " + (err.message || 'Unknown'), contactPhone, accessToken, phoneNumberId);
    return { consumed: true };
  }

  const trimmedReply = replyText.trim();

  // 6. Check for Handoff signal
  if (trimmedReply.toUpperCase() === 'HANDOFF' || trimmedReply.toUpperCase().includes('HANDOFF')) {
    await handoffToHuman(conversationId, settings.handoff_message, contactPhone, accessToken, phoneNumberId);
    return { consumed: true };
  }

  // 7. Send the AI's answer
  await sendBotMessage(conversationId, trimmedReply, contactPhone, accessToken, phoneNumberId);

  return { consumed: true };
}

async function handoffToHuman(
  conversationId: string, 
  handoffMessage: string, 
  contactPhone: string,
  accessToken: string,
  phoneNumberId: string
) {
  const supabase = supabaseAdmin();
  
  // Pause the bot for this conversation
  await supabase
    .from('conversations')
    .update({ bot_status: 'paused' })
    .eq('id', conversationId);

  // Send the handoff message
  await sendBotMessage(conversationId, handoffMessage, contactPhone, accessToken, phoneNumberId);
}

async function sendBotMessage(
  conversationId: string, 
  text: string, 
  contactPhone: string,
  accessToken: string,
  phoneNumberId: string
) {
  const supabase = supabaseAdmin();

  // Call Meta API
  try {
    const metaResponse = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: contactPhone,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!metaResponse.ok) {
      const errBody = await metaResponse.text();
      console.error('[AI] Meta API error:', errBody);
      return;
    }

    const metaData = await metaResponse.json();
    const metaMessageId = metaData.messages?.[0]?.id;

    // Record the message in our DB
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      content_type: 'text',
      content_text: text,
      message_id: metaMessageId,
      status: 'sent',
    });

    // Update conversation last_message
    await supabase.from('conversations').update({
      last_message_text: text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', conversationId);

  } catch (err) {
    console.error('[AI] Failed to send bot message:', err);
  }
}
