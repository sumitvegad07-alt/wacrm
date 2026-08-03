// Pure execution helpers (Phase 2d). Kept out of the SDK/UI so the progress computation is
// unit-testable. Framework-agnostic.

export interface StopTally {
  total: number;
  completed: number;
  skipped: number;
  pending: number;
}

/** Tally stops per execution into completed/skipped/pending counts. Unknown statuses count as
 *  pending (defensive). */
export function tallyStops(stops: { execution_id: string; status: string }[]): Map<string, StopTally> {
  const m = new Map<string, StopTally>();
  for (const s of stops) {
    const e = m.get(s.execution_id) ?? { total: 0, completed: 0, skipped: 0, pending: 0 };
    e.total++;
    if (s.status === "completed") e.completed++;
    else if (s.status === "skipped") e.skipped++;
    else e.pending++;
    m.set(s.execution_id, e);
  }
  return m;
}
