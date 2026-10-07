"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Save,
  Star,
  StarOff,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared";
import type { TableViewApi } from "@/hooks/use-table-view";

/**
 * The Views control in the table's top toolbar.
 *
 * Every item here does something. The previous attempt at saved views, on
 * Reports, shipped a UI that could not list or load what it saved and was torn
 * out for it, so: pick a view, save the current one, rename it, make it the
 * default, update it after a change, delete it. Nothing decorative.
 */
export function TableViewsBar({ view }: { view: TableViewApi }) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const { activeView, views, isDirty, activeFilterCount, hasFilters } = view;
  const label = activeView ? activeView.name : "All records";

  const openSaveDialog = () => {
    setSaveName("");
    setSaveOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = await view.saveAsView(saveName);
    setSaving(false);
    if (ok) setSaveOpen(false);
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    setSaving(true);
    const ok = await view.renameView(renameTarget.id, renameName);
    setSaving(false);
    if (ok) setRenameTarget(null);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    await view.deleteView(deleteTarget.id);
    setSaving(false);
    setDeleteTarget(null);
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Table views"
            title="Saved views for this table"
            className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus:outline-none"
          >
            <Table2 className="size-3.5 text-muted-foreground" />
            <span className="max-w-[180px] truncate">{label}</span>
            {isDirty && (
              <span className="text-[10px] font-medium text-primary" title="Changed since you opened this view">
                • Modified
              </span>
            )}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" className="w-64 text-xs">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Views
            </DropdownMenuLabel>

            <DropdownMenuItem
              onClick={() => view.applyView(null)}
              className="cursor-pointer gap-2"
            >
              <span className="w-3.5">{!activeView && <Check className="size-3.5" />}</span>
              All records
            </DropdownMenuItem>

            {views.map((v) => (
              <DropdownMenuItem
                key={v.id}
                onClick={() => view.applyView(v.id)}
                className="cursor-pointer gap-2"
              >
                <span className="w-3.5">
                  {activeView?.id === v.id && <Check className="size-3.5" />}
                </span>
                <span className="flex-1 truncate">{v.name}</span>
                {v.is_default && (
                  <span className="shrink-0" title="Opens by default">
                    <Star className="size-3 fill-primary text-primary" />
                  </span>
                )}
              </DropdownMenuItem>
            ))}

            {views.length === 0 && !view.viewsLoading && (
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground">
                {view.viewsUnavailable
                  ? "Saved views are unavailable right now."
                  : "No saved views yet."}
              </div>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={openSaveDialog}
              className="cursor-pointer gap-2"
              disabled={view.viewsUnavailable}
            >
              <Plus className="size-3.5" />
              Save as new view…
            </DropdownMenuItem>

            {activeView && (
              <>
                <DropdownMenuItem
                  onClick={() => void view.updateActiveView()}
                  className="cursor-pointer gap-2"
                  disabled={!isDirty}
                >
                  <Save className="size-3.5" />
                  {isDirty ? `Update "${activeView.name}"` : "No changes to save"}
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => {
                    setRenameTarget({ id: activeView.id, name: activeView.name });
                    setRenameName(activeView.name);
                  }}
                  className="cursor-pointer gap-2"
                >
                  <Pencil className="size-3.5" />
                  Rename
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() =>
                    void view.setDefaultView(activeView.is_default ? null : activeView.id)
                  }
                  className="cursor-pointer gap-2"
                >
                  {activeView.is_default ? (
                    <>
                      <StarOff className="size-3.5" />
                      Remove as default
                    </>
                  ) : (
                    <>
                      <Star className="size-3.5" />
                      Set as default
                    </>
                  )}
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => setDeleteTarget({ id: activeView.id, name: activeView.name })}
                  className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                  Delete view
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {hasFilters && (
          <button
            type="button"
            onClick={() => view.resetFilters()}
            title="Clear all filters on this table"
            className="flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            {activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"} active
            <X className="size-3" />
          </button>
        )}
      </div>

      {/* Save as new view */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>
              Saves the filters you have applied, the columns you have chosen and their order,
              and the rows per page. You can open it again any time, from any device.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">View name</label>
            <Input
              autoFocus
              value={saveName}
              placeholder="e.g. My Hot Leads"
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && saveName.trim() && !saving) void handleSave();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !saveName.trim()}>
              {saving ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename view</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameName.trim() && !saving) void handleRename();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleRename()} disabled={saving || !renameName.trim()}>
              {saving ? "Saving…" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete view"
        description={
          <>
            Delete the view{" "}
            <span className="font-medium text-foreground">{deleteTarget?.name}</span>? The records
            themselves are not touched — only this saved arrangement.
          </>
        }
        variant="danger"
        confirmLabel="Delete view"
        loading={saving}
        onConfirm={handleDelete}
      />
    </>
  );
}
