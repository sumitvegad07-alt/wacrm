// ============================================================
// ASK OZZO — shared types (Support & Implementation Copilot, read-only)
// ============================================================

/** SAFE, non-business context sent from the client to tailor answers.
 *  NONE of this is tenant business data — it is config/role metadata the
 *  client already holds, used only to make guidance role/plan/screen aware. */
export interface OzzoContext {
  roleName?: string; // business role label, e.g. "Sales Executive"
  accountRole?: string; // owner | admin | agent | viewer
  plan?: string; // CRM | SFA | WFA | ...
  enabledModules?: string[]; // e.g. ["schemeManagement:false", "stock:true"]
  currentModule?: string; // screen the user is on, e.g. "schemes"
}

export interface OzzoAskRequest {
  conversationId?: string;
  question: string;
  surface: 'web' | 'mobile';
  context?: OzzoContext;
}

/** One retrieved knowledge chunk. */
export interface OzzoChunk {
  chunk_id: string;
  doc_id: string;
  slug: string;
  title: string;
  module: string;
  content: string;
  similarity: number;
}

/** A cited source surfaced to the UI. */
export interface OzzoCitation {
  slug: string;
  title: string;
  module: string;
}

/** Terminal metadata streamed after the answer text. */
export interface OzzoDoneMeta {
  conversationId: string;
  messageId: string;
  citations: OzzoCitation[];
  /** Phase 1 always null; Phase 2 (deep-link navigation) fills this. */
  suggestedNavigation: null;
}

export interface OzzoHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}
