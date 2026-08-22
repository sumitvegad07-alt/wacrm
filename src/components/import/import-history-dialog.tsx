"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Undo2, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";
import type { ImportJob } from "@/lib/import/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  module: string;
  onChanged?: () => void;
}

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
  undone: "bg-muted text-muted-foreground",
  importing: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export function ImportHistoryDialog({ open, onOpenChange, module, onChanged }: Props) {
  const supabase = createClient();
  const { accountId, hasPermission } = useAuth();
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const canManage = hasPermission(PERMISSIONS.IMPORT.MANAGE);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from("import_jobs")
      .select("*")
      .eq("account_id", accountId)
      .eq("module", module)
      .order("created_at", { ascending: false })
      .limit(25);
    setJobs((data as ImportJob[]) ?? []);
    setLoading(false);
  }, [accountId, module, supabase]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function undo(jobId: string) {
    setUndoingId(jobId);
    try {
      const { data, error } = await supabase.rpc("import_undo", { p_job_id: jobId });
      if (error) throw error;
      const removed = (data as { removed?: number })?.removed ?? 0;
      toast.success(`Import undone — ${removed} record${removed === 1 ? "" : "s"} removed.`);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not undo the import.");
    } finally {
      setUndoingId(null);
    }
  }

  function canUndo(job: ImportJob): boolean {
    return (
      canManage &&
      job.undoable &&
      job.status === "completed" &&
      !!job.undo_deadline &&
      new Date(job.undo_deadline).getTime() > Date.now()
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import history</DialogTitle>
          <DialogDescription>Recent imports for this module. Undo is available for 30 minutes after an import, until another import runs.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></div>
        ) : jobs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            No imports yet.
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{job.file_name}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[job.status] ?? "bg-muted text-muted-foreground"}`}>
                      {job.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(job.created_at).toLocaleString()} ·{" "}
                    {job.imported_rows} added
                    {job.updated_rows ? `, ${job.updated_rows} updated` : ""}
                    {job.skipped_rows ? `, ${job.skipped_rows} skipped` : ""}
                    {job.failed_rows ? `, ${job.failed_rows} failed` : ""}
                  </p>
                </div>
                {canUndo(job) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-amber-600 dark:text-amber-400"
                    onClick={() => undo(job.id)}
                    disabled={undoingId === job.id}
                  >
                    {undoingId === job.id ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Undo2 className="mr-1 size-3.5" />}
                    Undo
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
