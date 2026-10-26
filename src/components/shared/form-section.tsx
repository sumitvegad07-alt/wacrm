import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SECTION_HEADER_CLASS } from "@/components/shared/form-grid";

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
      {/* The border lives on this row, not on the h3, so the row can also hold
          an action. SECTION_HEADER_CLASS carries the same border for a section
          header built without this component — hence `border-0` here. */}
      <div className={cn(SECTION_HEADER_CLASS, "flex items-end justify-between gap-3 border-0 border-b font-normal")}>
        <div>
          <h3 className="text-section font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-caption text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}
