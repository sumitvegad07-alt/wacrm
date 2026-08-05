'use client';

import React from 'react';
import { useExtraSettings, type AssignmentMode } from '@/hooks/use-extra-settings';
import { OrdersSettings } from '@/components/settings/orders-settings';
import { Map, Users, CheckCircle2, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

// Koops Radio Button Toggle (No / Yes)
function KoopsRadioToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-6 mt-2">
      <label
        onClick={() => onChange(false)}
        className="flex items-center gap-2 cursor-pointer select-none text-xs font-medium"
      >
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
            !enabled
              ? "border-primary bg-primary/10"
              : "border-muted-foreground/40 bg-background"
          )}
        >
          {!enabled && <span className="h-2 w-2 rounded-full bg-primary" />}
        </span>
        <span
          className={cn(
            !enabled ? "text-foreground font-semibold" : "text-muted-foreground"
          )}
        >
          No
        </span>
      </label>

      <label
        onClick={() => onChange(true)}
        className="flex items-center gap-2 cursor-pointer select-none text-xs font-medium"
      >
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
            enabled
              ? "border-primary bg-primary/10"
              : "border-muted-foreground/40 bg-background"
          )}
        >
          {enabled && <span className="h-2 w-2 rounded-full bg-primary" />}
        </span>
        <span
          className={cn(
            enabled ? "text-foreground font-semibold" : "text-muted-foreground"
          )}
        >
          Yes
        </span>
      </label>
    </div>
  );
}

export function ExtraSettingsPanel() {
  const {
    assignmentMode,
    customerHierarchy,
    setAssignmentMode,
    setCustomerHierarchy,
  } = useExtraSettings();

  return (
    <div className="space-y-8">
      {/* 1. Customer & Lead Assignment to Employee */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="border-b border-border/80 pb-3 mb-6">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Customer & Lead Assignment to Employee
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose how customers and leads are assigned to sales employees across your organization.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Assign Area Wise */}
          <div
            onClick={() => setAssignmentMode('area')}
            className={cn(
              "relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all hover:border-primary/60",
              assignmentMode === 'area'
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card hover:bg-muted/30"
            )}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm text-foreground flex items-center gap-2">
                  <Map className="h-4 w-4 text-primary" />
                  Assign Area Wise
                </span>
                {assignmentMode === 'area' && (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Assign customers and leads automatically or manually by geographical area and territory hierarchy.
              </p>
            </div>
            <div className="mt-3 inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              ✓ Enables Territory Master in Settings menu
            </div>
          </div>

          {/* Direct Assignment */}
          <div
            onClick={() => setAssignmentMode('direct')}
            className={cn(
              "relative flex cursor-pointer flex-col justify-between rounded-xl border p-4 transition-all hover:border-primary/60",
              assignmentMode === 'direct'
                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                : "border-border bg-card hover:bg-muted/30"
            )}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm text-foreground flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Direct Assignment
                </span>
                {assignmentMode === 'direct' && (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Assign customers and leads directly to individual employees without geographical area or territory restrictions.
              </p>
            </div>
            <div className="mt-3 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              ✗ Territory Master hidden from Settings menu
            </div>
          </div>
        </div>
      </div>

      {/* 2. Enable Customer Hierarchy (with Orders Settings functionality) */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="border-b border-border/80 pb-3 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Enable customer hierarchy
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enable structured order numbering, customer hierarchy rules, and order fulfillment workflows.
            </p>
          </div>
          <KoopsRadioToggle
            enabled={customerHierarchy}
            onChange={setCustomerHierarchy}
          />
        </div>

        {/* Functionality: Same as currently in OrdersSettings when enabled */}
        {customerHierarchy ? (
          <div className="mt-4 pt-2">
            <OrdersSettings />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground/60 mb-2" />
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Customer hierarchy is disabled
            </h3>
            <p className="max-w-sm text-xs text-muted-foreground">
              Select <strong>Yes</strong> above to enable structured order numbering, customer hierarchy rules, and order fulfillment settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
