"use client";

import { useMemo } from "react";
import type { Deal, PipelineStage } from "@/types";
import {
  DollarSign,
  IndianRupee,
  Euro,
  PoundSterling,
  Coins,
  TrendingUp,
  Target,
  BarChart3,
  Trophy,
  XCircle,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";

function getCurrencyIcon(currency?: string) {
  const code = (currency || "USD").toUpperCase();
  if (code === "INR") return <IndianRupee className="h-4 w-4 text-primary" />;
  if (code === "EUR") return <Euro className="h-4 w-4 text-primary" />;
  if (code === "GBP") return <PoundSterling className="h-4 w-4 text-primary" />;
  if (code === "USD") return <DollarSign className="h-4 w-4 text-primary" />;
  return <Coins className="h-4 w-4 text-primary" />;
}

interface PipelineAnalyticsProps {
  stages: PipelineStage[];
  deals: Deal[];
}

/**
 * Weighted pipeline value: value × per-stage probability.
 * First stage ≈ 10%, stages interpolate up to 90% before the final stage,
 * final stage (Won) = 100%. Lost deals excluded.
 */
function computeStageProbability(
  stage: PipelineStage,
  sortedStages: PipelineStage[],
): number {
  const n = sortedStages.length;
  if (n <= 1) return 1;
  const index = sortedStages.findIndex((s) => s.id === stage.id);
  if (index < 0) return 0;
  if (index === n - 1) return 1;
  const slots = n - 1;
  if (slots <= 1) return 0.1;
  const t = index / (slots - 1);
  return 0.1 + t * (0.9 - 0.1);
}

export function PipelineAnalytics({ stages, deals }: PipelineAnalyticsProps) {
  const { defaultCurrency } = useAuth();
  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [stages],
  );

  const stats = useMemo(() => {
    const active = deals.filter((d) => d.status !== "lost");
    const openDeals = active.filter((d) => d.status !== "won");

    const totalCount = active.length;
    const totalValue = active.reduce((sum, d) => sum + Number(d.value || 0), 0);
    const avgValue = totalCount > 0 ? totalValue / totalCount : 0;

    const weightedValue = openDeals.reduce((sum, d) => {
      const stage = sortedStages.find((s) => s.id === d.stage_id);
      const prob = stage ? computeStageProbability(stage, sortedStages) : 0.5;
      return sum + Number(d.value || 0) * prob;
    }, 0);

    const now = new Date();
    const thisMonth = (d: Deal) => {
      if (!d.updated_at) return false;
      const dt = new Date(d.updated_at);
      return (
        dt.getMonth() === now.getMonth() &&
        dt.getFullYear() === now.getFullYear()
      );
    };

    const wonThisMonth = deals.filter(
      (d) => d.status === "won" && thisMonth(d),
    ).length;
    const lostThisMonth = deals.filter(
      (d) => d.status === "lost" && thisMonth(d),
    ).length;

    return {
      totalCount,
      totalValue,
      avgValue,
      weightedValue,
      wonThisMonth,
      lostThisMonth,
    };
  }, [deals, sortedStages]);

  return (
    <TooltipProvider>
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-3 xl:grid-cols-6">
        <Metric
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
          label="Total Deals"
          value={String(stats.totalCount)}
          tooltip="Count of every deal in this pipeline that isn't marked as Lost. Won deals are still included."
        />
        <Metric
          icon={getCurrencyIcon(defaultCurrency)}
          label="Pipeline Value"
          value={formatCurrency(stats.totalValue, defaultCurrency)}
          tooltip="Sum of the values of all deals in this pipeline, excluding deals marked as Lost."
        />
        <Metric
          icon={<Target className="h-4 w-4 text-blue-400" />}
          label="Avg Deal Size"
          value={formatCurrency(stats.avgValue, defaultCurrency)}
          tooltip="Pipeline Value divided by Total Deals — the average value of a single non-lost deal."
        />
        <Metric
          icon={<TrendingUp className="h-4 w-4 text-purple-400" />}
          label="Weighted Value"
          value={formatCurrency(stats.weightedValue, defaultCurrency)}
          tooltip="Expected revenue: each open deal's value × its stage probability. First stage ≈ 10%, stages progress up to 90%, Won = 100%. Lost deals are excluded."
        />
        <Metric
          icon={<Trophy className="h-4 w-4 text-primary" />}
          label="Won This Month"
          value={String(stats.wonThisMonth)}
          tooltip="Deals marked as Won since the first day of the current month."
        />
        <Metric
          icon={<XCircle className="h-4 w-4 text-red-400" />}
          label="Lost This Month"
          value={String(stats.lostThisMonth)}
          tooltip="Deals marked as Lost since the first day of the current month."
        />
      </div>
    </TooltipProvider>
  );
}

function Metric({
  icon,
  label,
  value,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tooltip: string;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`How ${label} is calculated`}
                className="ml-auto text-muted-foreground hover:text-foreground focus:outline-none"
              />
            }
          >
            <Info className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}
