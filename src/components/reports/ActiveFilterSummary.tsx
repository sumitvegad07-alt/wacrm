"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { type ReportFilterDef } from "@/lib/reports/types";
import { PERIOD_PRESETS } from "./report-filter-drawer";

interface ActiveFilterSummaryProps {
  config: { filters: ReportFilterDef[] };
  filters: Record<string, any>;
  period: string;
  onRemoveFilter: (key: string) => void;
  onClearAll: () => void;
}

export function ActiveFilterSummary({ config, filters, period, onRemoveFilter, onClearAll }: ActiveFilterSummaryProps) {
  const supabase = createClient();
  
  // Local state to store resolved labels for ID-based filters
  const [resolvedLabels, setResolvedLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    async function resolveLabels() {
      const newLabels = { ...resolvedLabels };
      let changed = false;
      
      for (const [key, value] of Object.entries(filters)) {
        if (key === 'date_range') continue;
        const filterDef = config.filters.find(f => f.key === key);
        if (!filterDef || !value) continue;

        // Skip resolving if it's already a string name or a simple select
        if (filterDef.type === 'select') {
          const opt = filterDef.options?.find(o => o.value === value);
          if (opt && newLabels[key] !== opt.label) {
            newLabels[key] = opt.label;
            changed = true;
          }
          continue;
        }

        if (filterDef.type === 'territory' && typeof value === 'string') {
          if (!newLabels[key]) {
            const { data } = await supabase.from('territories').select('name').eq('id', value).single();
            if (data?.name) {
              newLabels[key] = data.name;
              changed = true;
            }
          }
          continue;
        }

        // For customer, value is { contact_id: 'uuid' }
        if (filterDef.type === 'customer' && value.contact_id) {
          if (!newLabels[key]) {
            const { data } = await supabase.from('contacts').select('name').eq('id', value.contact_id).single();
            if (data?.name) {
              newLabels[key] = data.name;
              changed = true;
            }
          }
          continue;
        }

        // For user, value is uuid
        if (filterDef.type === 'user' && typeof value === 'string') {
          if (!newLabels[key]) {
            const { data } = await supabase.from('profiles').select('full_name').eq('user_id', value).single();
            if (data?.full_name) {
              newLabels[key] = data.full_name;
              changed = true;
            }
          }
          continue;
        }

        // For product, value is uuid
        if (filterDef.type === 'product' && typeof value === 'string') {
          if (!newLabels[key]) {
            const { data } = await supabase.from('products').select('name').eq('id', value).single();
            if (data?.name) {
              newLabels[key] = data.name;
              changed = true;
            }
          }
          continue;
        }
      }
      
      if (changed) setResolvedLabels(newLabels);
    }
    
    resolveLabels();
  }, [filters, config.filters, supabase]);

  const activeKeys = Object.keys(filters).filter(k => k !== 'date_range');
  const hasFilters = activeKeys.length > 0 || period !== 'this_month';

  if (!hasFilters) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 p-3 bg-muted/30 rounded-lg border border-border">
      <span className="text-xs font-semibold text-muted-foreground mr-2">Active Filters:</span>
      
      {period !== 'this_month' && (
        <Badge variant="secondary" className="flex items-center gap-1.5 px-2.5 py-1">
          <span className="font-medium text-muted-foreground">Period:</span>
          {PERIOD_PRESETS.find(p => p.value === period)?.label || period}
          <button onClick={() => onRemoveFilter('period')} className="ml-1 rounded-full hover:bg-muted p-0.5 print:hidden">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      )}

      {activeKeys.map(key => {
        const filterDef = config.filters.find(f => f.key === key);
        if (!filterDef) return null;
        
        const labelText = resolvedLabels[key] || 'Loading...';
        
        return (
          <Badge key={key} variant="secondary" className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/10 hover:bg-primary/20 text-primary border-primary/20">
            <span className="font-medium text-muted-foreground">{filterDef.label}:</span>
            {labelText}
            <button onClick={() => onRemoveFilter(key)} className="ml-1 rounded-full hover:bg-primary/20 p-0.5 text-primary print:hidden">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        );
      })}

      <Button variant="ghost" size="sm" onClick={onClearAll} className="h-7 text-xs ml-auto text-muted-foreground hover:text-foreground print:hidden">
        Clear All
      </Button>
    </div>
  );
}
