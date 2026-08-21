import type { ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
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
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="inline-flex items-center justify-center rounded-md h-9 w-9 border border-border hover:bg-accent shrink-0"
        >
          <ArrowLeft className="h-4 w-4 text-foreground" />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Icon className="w-6 h-6 text-primary shrink-0" />
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );

  return (
    <div className="p-8 w-full max-w-none space-y-8">
      {header}
      {card ? (
        <div
          className={cn(
            "bg-card border border-border rounded-xl p-6 shadow-sm",
            width === "default" && "max-w-4xl"
          )}
        >
          {children}
          {footer && (
            <div className="pt-6 mt-6 border-t border-border">{footer}</div>
          )}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
