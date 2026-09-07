// Canonical default deal pipeline.
// ---------------------------------------------------------------------------
// Every pipeline is bookended by two predefined stages that cannot be deleted:
//   • "New"      — the first stage a deal enters (position 0)
//   • "Won/Lost" — the terminal stage where a deal is resolved won or lost
// Only the middle stages are configurable. Keep this in sync with the
// server-side seeder in src/app/api/provision-account/route.ts (buildStages).

export interface DefaultStageSeed {
  name: string;
  color: string;
  position: number;
}

/** The founder-approved default sales pipeline: New → Contacted → Follow-up → Quotation Sent → Won/Lost. */
export const DEFAULT_PIPELINE_STAGES: DefaultStageSeed[] = [
  { name: "New", color: "#3b82f6", position: 0 },
  { name: "Contacted", color: "#6366f1", position: 1 },
  { name: "Follow-up", color: "#eab308", position: 2 },
  { name: "Quotation Sent", color: "#f97316", position: 3 },
  { name: "Won/Lost", color: "#64748b", position: 4 },
];

/** Name given to the first (locked) stage of every pipeline. */
export const FIRST_STAGE_NAME = "New";
/** Name given to the last (locked, terminal) stage of every pipeline. */
export const TERMINAL_STAGE_NAME = "Won/Lost";

/**
 * True when `name` reads as the combined Won/Lost terminal stage
 * (e.g. "Won/Lost", "Won / Lost", "won-lost"). Used so brand-new pipelines
 * get terminal behaviour while legacy pipelines with separate
 * "Closed Won"/"Closed Lost" stages keep their old flow.
 */
export function isWonLostName(name?: string | null): boolean {
  if (!name) return false;
  return /won\s*[\/\-–]?\s*lost/i.test(name.trim());
}
