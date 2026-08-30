// ============================================================
// GET /api/ozzo/health — ASK OZZO config diagnostic (auth-gated).
//
// Returns ONLY booleans about which server env keys are present — never the
// values themselves. Lets an admin confirm the deployment actually has the
// keys without exposing secrets. Safe to remove once the feature is stable.
// ============================================================

import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await getCurrentAccount(); // must be a signed-in member
    return NextResponse.json({
      ok: true,
      env: {
        hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
        hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      },
      model: 'claude-sonnet-5',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
