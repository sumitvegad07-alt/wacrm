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
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const on = Boolean(enabled && module && createdAtOf);

  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);

  const candidates = useMemo(() => {
    if (!on || !createdAtOf) return [];
    const shaped: RecordRow[] = rows.map((row) => ({
      id: idOf(row),
      createdAt: createdAtOf(row),
    }));
    return candidateIds(shaped);
    // idOf/createdAtOf are written inline at the call sites, so a new identity
    // every render; `rows` is the real input and the only sound dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, on]);

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
    if (!seen || !createdAtOf) return NO_UNSEEN;
    const shaped: RecordRow[] = rows.map((row) => ({
      id: idOf(row),
      createdAt: createdAtOf(row),
    }));
    return unseenIds(shaped, seen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, seen]);
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
