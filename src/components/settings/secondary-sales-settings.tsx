"use client";

import { Layers, Network, Plus, Trash2 } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-layout";
import { Button } from "@/components/ui/button";
import { NavButton } from "@/components/ui/nav-button";
import { Input } from "@/components/ui/input";
import { KoopsRadioToggle } from "@/components/settings/koops-controls";
import { cn } from "@/lib/utils";
import {
  MAPPING_MODE_META,
  MAX_LEVELS,
  OFFERED_MAPPING_MODES,
  levelsProblem,
  type MappingMode,
  type SecondarySalesSetup,
} from "@/lib/customers/mapping";

/**
 * Secondary sales, in one place.
 *
 * It used to be two switches in two different screens — "Enable distribution
 * hierarchy" under Orders, which named the levels, and "Customer mapping" under
 * Modules, which recorded who supplies whom. The founder, 2026-11-04:
 *
 *   "Currently we have 2 settings enable customer hierarchy and customer
 *    mapping — those 2 settings are actually not good option, that actually
 *    force users to perform two separate tasks for one action."
 *
 * He is right: neither half is useful alone. Levels without suppliers classify
 * an order as secondary but cannot say through whom; suppliers without levels
 * have no rule for who may supply whom. So they are one setting with four
 * steps, and the steps appear in order rather than all at once.
 *
 * Presentational on purpose, like the card it replaces: the owning panel holds
 * the values, does the one atomic save and runs the re-map, so this can be
 * rendered and asserted on without a Supabase client or a signed-in session.
 *
 * What it will NOT do is let a tenant believe this is working when it is not.
 * A customer with no level classifies as `direct` and one with no supplier has
 * no channel, so the counts are shown here rather than discovered later in an
 * empty report.
 */

export interface LevelDraft {
  position: number;
  name: string;
  color?: string;
}

export interface SecondarySalesSettingsProps {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;

  levels: LevelDraft[];
  onLevelName: (index: number, name: string) => void;
  onLevelColor: (index: number, color: string) => void;
  onAddLevel: () => void;
  onRemoveLevel: (index: number) => void;

  mode: MappingMode;
  onModeChange: (next: MappingMode) => void;

  /** How many customers the area rule would give a different supplier. */
  wouldChange?: number | null;
  remapping?: boolean;
  onRemap?: () => void;

  /** Whether this is really configured, not merely switched on. */
  setup?: SecondarySalesSetup | null;

  disabled?: boolean;
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/60 py-3 last:border-0">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-caption font-semibold text-muted-foreground">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-label font-medium text-foreground">{title}</p>
          <div className="mt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SecondarySalesSettings({
  enabled,
  onEnabledChange,
  levels,
  onLevelName,
  onLevelColor,
  onAddLevel,
  onRemoveLevel,
  mode,
  onModeChange,
  wouldChange,
  remapping,
  onRemap,
  setup,
  disabled,
}: SecondarySalesSettingsProps) {
  const problem = levelsProblem(enabled, levels);
  const named = levels.filter((l) => l.name.trim());
  const topName = named[0]?.name.trim() || "Level 1";
  const notReady = setup
    ? setup.no_level > 0 || (mode !== "off" && setup.no_parent > 0)
    : false;

  return (
    <SettingsCard
      title={
        <span className="flex items-center gap-2">
          <Network className="size-4 text-muted-foreground" /> Secondary sales
        </span>
      }
      description={
        <>
          One setting for the whole distribution channel: what levels of customer you have, who
          supplies whom, and therefore which orders are <strong>primary</strong> and which are{" "}
          <strong>secondary</strong>.
        </>
      }
      bodyClassName="py-0"
    >
      <Step n={1} title="Enable secondary sales">
        <div className="flex items-start justify-between gap-4">
          <p className="max-w-prose text-caption text-muted-foreground">
            Off: every order is a plain direct order. On: an order is primary when it comes from
            your top level of customer, and secondary when it comes from anyone below them.
          </p>
          <KoopsRadioToggle enabled={enabled} onChange={onEnabledChange} disabled={disabled} />
        </div>
      </Step>

      {enabled && (
        <>
          <Step n={2} title="How many levels of customer, and what are they called?">
            <div className="flex items-center gap-2 pb-2">
              <Layers className="size-3.5 text-muted-foreground" />
              <p className="text-caption text-muted-foreground">
                Level 1 is the top of the chain. Orders from Level 1 are primary.
              </p>
            </div>
            <div className="space-y-2">
              {levels.map((lvl, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-1 pr-2"
                >
                  <span className="w-14 pl-2 text-caption text-muted-foreground">
                    Level {i + 1}
                  </span>
                  <Input
                    type="color"
                    value={lvl.color || "#8b5cf6"}
                    onChange={(e) => onLevelColor(i, e.target.value)}
                    disabled={disabled}
                    className="h-8 w-10 shrink-0 border-0 bg-transparent p-1"
                    title="Badge colour"
                  />
                  <Input
                    value={lvl.name}
                    onChange={(e) => onLevelName(i, e.target.value)}
                    placeholder={
                      i === 0 ? "e.g. Super Stockist" : i === 1 ? "e.g. Stockist" : "e.g. Dealer"
                    }
                    disabled={disabled}
                    className="h-8 flex-1 bg-background"
                  />
                  {!disabled && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemoveLevel(i)}
                      className="size-8 p-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove level ${i + 1}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {!disabled && levels.length < MAX_LEVELS && (
              <Button variant="outline" size="sm" onClick={onAddLevel} className="mt-2 h-8">
                <Plus className="mr-1 size-3" /> Add level
              </Button>
            )}

            {problem ? (
              <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-caption text-amber-700 dark:text-amber-400">
                {problem}
              </p>
            ) : (
              named.length > 0 && (
                <p className="mt-2 text-caption text-muted-foreground">
                  Your chain: {named.map((l) => l.name.trim()).join(" → ")}. An order from a{" "}
                  <strong>{topName}</strong> is primary; everyone below is secondary.
                </p>
              )
            )}
          </Step>

          <Step n={3} title="How are customers mapped to their supplier?">
            <div className="space-y-2">
              {OFFERED_MAPPING_MODES.map((m) => (
                <Button
                  key={m}
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  aria-pressed={mode === m}
                  onClick={() => onModeChange(m)}
                  className={cn(
                    "h-auto w-full flex-col items-start gap-0 whitespace-normal rounded-lg p-3 text-left",
                    mode === m
                      ? "border-primary bg-primary/5 hover:bg-primary/5"
                      : "hover:border-muted-foreground/40",
                  )}
                >
                  <span className="text-label font-medium">{MAPPING_MODE_META[m].label}</span>
                  <span className="mt-0.5 text-caption font-normal text-muted-foreground">
                    {MAPPING_MODE_META[m].help}
                  </span>
                </Button>
              ))}
            </div>

            {/* Only reachable by a tenant who set it before 2026-11-04. Shown so
                they can see what they are on, and told what replaced it. */}
            {mode === "beat" && (
              <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-caption text-amber-700 dark:text-amber-400">
                  You are on <strong>{MAPPING_MODE_META.beat.label}</strong>. It still works, but
                  a beat is a visit route <em>inside</em> an area rather than the area itself, so
                  it asked you to build beats you may not otherwise need.{" "}
                  <strong>By area</strong> replaces it. Switching does not change anybody&apos;s
                  supplier until you re-map.
                </p>
              </div>
            )}

            {mode === "off" && (
              <p className="mt-2 text-caption text-muted-foreground">
                With mapping off your orders are still classified primary and secondary from the
                customer&apos;s level — you just cannot report{" "}
                <strong>through whom</strong> a secondary sale happened.
              </p>
            )}
          </Step>

          <Step n={4} title="Set the chain">
            {mode === "off" ? (
              <p className="text-caption text-muted-foreground">
                Choose a mapping method above first.
              </p>
            ) : (
              <>
                <p className="max-w-prose text-caption text-muted-foreground">
                  {mode === "area"
                    ? "Say who holds each level in each area, then check that every customer has a level and a supplier."
                    : "Set each customer's level and their supplier."}{" "}
                  Both are on one screen, and both can be set for many customers at once.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {/* NavButton, not a plain Link: it shows its own pending
                      state and warms the route on hover, which is the repo's
                      answer to a click that appears to do nothing. */}
                  <NavButton href="/contacts/mapping" variant="outline" size="sm">
                    Open customer mapping
                  </NavButton>
                  {mode === "area" && wouldChange != null && wouldChange > 0 && onRemap && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled || remapping}
                      onClick={onRemap}
                    >
                      {remapping ? "Re-mapping…" : `Re-map ${wouldChange} from areas`}
                    </Button>
                  )}
                </div>

                {setup && (
                  <div
                    className={cn(
                      "mt-3 rounded-lg border p-3",
                      notReady
                        ? "border-amber-500/30 bg-amber-500/10"
                        : "border-border bg-muted/40",
                    )}
                  >
                    {notReady ? (
                      <>
                        <p className="text-caption font-medium text-amber-700 dark:text-amber-400">
                          Not finished yet
                        </p>
                        <ul className="mt-1 space-y-0.5 text-caption text-muted-foreground">
                          {setup.no_level > 0 && (
                            <li>
                              <strong>{setup.no_level}</strong> customer
                              {setup.no_level === 1 ? "" : "s"} have no level, so their orders are
                              recorded as <strong>Direct</strong> rather than primary or
                              secondary.
                            </li>
                          )}
                          {setup.no_parent > 0 && (
                            <li>
                              <strong>{setup.no_parent}</strong> customer
                              {setup.no_parent === 1 ? "" : "s"} below the top level have no
                              supplier, so their sales have no channel.
                            </li>
                          )}
                          {mode === "area" && setup.no_area > 0 && (
                            <li>
                              <strong>{setup.no_area}</strong> have no area at all, so area
                              mapping cannot reach them.
                            </li>
                          )}
                        </ul>
                      </>
                    ) : (
                      <p className="text-caption text-muted-foreground">
                        All {setup.total} customers have a level and a supplier.
                        {setup.locked > 0 && (
                          <>
                            {" "}
                            <strong>{setup.locked}</strong> {setup.locked === 1 ? "has" : "have"} a
                            supplier set by hand, which area mapping leaves alone.
                          </>
                        )}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </Step>
        </>
      )}
    </SettingsCard>
  );
}
