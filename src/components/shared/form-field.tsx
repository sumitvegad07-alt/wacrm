"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { FORM_FIELD_SPANS, type FormFieldSpan } from "@/components/shared/form-grid";

export interface FormFieldProps {
  /** Field label. Always rendered above the control. */
  label: React.ReactNode;
  /** Marks the field required — renders the one shared asterisk treatment. */
  required?: boolean;
  /**
   * Helper text under the control. Hidden while `error` is set, so the two
   * never stack and shift the row.
   */
  hint?: React.ReactNode;
  /** Validation message. Replaces `hint` and puts the control in its invalid state. */
  error?: React.ReactNode;
  /** Columns the field spans in a `FormGrid`. Defaults to 1. */
  span?: FormFieldSpan;
  /** Optional right-aligned control beside the label (e.g. a "Manage" link). */
  action?: React.ReactNode;
  /**
   * Id for the control, if you need to own it (a composite control that does
   * not forward `id`, or a native group). Otherwise one is generated and
   * wired to the label for you.
   */
  htmlFor?: string;
  className?: string;
  /**
   * Extra classes for the label only. Needed where the label text is data
   * rather than copy — the custom-fields renderer passes `capitalize` because
   * field names come from the tenant's own configuration. Do not use it to
   * change the label's size or weight.
   *
   * It has to be a prop: putting `capitalize` on the wrapper would inherit
   * into the control and capitalise what the user has typed.
   */
  labelClassName?: string;
  children: React.ReactNode;
}

/**
 * The one label + control + message unit for every form in the app.
 *
 * Before this, that markup was hand-written **370 times across 80 files**. The
 * required asterisk alone existed in three different spellings
 * (`text-destructive">*`, `text-red-500">*`, and a bare `*`), helper text and
 * validation messages used `text-red-400/500/600/700` about as often as the
 * `text-destructive` token, and label-to-control spacing was whichever of
 * `space-y-1`, `space-y-1.5` or `space-y-2` the file happened to use. None of
 * that was a decision anyone made; it was 80 files each re-deciding.
 *
 * What it does for you:
 * - one label size (`text-label`), one weight, one gap to the control;
 * - one required marker;
 * - one error colour and position, and `aria-invalid` on the control so it
 *   also picks up the shared invalid ring from `ui/control-base`;
 * - `aria-describedby` wiring, so a screen reader reads the hint or the error
 *   with the field instead of leaving it orphaned;
 * - a generated id on the control and `htmlFor` on the label, so clicking the
 *   label focuses the field;
 * - full-width controls, matched by `data-slot` rather than by a className the
 *   caller has to remember. This is also how a `SelectTrigger` gets `w-full`
 *   inside a form without changing its `w-fit` default, which 52 toolbar and
 *   filter selects elsewhere in the app rely on.
 *
 * The id, `aria-describedby` and `aria-invalid` are injected by cloning the
 * child when it is a single element. All three are valid DOM attributes, so a
 * control that forwards its props gets them and one that does not simply
 * ignores them — the worst case is the behaviour we already had. Pass
 * `htmlFor` for a control you know swallows `id` (a `<Select>` root, a radio
 * group) and set the id on the real control yourself.
 */
export function FormField({
  label,
  required,
  hint,
  error,
  span = 1,
  action,
  htmlFor,
  className,
  labelClassName,
  children,
}: FormFieldProps) {
  const generatedId = React.useId();
  const controlId = htmlFor ?? generatedId;
  const messageId = `${controlId}-message`;
  const hasMessage = Boolean(error ?? hint);

  // Only clone a single element, and never overwrite an id the caller set.
  const control = React.useMemo(() => {
    if (htmlFor || !React.isValidElement(children)) return children;
    const existing = children.props as Record<string, unknown>;
    return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      id: existing.id ?? controlId,
      "aria-describedby": existing["aria-describedby"] ?? (hasMessage ? messageId : undefined),
      "aria-invalid": existing["aria-invalid"] ?? (error ? true : undefined),
    });
  }, [children, htmlFor, controlId, messageId, hasMessage, error]);

  return (
    <div
      data-slot="form-field"
      className={cn("flex min-w-0 flex-col gap-1.5", FORM_FIELD_SPANS[span], className)}
    >
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={controlId}
          className={cn("text-label leading-tight text-muted-foreground", labelClassName)}
        >
          <span className="truncate">{label}</span>
          {required && (
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
          )}
          {required && <span className="sr-only">(required)</span>}
        </Label>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {/* Width is applied here by data-slot rather than by the caller, so a
          control cannot end up short in a full-width grid cell because someone
          forgot `w-full`. */}
      <div
        className={cn(
          "min-w-0",
          "[&>[data-slot=input]]:w-full [&>[data-slot=textarea]]:w-full [&>[data-slot=select-trigger]]:w-full",
          "[&_[data-slot=select-trigger]]:w-full"
        )}
      >
        {control}
      </div>

      {hasMessage && (
        <p
          id={messageId}
          className={cn(
            "text-micro",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
