"use client";

import { Pencil, Trash2, RotateCcw } from "lucide-react";

interface RowActionsProps {
  /** Edit handler — renders the pencil icon when provided. */
  onEdit?: () => void;
  /**
   * Destructive / deactivate handler — renders the trash icon when provided
   * and the row is active. For master data this is a soft-delete (mark
   * Inactive); for the few tables that still hard-delete it's a real delete.
   */
  onDelete?: () => void;
  /** Shown (as a restore icon) instead of the trash icon when `isInactive`. */
  onReactivate?: () => void;
  /** When true the row is soft-deleted: swap trash → restore. */
  isInactive?: boolean;
  editTitle?: string;
  deleteTitle?: string;
  reactivateTitle?: string;
  /** Hides the whole cell's actions (e.g. no permission). */
  disabled?: boolean;
}

/**
 * Inline row actions rendered in the pinned "Action" column (2nd column, right
 * after the selection checkbox). Compact icon buttons — edit + delete/restore —
 * matching the shared table UI across every module.
 */
export function RowActions({
  onEdit,
  onDelete,
  onReactivate,
  isInactive = false,
  editTitle = "Edit",
  deleteTitle = "Delete",
  reactivateTitle = "Re-activate",
  disabled = false,
}: RowActionsProps) {
  if (disabled) return <span className="text-muted-foreground">—</span>;

  const stop = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  return (
    <div className="flex items-center gap-1">
      {onEdit && (
        <button
          type="button"
          title={editTitle}
          aria-label={editTitle}
          onClick={stop(onEdit)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
      {isInactive && onReactivate ? (
        <button
          type="button"
          title={reactivateTitle}
          aria-label={reactivateTitle}
          onClick={stop(onReactivate)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-emerald-600 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950/40 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <RotateCcw className="size-3.5" />
        </button>
      ) : (
        onDelete && (
          <button
            type="button"
            title={deleteTitle}
            aria-label={deleteTitle}
            onClick={stop(onDelete)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 focus:outline-none focus:ring-1 focus:ring-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        )
      )}
    </div>
  );
}
