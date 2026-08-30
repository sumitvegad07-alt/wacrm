import { ShieldAlert } from "lucide-react";

/**
 * In-page RBAC guard for the finer Location-Tracking screens (Live Feed, All Locations, Tracking
 * Health, User Attendance). The sidebar already hides the link when the user lacks the right, but
 * a bookmark or a typed URL would still render the page — so each of those pages renders this
 * instead when `hasPermission` is false. Matches the Execution Monitor's guard verbatim so every
 * location screen refuses access the same way. Owner/admin never reach here (hasPermission passes).
 */
export function ScreenAccessDenied({ title, rightLabel }: { title: string; rightLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-8 py-16 text-center">
      <ShieldAlert className="mb-3 h-10 w-10 text-muted-foreground" />
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Ask an admin to grant “{rightLabel}”.
      </p>
    </div>
  );
}
