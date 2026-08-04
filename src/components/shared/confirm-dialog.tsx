"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangleIcon, Trash2Icon, CheckCircle2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ConfirmDialogProps {
  /**
   * Controlled open state.
   */
  open: boolean;
  /**
   * Callback fired when open state changes.
   */
  onOpenChange: (open: boolean) => void;
  /**
   * Dialog title (e.g. "Delete Contact").
   */
  title: string;
  /**
   * Descriptive confirmation message explaining the impact of the action.
   */
  description: React.ReactNode;
  /**
   * Label for the confirmation button. Defaults to "Confirm".
   */
  confirmLabel?: string;
  /**
   * Label for the cancel button. Defaults to "Cancel".
   */
  cancelLabel?: string;
  /**
   * Severity variant of the dialog:
   * - "danger": red destructive icon and button (e.g. permanent deletion)
   * - "warning": amber warning icon and button (e.g. archive, pause)
   * - "default": primary icon and button (e.g. approve, confirm action)
   */
  variant?: "danger" | "warning" | "default";
  /**
   * Action handler called when the confirm button is clicked.
   */
  onConfirm: () => void | Promise<void>;
  /**
   * Optional loading state disables buttons and displays a spinner during async operations.
   */
  loading?: boolean;
  /**
   * Custom icon to display in the header. Overrides default variant icon.
   */
  icon?: React.ReactNode;
}

/**
 * Enterprise ConfirmDialog component.
 * Strictly enforces `sm:max-w-sm` (400px) width, standard icon badges,
 * right-aligned footer button ordering, and keyboard accessibility.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  loading = false,
  icon,
}: ConfirmDialogProps) {
  const iconMap = {
    danger: (
      <div className="flex items-center justify-center size-10 rounded-full bg-destructive/10 text-destructive shrink-0">
        <Trash2Icon className="size-5" />
      </div>
    ),
    warning: (
      <div className="flex items-center justify-center size-10 rounded-full bg-amber-500/10 text-amber-500 shrink-0">
        <AlertTriangleIcon className="size-5" />
      </div>
    ),
    default: (
      <div className="flex items-center justify-center size-10 rounded-full bg-primary/10 text-primary shrink-0">
        <CheckCircle2Icon className="size-5" />
      </div>
    ),
  };

  const buttonVariantMap = {
    danger: "destructive" as const,
    warning: "default" as const,
    default: "default" as const,
  };

  return (
    <Dialog open={open} onOpenChange={loading ? undefined : onOpenChange}>
      <DialogContent
        className="sm:max-w-sm p-6"
        showCloseButton={!loading}
      >
        <DialogHeader className="flex flex-row items-start gap-4">
          {icon || iconMap[variant]}
          <div className="flex flex-col gap-1 min-w-0">
            <DialogTitle className="text-base font-semibold text-foreground">
              {title}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              {description}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={buttonVariantMap[variant]}
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              variant === "warning" && "bg-amber-600 hover:bg-amber-700 text-white"
            )}
          >
            {loading ? "Processing..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
