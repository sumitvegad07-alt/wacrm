import type { ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FormPageShellProps {
  /** Icon shown beside the title (module icon). */
  icon: LucideIcon;
  /** Page title, e.g. "Add New Customer". */
  title: string;
  /** Optional one-line description under the title. */
  subtitle?: string;
  /** Back handler — usually `() => onOpenChange(false)` or `router.back()`. */
  onBack: () => void;
  /**
   * Card width. Defaults to `max-w-4xl` to match the scheme creation master.
   * Pass "none" for wide, table-heavy masters (orders, quotations).
   */
  width?: "default" | "none";
  /**
   * Whether children are wrapped in the single card container. Defaults to true
   * (the scheme-master look). Pass false for forms that render their own
   * multiple cards/sections (e.g. dispatch) — they keep just the shared header.
   */
  card?: boolean;
  /** Optional footer rendered inside the card, separated by a divider. */
  footer?: ReactNode;
  /** Optional right-aligned header content (e.g. a Save button). */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * Shared full-page creation/edit "master" layout. Every module's create/edit
 * screen renders through this so the header (back arrow + icon + title +
 * subtitle) and the single card container are identical — the look set by the
 * scheme creation master. See src/components/schemes/scheme-form.tsx.
 */
export function FormPageShell({
  icon: Icon,
  title,
  subtitle,
  onBack,
  width = "default",
  card = true,
  footer,
  actions,
  children,
}: FormPageShellProps) {
  const header = (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {/* Was a raw <button> with its own border and hover. 312 raw buttons in
            the app sit outside the shared focus-ring system; this is one of the
            most-used of them, so it goes first. */}
        <Button
          type="button"
          variant="outline"
          size="icon"
          data-shortcut="back"
          onClick={onBack}
          aria-label="Go back"
          className="shrink-0"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          {/* Same size as a detail page's title, so moving between a record and
              its edit form does not change the heading. */}
          <h1 className="flex items-center gap-2 text-page-title font-bold text-foreground">
            <Icon className="size-5 shrink-0 text-primary" />
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 text-caption text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );

  return (
    // No padding of its own. The page gutter belongs to the workspace <main>
    // in dashboard-shell, which already applies it — this used to add
    // `p-4 sm:p-5` on top, so every create/edit screen was indented twice
    // (36px a side at lg against the 16px every list page gets). It is the
    // same bug that was fixed for list pages by taking the padding out of
    // PageLayout; this component was missed at the time.
    //
    // Shell-only by design: every caller renders it behind an `asPage` check
    // and uses a Dialog on the other branch, so no instance is inside a
    // dialog that would need its own inset.
    <div className="w-full max-w-none space-y-4">
      {header}
      {card ? (
        <div
          className={cn(
            "bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm",
            width === "default" && "max-w-4xl"
          )}
        >
          {children}
          {footer && (
            <div className="pt-4 mt-4 border-t border-border">{footer}</div>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
