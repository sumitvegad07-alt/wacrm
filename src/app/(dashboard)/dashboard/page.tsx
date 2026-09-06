"use client";

import { useAuth } from "@/hooks/use-auth";
import { CrmSection } from "@/components/dashboard/sections/crm-section";
import { WorkforceSection } from "@/components/dashboard/sections/workforce-section";
import { SalesSection } from "@/components/dashboard/sections/sales-section";
import { SkeletonCard } from "@/components/dashboard/skeleton";

/**
 * The home dashboard — a single page that composes itself from the account's
 * plan. Each product line contributes one section, so a CRM-only tenant sees
 * only CRM, a WFA tenant sees Workforce, and an SFA tenant sees Workforce +
 * Sales. Sections are rendered conditionally, so a section's queries never run
 * for a plan that doesn't include its line.
 */
export default function DashboardPage() {
  const { profile, profileLoading, hasCRM, hasWFA, hasSFA } = useAuth();

  const firstName = (profile?.full_name || "").trim().split(" ")[0] || "there";

  // Wait for the profile (and with it the plan) before deciding which sections
  // to show — otherwise we'd flash the wrong composition on a cold load.
  if (profileLoading) {
    return (
      <div className="space-y-6 pb-12">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Welcome back, {firstName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here&apos;s what&apos;s happening across your business today.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasCRM && <LineBadge label="CRM" />}
          {hasWFA && <LineBadge label="Workforce" />}
          {hasSFA && <LineBadge label="Sales" />}
        </div>
      </header>

      {hasCRM && <CrmSection />}
      {hasWFA && <WorkforceSection />}
      {hasSFA && <SalesSection />}

      {!hasCRM && !hasWFA && !hasSFA && (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <h2 className="text-lg font-semibold text-foreground">Your dashboard is warming up</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            No modules are active on your plan yet. Contact your administrator to enable your
            product features.
          </p>
        </div>
      )}
    </div>
  );
}

function LineBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      {label}
    </span>
  );
}
