// ============================================================
// Proposal status: draft → sent → won | lost.
//
// The timestamps are not decoration. `decided_at` decides which month a won
// deal is counted in, so it is stamped on the transition rather than guessed
// from updated_at (which any later edit would move).
// ============================================================

export const PROPOSAL_STATUSES = ["draft", "sent", "won", "lost"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  won: "Won",
  lost: "Lost",
};

/** Tailwind classes for the status chip, shared by the table and detail page. */
export const STATUS_CLASS: Record<ProposalStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-700",
  won: "bg-emerald-100 text-emerald-700",
  lost: "bg-red-100 text-red-700",
};

export function isProposalStatus(value: unknown): value is ProposalStatus {
  return typeof value === "string" && (PROPOSAL_STATUSES as readonly string[]).includes(value);
}

export interface StatusPatch {
  status: ProposalStatus;
  sent_at: string | null;
  decided_at: string | null;
}

/**
 * The columns to write for a status change.
 *
 * Marking won or lost straight from draft still records that it was sent —
 * a proposal cannot be decided without having gone out, and leaving sent_at
 * null would understate how long deals take.
 */
export function statusPatch(
  next: ProposalStatus,
  current: { sent_at?: string | null } = {},
  now: Date = new Date(),
): StatusPatch {
  const stamp = now.toISOString();
  const sentAlready = current.sent_at ?? null;

  switch (next) {
    case "draft":
      return { status: "draft", sent_at: null, decided_at: null };
    case "sent":
      return { status: "sent", sent_at: sentAlready ?? stamp, decided_at: null };
    default:
      return { status: next, sent_at: sentAlready ?? stamp, decided_at: stamp };
  }
}
