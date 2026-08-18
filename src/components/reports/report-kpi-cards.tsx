"use client";

import { useEffect, useState } from "react";
import { type ReportDefinition } from "@/lib/reports/types";
import { executeReport } from "@/app/actions/reports";
import { formatCurrencyShort } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface ReportKpiCardsProps {
  config: ReportDefinition;
  /** Registry module to total against — the ACTIVE TAB's, which is not always the
   *  report's own (see TabConfig.moduleOverride). */
  moduleName: string;
  /** Measure keys to card, resolved for the active tab. */
  kpis: string[];
  filters: Record<string, any>;
  defaultCurrency: string;
}

export function ReportKpiCards({ config, moduleName, kpis, filters, defaultCurrency }: ReportKpiCardsProps) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true); // start as loading to avoid ₹0 flash

  useEffect(() => {
    async function fetchKpis() {
      if (!kpis || kpis.length === 0) return;
      
      try {
        setLoading(true);
        // Call executeReport with NO dimensions to get the grand total of all measures
        // No limit/offset because it's a single aggregation row
        const result = await executeReport(
          moduleName,
          [], // Empty dimensions = Grand Total
          kpis, // Only fetch configured KPIs
          filters
        );
        
        if (result && result.length > 0) {
          setData(result[0]);
        } else {
          setData(null);
        }
      } catch (e) {
        console.error("Failed to fetch KPIs", e);
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    
    fetchKpis();
  }, [moduleName, kpis, filters]);

  if (!kpis || kpis.length === 0) return null;

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
      {kpis.map((kpiKey) => {
        const measureDef = config.measures.find((m) => m.key === kpiKey);
        if (!measureDef) return null;
        
        const rawValue = data ? Number(data[kpiKey] || 0) : 0;
        
        let displayValue: string;
        if (loading) {
          displayValue = "...";
        } else if (!data) {
          displayValue = "—";
        } else if (measureDef.type === 'currency') {
          displayValue = formatCurrencyShort(rawValue, defaultCurrency);
        } else if (measureDef.type === 'percent') {
          displayValue = `${rawValue.toFixed(2)}%`;
        } else {
          displayValue = rawValue.toLocaleString();
        }

        return (
          <Card key={kpiKey} className="relative overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {measureDef.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-8 w-24 rounded-md bg-muted animate-pulse" />
              ) : (
                <div className="text-2xl font-bold tracking-tight">{displayValue}</div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
