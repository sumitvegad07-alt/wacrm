"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getImportDescriptor } from "@/lib/import/registry";

interface ImportJobRow {
  id: string;
  user_id: string;
  module: string;
  status: string;
  imported_rows: number;
  updated_rows: number;
  skipped_rows: number;
  failed_rows: number;
}

/**
 * Completion notifications for background imports. Subscribes to import_jobs via
 * Realtime (scoped to the account) and toasts once when one of the current
 * user's jobs reaches a terminal state. Mount once, high in the dashboard tree.
 *
 * Realtime fires on every UPDATE (status→importing, count accumulation, then
 * →completed), so we dedupe per job id to toast exactly once on completion.
 */
export function useImportNotifications() {
  const { accountId, user } = useAuth();
  const toasted = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!accountId || !user) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`import-jobs-${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "import_jobs",
          filter: `account_id=eq.${accountId}`,
        },
        (payload) => {
          const row = payload.new as ImportJobRow;
          if (row.user_id !== user.id) return;
          if (row.status !== "completed" && row.status !== "failed") return;
          if (toasted.current.has(row.id)) return;
          toasted.current.add(row.id);

          const label = getImportDescriptor(row.module)?.label ?? "records";
          if (row.status === "failed") {
            toast.error(`Import failed — ${label}. Open Import history for details.`);
            return;
          }
          const parts: string[] = [];
          if (row.imported_rows) parts.push(`${row.imported_rows} added`);
          if (row.updated_rows) parts.push(`${row.updated_rows} updated`);
          if (row.skipped_rows) parts.push(`${row.skipped_rows} skipped`);
          if (row.failed_rows) parts.push(`${row.failed_rows} failed`);
          toast.success(`${label} import finished${parts.length ? ` — ${parts.join(", ")}` : ""}.`);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [accountId, user]);
}
