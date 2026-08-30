// ============================================================
// POST /api/ozzo/ask — ASK OZZO Support & Implementation Copilot
//
// Read-only, grounded, Claude Sonnet 5. Streams an NDJSON body:
//   {"type":"delta","text":"..."}   (many)
//   {"type":"done","conversationId":"...","messageId":"...","citations":[...],"suggestedNavigation":null}
//   {"type":"error","message":"..."} (on failure)
//
// Secrets (ANTHROPIC_API_KEY, GEMINI_API_KEY) stay server-side. There is
// NO code path from here to tenant business data — Ozzo only reads the
// global product-doc corpus + the user's own Ozzo chat history.
// ============================================================

import { z } from 'zod';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { retrieveOzzoChunks } from '@/lib/ozzo/retrieval';
import { streamOzzoAnswer } from '@/lib/ozzo/claude';
import type {
  OzzoCitation,
  OzzoDoneMeta,
  OzzoHistoryTurn,
} from '@/lib/ozzo/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  question: z.string().trim().min(1).max(2000),
  surface: z.enum(['web', 'mobile']).default('web'),
  context: z
    .object({
      roleName: z.string().max(120).optional(),
      accountRole: z.string().max(40).optional(),
      plan: z.string().max(40).optional(),
      enabledModules: z.array(z.string().max(80)).max(60).optional(),
      currentModule: z.string().max(80).optional(),
    })
    .optional(),
});

const HISTORY_LIMIT = 8;

function json(obj: unknown): string {
  return JSON.stringify(obj) + '\n';
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  // Account-level feature toggle (default ON). Gate is the toggle + being a
  // signed-in member; ASK OZZO is help, available to everyone by default.
  const { data: acct } = await ctx.supabase
    .from('accounts')
    .select('settings')
    .eq('id', ctx.accountId)
    .maybeSingle();
  const enabled =
    (acct?.settings as { ask_ozzo_enabled?: boolean } | null)?.ask_ozzo_enabled !==
    false;
  if (!enabled) {
    return new Response(JSON.stringify({ error: 'ASK OZZO is disabled for this account' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rl = checkRateLimit(`ozzo:${ctx.userId}`, RATE_LIMITS.askOzzo);
  if (!rl.success) {
    return new Response(
      JSON.stringify({ error: "You're asking quickly — give me a moment." }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { conversationId, question, surface, context } = parsed.data;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(json(obj)));
      try {
        // 1. Retrieve grounding from the global corpus (published only, via RLS).
        const chunks = await retrieveOzzoChunks(
          ctx!.supabase,
          question,
          context?.currentModule,
        );

        // 2. Resolve / create the conversation (RLS: own rows only).
        let convId = conversationId ?? null;
        if (convId) {
          const { data: existing } = await ctx!.supabase
            .from('ozzo_conversations')
            .select('id')
            .eq('id', convId)
            .maybeSingle();
          if (!existing) convId = null; // not theirs / gone → start fresh
        }
        if (!convId) {
          const { data: created, error: convErr } = await ctx!.supabase
            .from('ozzo_conversations')
            .insert({
              account_id: ctx!.accountId,
              user_id: ctx!.userId,
              surface,
              title: question.slice(0, 80),
            })
            .select('id')
            .single();
          if (convErr || !created) throw new Error('Could not start conversation');
          convId = created.id;
        }

        // 3. Load a little history for continuity.
        let history: OzzoHistoryTurn[] = [];
        if (conversationId && convId === conversationId) {
          const { data: past } = await ctx!.supabase
            .from('ozzo_messages')
            .select('role, content')
            .eq('conversation_id', convId)
            .order('created_at', { ascending: false })
            .limit(HISTORY_LIMIT);
          history = (past ?? [])
            .reverse()
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
        }

        // 4. Persist the user's question.
        await ctx!.supabase.from('ozzo_messages').insert({
          conversation_id: convId,
          account_id: ctx!.accountId,
          role: 'user',
          content: question,
        });

        // 5. Stream the grounded answer.
        const result = await streamOzzoAnswer(
          { question, chunks, context, history },
          (delta) => send({ type: 'delta', text: delta }),
        );

        // 6. Sources = unique published docs that grounded the answer.
        const seen = new Set<string>();
        const citations: OzzoCitation[] = [];
        const citedDocIds: string[] = [];
        for (const c of chunks) {
          if (seen.has(c.slug)) continue;
          seen.add(c.slug);
          citations.push({ slug: c.slug, title: c.title, module: c.module });
          citedDocIds.push(c.doc_id);
        }

        // 7. Persist the assistant answer + telemetry.
        const { data: asstMsg } = await ctx!.supabase
          .from('ozzo_messages')
          .insert({
            conversation_id: convId,
            account_id: ctx!.accountId,
            role: 'assistant',
            content: result.fullText,
            cited_doc_ids: citedDocIds,
            model: 'claude-sonnet-5',
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
          })
          .select('id')
          .single();

        if (!convId) throw new Error('conversation id missing');
        const done: OzzoDoneMeta = {
          conversationId: convId,
          messageId: asstMsg?.id ?? '',
          citations,
          suggestedNavigation: null,
        };
        send({ type: 'done', ...done });
        controller.close();
      } catch (err) {
        console.error('[POST /api/ozzo/ask] stream error:', err);
        send({
          type: 'error',
          message: "I'm having trouble right now. Please try again in a moment.",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
