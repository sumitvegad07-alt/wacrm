"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  candidateIds,
  unseenIds,
  NO_UNSEEN,
  type RecordModule,
  type RecordRow,
} from "@/lib/record-views/unseen";

export { NO_UNSEEN, type RecordModule } from "@/lib/record-views/unseen";

/**
 * PostgREST's "no such table" code.
 *
 * This whole feature degrades to "highlight nothing" until migration
 * 20261031130000 has been run on the database, which is deliberate — the code
 * can ship and deploy before the founder runs the SQL, and the lists behave
 * exactly as they did before. What is NOT acceptable in that window is an error
 * logged on every list render and every record opened, so this one code is
 * expected and stays quiet. Any other error still gets reported.
 */
const TABLE_MISSING = "PGRST205";

/** Postgres' unique-violation code: two tabs raced to draw the same starting line. */
const DUPLICATE_KEY = "23505";

/**
 * The rows on this page the viewer has not opened yet, for a list to highlight.
 *
 * One extra query per page of rows, asking only about the rows on screen that
 * are young enough to be highlighted at all — so a page of older records costs
 * nothing, and the query is answered straight off `record_views`' primary key.
 *
 * It fails closed. If the lookup errors, or the viewer is not resolved yet,
 * nothing is highlighted: a list that quietly marks every row as unread is
 * worse than one that marks none, because the first teaches the user to ignore
 * the highlight.
 */
export function useUnseenRecords<T>({
  module,
  rows,
  idOf,
  createdAtOf,
  enabled = true,
}: {
  /** The list's module, or null/undefined on a list that does not highlight. */
  module: RecordModule | null | undefined;
  rows: readonly T[];
  idOf: (row: T) => string;
  createdAtOf: ((row: T) => string | null | undefined) | undefined;
  enabled?: boolean;
}): ReadonlySet<string> {
  const { user, accountId } = useAuth();
  const userId = user?.id ?? null;
  const on = Boolean(enabled && module && createdAtOf);

  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  const baselineAt = useViewBaseline(on ? module : null, accountId, userId);

  const candidates = useMemo(() => {
    if (!on || !createdAtOf) return [];
    const shaped: RecordRow[] = rows.map((row) => ({
      id: idOf(row),
      createdAt: createdAtOf(row),
    }));
    return candidateIds(shaped, { baselineAt });
    // idOf/createdAtOf are written inline at the call sites, so a new identity
    // every render; `rows` is the real input and the only sound dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, on, baselineAt]);

  // A stable dependency: the same page of rows must not re-query on every
  // render, and a changed page must.
  const candidateKey = useMemo(() => [...candidates].sort().join(","), [candidates]);

  useEffect(() => {
    if (!on || !module || !userId || candidates.length === 0) {
      setSeen(null);
      return;
    }

    let alive = true;
    void (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("record_views")
        .select("record_id")
        .eq("module_name", module)
        .in("record_id", candidates);

      if (!alive) return;
      // Fail closed: no set means "highlight nothing", not "highlight all".
      if (error) {
        setSeen(null);
        return;
      }
      setSeen(new Set((data ?? []).map((r) => String(r.record_id))));
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, userId, module, candidateKey]);

  return useMemo(() => {
    if (!seen || !createdAtOf || !baselineAt) return NO_UNSEEN;
    const shaped: RecordRow[] = rows.map((row) => ({
      id: idOf(row),
      createdAt: createdAtOf(row),
    }));
    return unseenIds(shaped, seen, { baselineAt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, seen, baselineAt]);
}

/**
 * When this viewer first opened this list, creating the mark if this is that
 * first time.
 *
 * Returns null until it is known, and `candidateIds` highlights nothing while
 * it is null — which is the behaviour that matters here. Without a starting
 * line, every record inside the thirty-day window that had never been opened
 * qualified as new, so a 201-row Leads list highlighted all 201 rows. A list
 * where everything is highlighted looks exactly like a list where nothing is.
 *
 * Written once and never moved. Moving it forward on each visit would be the
 * per-screen high-water mark that was considered and rejected: one glance at a
 * list would clear every row in it, including the ones that glance never read.
 */
function useViewBaseline(
  module: RecordModule | null | undefined,
  accountId: string | null | undefined,
  userId: string | null,
): string | null {
  const [baselineAt, setBaselineAt] = useState<string | null>(null);

  useEffect(() => {
    if (!module || !userId || !accountId) {
      setBaselineAt(null);
      return;
    }

    let alive = true;
    void (async () => {
      const supabase = createClient();

      const { data, error } = await supabase
        .from("record_view_baselines")
        .select("baseline_at")
        .eq("module_name", module)
        .maybeSingle();

      if (!alive) return;
      if (error) {
        // Including "table not found" before the migration is run: no baseline,
        // so nothing is highlighted and the lists look exactly as they did.
        setBaselineAt(null);
        return;
      }

      if (data?.baseline_at) {
        setBaselineAt(String(data.baseline_at));
        return;
      }

      // First time this user has opened this list. Everything already on it was
      // there before they started, so the line is drawn now.
      const now = new Date().toISOString();
      const { error: insertError } = await supabase
        .from("record_view_baselines")
        .insert({
          user_id: userId,
          account_id: accountId,
          module_name: module,
          baseline_at: now,
        });

      if (!alive) return;
      // A duplicate here means another tab won the race and wrote the same
      // thing a moment earlier, which is fine — either way the line exists.
      setBaselineAt(insertError && insertError.code !== DUPLICATE_KEY ? null : now);
    })();

    return () => {
      alive = false;
    };
  }, [module, userId, accountId]);

  return baselineAt;
}

/**
 * Record that this viewer has now opened this record, so its list row stops
 * being highlighted.
 *
 * Called from a detail page, which is what "clicking on it" means. Fire and
 * forget on purpose: this is a reading mark, and a detail page must not show an
 * error, block, or re-render because one failed to save. The worst case is the
 * row stays bold and gets marked next time.
 *
 * Guarded against React's development double-mount and against a re-render
 * writing again, so opening one record is one upsert.
 */
export function useMarkRecordSeen(
  module: RecordModule,
  recordId: string | null | undefined,
): void {
  const { user, accountId } = useAuth();
  const marked = useRef<string | null>(null);

  useEffect(() => {
    if (!recordId || !user?.id || !accountId) return;

    const key = `${module}:${recordId}`;
    if (marked.current === key) return;
    marked.current = key;

    void createClient()
      .from("record_views")
      .upsert(
        {
          user_id: user.id,
          account_id: accountId,
          module_name: module,
          record_id: recordId,
          viewed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,module_name,record_id" },
      )
      .then(({ error }) => {
        if (error && error.code !== TABLE_MISSING) {
          // Not surfaced to the user: nothing they could do, and the record
          // they asked for is on screen regardless.
          console.error("[record-views] could not mark as seen:", error.message);
        }
      });
  }, [module, recordId, user?.id, accountId]);
}

/**
 * The same mark, as a callback, for a list that opens a record in a dialog
 * instead of navigating to a detail page.
 */
export function useMarkRecordSeenCallback(
  module: RecordModule,
): (recordId: string) => void {
  const { user, accountId } = useAuth();

  return useCallback(
    (recordId: string) => {
      if (!recordId || !user?.id || !accountId) return;

      void createClient()
        .from("record_views")
        .upsert(
          {
            user_id: user.id,
            account_id: accountId,
            module_name: module,
            record_id: recordId,
            viewed_at: new Date().toISOString(),
          },
          { onConflict: "user_id,module_name,record_id" },
        );
    },
    [module, user?.id, accountId],
  );
}
