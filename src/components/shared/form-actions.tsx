import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FormActionsProps {
  /** Cancel / back handler. */
  onCancel: () => void;
  /**
   * Save handler. Omit when the Save button should submit the surrounding
   * <form> instead (pass `submit`).
   */
  onSave?: () => void;
  /** Render the Save button as type="submit" (for forms with onSubmit). */
  submit?: boolean;
  /** Busy state — disables both buttons and spins the Save button. */
  saving?: boolean;
  /** Extra disable condition for Save (combined with `saving`). */
  saveDisabled?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  /** Optional left-aligned slot, e.g. a Delete affordance on edit screens. */
  leftSlot?: ReactNode;
  /** Drop the top border/padding when the parent already provides a divider. */
  bare?: boolean;
  className?: string;
}

/**
 * The one Save/Cancel action bar for every create/edit form. Right-aligned,
 * default-size buttons — identical placement, sizing and labels across modules
 * so a product form and a deal form no longer disagree on button size. Pair with
 * FormPageShell (pass as its `footer`) or drop at the end of a form.
 */
export function FormActions({
  onCancel,
  onSave,
  submit,
  saving,
  saveDisabled,
  saveLabel = "Save",
  cancelLabel = "Cancel",
  leftSlot,
  bare,
  className,
}: FormActionsProps) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-3 sm:flex-row sm:items-center",
        leftSlot ? "sm:justify-between" : "sm:justify-end",
        !bare && "border-t border-border pt-4 mt-4",
        className,
      )}
    >
      {leftSlot ? <div className="flex items-center">{leftSlot}</div> : null}
      <div className="flex items-center justify-end gap-2 shrink-0">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {cancelLabel}
        </Button>
        <Button
          type={submit ? "submit" : "button"}
          onClick={submit ? undefined : onSave}
          data-shortcut="save"
          disabled={saving || saveDisabled}
          className="min-w-[130px]"
        >
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {saving ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
