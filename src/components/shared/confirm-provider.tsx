"use client";

import * as React from "react";
import { ConfirmDialog, type ConfirmDialogProps } from "@/components/shared/confirm-dialog";

/**
 * `await confirm(...)` — the shared confirmation dialog, used like the browser's
 * `confirm()`.
 *
 * ## Why this exists
 *
 * `ConfirmDialog` has been in the codebase all along, and 21 call sites in 18
 * files still called the browser's native `confirm()` anyway. The reason is
 * ergonomic, not ignorance: a controlled dialog needs a piece of state, a
 * mounted component and the action split into "open the dialog" and "do the
 * thing", which is three edits and a restructured handler. `confirm()` is one
 * line, so `confirm()` kept winning.
 *
 * Worse, it was not always convertible. Some of those call sites gate the
 * MIDDLE of a function — order-form's credit-limit and overdue checks sit
 * inside `handleSave` and need the answer before deciding whether to continue.
 * A controlled dialog cannot express that without turning the save path inside
 * out, which is why those two were left alone when the rest of that module was
 * migrated.
 *
 * This makes the shared dialog as cheap to call as the native one:
 *
 *     const confirm = useConfirm();
 *     if (!(await confirm({ title: "Delete this?", variant: "danger" }))) return;
 *
 * ## No-provider fallback
 *
 * `useConfirm` outside a `ConfirmProvider` falls back to `window.confirm`,
 * following the same null-safe convention as `useTableToolbarSlot`. A print
 * route, a test, or a component rendered outside the dashboard shell keeps
 * working exactly as it does today instead of throwing.
 */

export type ConfirmOptions = Pick<
  ConfirmDialogProps,
  "title" | "description" | "confirmLabel" | "cancelLabel" | "variant" | "icon"
>;

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const Ctx = React.createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);

  const confirm = React.useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ options, resolve });
      }),
    []
  );

  // Settle on close as well as on the buttons: dismissing with Escape or a
  // click outside must resolve false, not leave the caller awaiting forever.
  const settle = React.useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) settle(false);
          }}
          title={pending.options.title}
          description={pending.options.description}
          confirmLabel={pending.options.confirmLabel}
          cancelLabel={pending.options.cancelLabel}
          variant={pending.options.variant}
          icon={pending.options.icon}
          onConfirm={() => settle(true)}
        />
      )}
    </Ctx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(Ctx);
  const fallback = React.useCallback<ConfirmFn>(async (options) => {
    if (typeof window === "undefined") return false;
    const text = [options.title, typeof options.description === "string" ? options.description : null]
      .filter(Boolean)
      .join("\n\n");
    return window.confirm(text);
  }, []);
  return ctx ?? fallback;
}
