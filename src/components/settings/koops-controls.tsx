"use client";

// The settings panels' own radio-style controls, extracted from
// module-settings.tsx on 2026-11-04 so a second panel can use them.
//
// They cannot simply be imported from module-settings: that file imports the
// panels, so the dependency would be circular. Pulled out verbatim — no visual
// change was intended, and the Secondary Sales panel has to look identical to
// the rows it sits beside.

import { cn } from "@/lib/utils";

// ── Koops Screenshot Radio Button Toggle (No / Yes) ─────────────
export function KoopsRadioToggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-5">
      <label
        onClick={() => !disabled && onChange(false)}
        className={cn(
          "flex items-center gap-2 cursor-pointer select-none text-xs font-medium",
          disabled && "opacity-50 cursor-not-allowed"
        )}
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
        onClick={() => !disabled && onChange(true)}
        className={cn(
          "flex items-center gap-2 cursor-pointer select-none text-xs font-medium",
          disabled && "opacity-50 cursor-not-allowed"
        )}
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

// ── Koops Multi-Option Toggle ─────────────
export function KoopsOptionToggle<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-6 mt-2">
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <label
            key={opt.value}
            onClick={() => !disabled && onChange(opt.value)}
            className={cn(
              "flex items-center gap-2 cursor-pointer select-none text-xs font-medium",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full border transition-colors shrink-0",
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-muted-foreground/40 bg-background"
              )}
            >
              {isSelected && <span className="h-2 w-2 rounded-full bg-primary" />}
            </span>
            <span
              className={cn(
                isSelected ? "text-foreground font-semibold" : "text-muted-foreground"
              )}
            >
              {opt.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
