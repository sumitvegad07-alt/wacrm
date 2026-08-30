// ============================================================
// ASK OZZO — Claude generation (Sonnet 5, streaming, grounded, read-only)
//
// The Anthropic API key lives ONLY in server env (ANTHROPIC_API_KEY) and
// never reaches the client. Thinking is disabled and effort is low — this
// is a snappy grounded-RAG support chat, not a reasoning task.
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { OZZO_SYSTEM_PROMPT, buildOzzoUserMessage } from './prompt';
import type { OzzoChunk, OzzoContext, OzzoHistoryTurn } from './types';

export const OZZO_MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 1024;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured (ASK OZZO)');
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export interface OzzoStreamResult {
  fullText: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Stream a grounded answer. `onDelta` is called with each text fragment as
 * it arrives; the promise resolves with the full text + token usage once done.
 */
export async function streamOzzoAnswer(
  params: {
    question: string;
    chunks: OzzoChunk[];
    context?: OzzoContext;
    history?: OzzoHistoryTurn[];
  },
  onDelta: (text: string) => void,
): Promise<OzzoStreamResult> {
  const { question, chunks, context, history = [] } = params;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user' as const, content: buildOzzoUserMessage(question, chunks, context) },
  ];

  const stream = anthropic().messages.stream({
    model: OZZO_MODEL,
    max_tokens: MAX_TOKENS,
    // Grounded support chat: no thinking needed, keep it fast + cheap.
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' },
    system: [
      {
        type: 'text',
        text: OZZO_SYSTEM_PROMPT,
        // Stable prefix — cache it so repeat questions don't re-bill the prompt.
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages,
  });

  stream.on('text', (delta) => onDelta(delta));

  const final = await stream.finalMessage();
  const fullText = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return {
    fullText,
    inputTokens: final.usage.input_tokens ?? 0,
    outputTokens: final.usage.output_tokens ?? 0,
  };
}
