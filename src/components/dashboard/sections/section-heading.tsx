import type { ComponentType } from "react";

/**
 * Divider + title for one product-line section on the composite dashboard.
 * Every section (CRM / Workforce / Sales) uses this so the stacked layout
 * reads as one page with clear bands rather than three bolted-together dashboards.
 */
export function SectionHeading({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string;
  subtitle: string;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border pb-3">
      {Icon ? (
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <div>
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
