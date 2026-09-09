import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FormSectionProps {
  /** Section heading, e.g. "Primary Details", "Products". */
  title: string;
  /** Optional right-aligned header content (e.g. an "Add product" button). */
  action?: ReactNode;
  /** Optional one-line helper under the title. */
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

/**
 * The one section header for every create/edit form. A thin, underlined title
 * with the section body below — identical weight, size and spacing across
 * modules so deal / quotation / order stop each inventing their own (big card
 * headers vs. bold text vs. thin labels).
 */
export function FormSection({ title, action, subtitle, children, className }: FormSectionProps) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-end justify-between gap-3 border-b border-border pb-1.5">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}
