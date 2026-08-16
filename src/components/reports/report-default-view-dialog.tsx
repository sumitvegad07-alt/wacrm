"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { saveDefaultReportView, clearDefaultReportView } from "@/app/actions/reports";
import { type ReportConfig } from "@/lib/reports/types";

interface ReportDefaultViewDialogProps {
  moduleName: string;
  reportState: ReportConfig;
  /** Name of the currently saved default view, or null if none is saved. */
  savedName: string | null;
  /** Called after a successful save or clear so the parent can refresh its label. */
  onChanged: (name: string | null) => void;
}

/**
 * Saves the report's current arrangement as this user's default view.
 *
 * One per user per module — saving again overwrites it. This replaced the old
 * multi-preset "Save Report" dialog (with private/team/organization sharing),
 * which wrote rows nothing could ever read back.
 */
export function ReportDefaultViewDialog({
  moduleName,
  reportState,
  savedName,
  onChanged,
}: ReportDefaultViewDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDialog = () => {
    setName(savedName ?? "");
    setError(null);
    setSaved(false);
    setOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      setLoading(true);
      setError(null);
      await saveDefaultReportView(moduleName, name.trim(), reportState);
      onChanged(name.trim());
      setSaved(true);
      setTimeout(() => {
        setOpen(false);
        setSaved(false);
      }, 900);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Could not save the default view. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    try {
      setLoading(true);
      setError(null);
      await clearDefaultReportView(moduleName);
      onChanged(null);
      setName("");
      setOpen(false);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Could not remove the default view.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog} title={savedName ?? undefined}>
        {savedName ? (
          <BookmarkCheck className="mr-2 h-4 w-4 text-primary" />
        ) : (
          <Bookmark className="mr-2 h-4 w-4" />
        )}
        {savedName ? "Default View" : "Set Default View"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {savedName ? "Update your default view" : "Set as your default view"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <p className="text-sm text-muted-foreground">
              Saves the report exactly as it is right now — the selected tab, columns,
              filters, period and chart type. This report will open this way for you
              every time.
            </p>

            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="e.g. My monthly sales view"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim() && !loading) handleSave();
                }}
              />
            </div>

            {savedName && (
              <p className="text-xs text-muted-foreground">
                Currently saved as <span className="font-medium text-foreground">{savedName}</span>.
                Saving replaces it.
              </p>
            )}

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md p-2">{error}</p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            {savedName ? (
              <Button variant="ghost" onClick={handleClear} disabled={loading}
                className="text-destructive hover:text-destructive">
                Remove default
              </Button>
            ) : <span />}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={loading || !name.trim()}>
                {loading ? "Saving..." : saved ? "Saved ✓" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
