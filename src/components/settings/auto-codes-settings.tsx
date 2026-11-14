"use client";

import { Hash } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-layout";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CODE_KINDS,
  CODE_KIND_META,
  MAX_DIGITS,
  MIN_DIGITS,
  cleanPrefix,
  formatCode,
  type CodeKind,
  type CodeRule,
  type CodeSettings,
} from "@/lib/codes/auto-codes";

/**
 * "Should OZZO number my customers, employees and products for me?"
 *
 * Presentational: the owning panel holds the values, does the saving and runs
 * the backfill, so this can be rendered and asserted on without a Supabase
 * client or a signed-in session.
 *
 * Every row is off until an admin switches it on, and switching it on does not
 * renumber anything already saved — that is the separate Fill in blanks button,
 * which says how many records it will touch before it writes.
 */

export interface AutoCodesSettingsProps {
  value: CodeSettings;
  /**
   * Last number actually minted per record type, read from account_sequences.
   * Without it the "Next code" line would lie to an account that has already
   * generated 150 codes while the saved "start from" still reads 1.
   */
  lastUsed?: Partial<Record<CodeKind, number>>;
  /** How many records of each type currently have no code. */
  blanks?: Partial<Record<CodeKind, number>>;
  busyKind?: CodeKind | null;
  disabled?: boolean;
  onChange: (next: CodeSettings) => void;
  onBackfill?: (kind: CodeKind) => void;
  /**
   * The code kinds this account's plan actually has. Product codes are only
   * meaningful where the plan includes the catalogue (CRM or SFA), so a
   * WFA-only tenant is not offered a numbering rule for products it cannot
   * create. Customers and employees exist on every plan.
   */
  kinds?: readonly CodeKind[];
}

/** The number the next save will really use. */
export function effectiveNext(rule: CodeRule, lastUsed: number | undefined): number {
  return Math.max(rule.next, (lastUsed ?? 0) + 1);
}

function CodeRuleRow({
  kind,
  rule,
  lastUsed,
  blanks,
  busy,
  disabled,
  onRule,
  onBackfill,
}: {
  kind: CodeKind;
  rule: CodeRule;
  lastUsed?: number;
  blanks?: number;
  busy: boolean;
  disabled?: boolean;
  onRule: (next: CodeRule) => void;
  onBackfill?: () => void;
}) {
  const meta = CODE_KIND_META[kind];
  const nextNumber = effectiveNext(rule, lastUsed);
  const preview = formatCode(rule, nextNumber);

  return (
    <div className="border-b border-border/60 py-3 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-label font-medium">{meta.label}</p>
          <p className="text-caption text-muted-foreground">{meta.help}</p>
        </div>
        <Switch
          checked={rule.enabled}
          disabled={disabled}
          aria-label={`Generate ${meta.field} automatically`}
          onCheckedChange={(on) => onRule({ ...rule, enabled: on === true })}
        />
      </div>

      {rule.enabled && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-0 space-y-1">
              <span className="block text-caption text-muted-foreground">Starts with</span>
              <Input
                value={rule.prefix}
                disabled={disabled}
                className="w-28"
                placeholder="none"
                onChange={(e) => onRule({ ...rule, prefix: cleanPrefix(e.target.value) })}
              />
            </label>
            <label className="min-w-0 space-y-1">
              <span className="block text-caption text-muted-foreground">Digits</span>
              <Input
                type="number"
                inputMode="numeric"
                min={MIN_DIGITS}
                max={MAX_DIGITS}
                value={rule.digits}
                disabled={disabled}
                className="w-20"
                onChange={(e) => onRule({ ...rule, digits: Number(e.target.value) })}
              />
            </label>
            <label className="min-w-0 space-y-1">
              <span className="block text-caption text-muted-foreground">Start from</span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                value={rule.next}
                disabled={disabled}
                className="w-24"
                onChange={(e) => onRule({ ...rule, next: Number(e.target.value) })}
              />
            </label>
            <div className="min-w-0 space-y-1">
              <span className="block text-caption text-muted-foreground">Next code</span>
              <p className="font-mono text-body font-medium">{preview}</p>
            </div>
          </div>

          {nextNumber > rule.next && (
            <p className="text-caption text-muted-foreground">
              {formatCode(rule, lastUsed ?? 0)} has already been used, so numbering carries on
              from {nextNumber}. Raise <strong>Start from</strong> to jump ahead; it cannot be
              wound back onto codes already issued.
            </p>
          )}

          {blanks !== undefined && (
            <div className="flex flex-wrap items-center gap-2">
              {blanks > 0 ? (
                <>
                  <p className="text-caption text-muted-foreground">
                    {blanks} {blanks === 1 ? "record has" : "records have"} no {meta.field.toLowerCase()}.
                    Switching this on does not change them.
                  </p>
                  {onBackfill && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disabled || busy}
                      onClick={onBackfill}
                    >
                      {busy ? "Filling…" : `Fill in ${blanks}`}
                    </Button>
                  )}
                </>
              ) : (
                <p className="text-caption text-muted-foreground">
                  Every record already has a {meta.field.toLowerCase()}.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AutoCodesSettings({
  value,
  lastUsed,
  blanks,
  busyKind,
  disabled,
  onChange,
  onBackfill,
  kinds,
}: AutoCodesSettingsProps) {
  return (
    <SettingsCard
      title={
        <span className="flex items-center gap-2">
          <Hash className="size-4 text-muted-foreground" /> Automatic codes
        </span>
      }
      description={
        <>
          Let OZZO fill in the code when the box is left empty. A code you type yourself is
          always kept. <strong>Nothing already saved is renumbered</strong>, and every record
          type is off until you switch it on.
        </>
      }
      bodyClassName="px-4 py-1"
    >
      {(kinds ?? CODE_KINDS).map((kind) => (
        <CodeRuleRow
          key={kind}
          kind={kind}
          rule={value[kind]}
          lastUsed={lastUsed?.[kind]}
          blanks={blanks?.[kind]}
          busy={busyKind === kind}
          disabled={disabled}
          onRule={(next) => onChange({ ...value, [kind]: next })}
          onBackfill={onBackfill ? () => onBackfill(kind) : undefined}
        />
      ))}
    </SettingsCard>
  );
}
