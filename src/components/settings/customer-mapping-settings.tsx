"use client";

import { Network } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-layout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MAPPING_MODES,
  MAPPING_MODE_META,
  type MappingMode,
} from "@/lib/customers/mapping";

/**
 * "Do we record which distributor supplies each dealer, and who decides?"
 *
 * Presentational: the owning panel holds the value, does the saving and runs
 * the re-map, so this can be rendered and asserted on without a Supabase
 * client or a signed-in session.
 *
 * Changing mode does not rewrite anybody's supplier on its own. Switching to
 * "From the beat" offers a separate Re-map button that says how many customers
 * it would change before it writes — because an admin who has spent a week
 * setting suppliers by hand should not lose it to a dropdown.
 */

export interface CustomerMappingSettingsProps {
  value: MappingMode;
  /** How many customers the beat rule would give a different supplier. */
  wouldChange?: number | null;
  remapping?: boolean;
  disabled?: boolean;
  onChange: (next: MappingMode) => void;
  onRemap?: () => void;
}

export function CustomerMappingSettings({
  value,
  wouldChange,
  remapping,
  disabled,
  onChange,
  onRemap,
}: CustomerMappingSettingsProps) {
  return (
    <SettingsCard
      title={
        <span className="flex items-center gap-2">
          <Network className="size-4 text-muted-foreground" /> Customer mapping
        </span>
      }
      description={
        <>
          Record <strong>which customer supplies which</strong> — a distributor and the dealers
          he serves. That is what makes a secondary sale report{" "}
          <strong>through whom</strong> it happened, not just that it was secondary. This is a
          different question from Customer Level, which says what kind of customer somebody is;
          levels keep working exactly as they do.
        </>
      }
      bodyClassName="space-y-3 px-4 py-3"
    >
      <div className="space-y-2">
        {MAPPING_MODES.map((mode) => (
          <Button
            key={mode}
            type="button"
            variant="outline"
            disabled={disabled}
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
            className={cn(
              "h-auto w-full flex-col items-start gap-0 whitespace-normal rounded-lg p-3 text-left",
              value === mode
                ? "border-primary bg-primary/5 hover:bg-primary/5"
                : "hover:border-muted-foreground/40",
            )}
          >
            <span className="text-label font-medium">{MAPPING_MODE_META[mode].label}</span>
            <span className="mt-0.5 text-caption font-normal text-muted-foreground">
              {MAPPING_MODE_META[mode].help}
            </span>
          </Button>
        ))}
      </div>

      {value === "beat" && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
          <p className="text-caption text-muted-foreground">
            Give each beat its supplying distributor on the <strong>Routes</strong> screen. A
            customer permanently on that beat then takes it automatically. A customer visited on
            a <strong>one-time</strong> stop keeps the supplier of the beat they really belong
            to.
          </p>
          {wouldChange != null && (
            <div className="flex flex-wrap items-center gap-2">
              {wouldChange > 0 ? (
                <>
                  <p className="text-caption">
                    Re-mapping now would change the supplier on{" "}
                    <strong>
                      {wouldChange} customer{wouldChange === 1 ? "" : "s"}
                    </strong>
                    .
                  </p>
                  {onRemap && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled || remapping}
                      onClick={onRemap}
                    >
                      {remapping ? "Re-mapping…" : `Re-map ${wouldChange}`}
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-caption text-muted-foreground">
                  Every customer already matches their beat.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
