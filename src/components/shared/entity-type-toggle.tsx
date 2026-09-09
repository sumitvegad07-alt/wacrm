import { cn } from "@/lib/utils";

interface EntityTypeToggleProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}

/**
 * The one compact segmented control for the "Customer / Lead" choice on deal,
 * quotation and order forms (and anywhere a small either/or pill toggle is
 * wanted). Same size and style everywhere — replaces the mix of big full-width
 * buttons and ad-hoc pills the forms used to each roll their own.
 */
export function EntityTypeToggle<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: EntityTypeToggleProps<T>) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md bg-muted p-0.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-sm transition-colors",
              active
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
