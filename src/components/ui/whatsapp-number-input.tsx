"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DEFAULT_COUNTRY_CODE,
  joinWhatsAppNumber,
  sanitizeNationalInput,
  splitWhatsAppNumber,
  validateNationalNumber,
} from "@/lib/whatsapp/number-format";

// ------------------------------------------------------------
// WhatsApp number input.
//
// The country code sits OUTSIDE the editable area, fixed and unfocusable. That
// is the whole point: admins type only the local number, exactly as they always
// have, and a number can no longer be saved without a country code. Nine of the
// twenty-seven production customers were stored as bare 10-digit mobiles, which
// WhatsApp rejects outright — this makes that state unreachable rather than
// merely discouraged.
//
// The code comes from the account setting, not a constant, so an organisation
// outside India is a settings change rather than a migration. Admins still
// cannot edit it per record.
// ------------------------------------------------------------

export interface WhatsAppNumberInputProps {
  /** Stored value, '+<cc><national>'. */
  value: string | null | undefined;
  /** Receives the full stored form, or '' when cleared. */
  onChange: (value: string) => void;
  /** From the account setting. */
  countryCode?: string;
  /**
   * The record's ordinary phone number. When present, the "use the contact
   * number" shortcut is offered — most customers use one number for both, and
   * retyping it is where mistakes get made.
   */
  contactNumber?: string | null;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function WhatsAppNumberInput({
  value,
  onChange,
  countryCode = DEFAULT_COUNTRY_CODE,
  contactNumber,
  id,
  disabled,
  placeholder = "98765 43210",
  className,
}: WhatsAppNumberInputProps) {
  const [national, setNational] = useState(
    () => splitWhatsAppNumber(value, countryCode).national,
  );
  const [touched, setTouched] = useState(false);

  // Re-sync when the record changes underneath (switching contacts in a sheet,
  // or the "use contact number" shortcut writing through the parent).
  useEffect(() => {
    setNational(splitWhatsAppNumber(value, countryCode).national);
  }, [value, countryCode]);

  const validity = validateNationalNumber(national, countryCode);
  const showError = touched && !validity.valid;

  const contactNational = splitWhatsAppNumber(contactNumber, countryCode).national;
  const canCopyContact = Boolean(contactNational);
  const matchesContact = canCopyContact && contactNational === national;

  function commit(next: string) {
    setNational(next);
    onChange(joinWhatsAppNumber(countryCode, next));
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className={cn(
          "flex items-stretch overflow-hidden rounded-md border transition-colors",
          showError ? "border-red-500/50" : "border-border",
          disabled && "opacity-60",
        )}
      >
        {/* Fixed, unfocusable, not a form control — it cannot be edited or tabbed into. */}
        <span
          aria-hidden="true"
          className="bg-muted/70 text-muted-foreground border-border flex shrink-0 select-none items-center border-r px-2.5 text-sm font-medium"
        >
          {countryCode}
        </span>
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          value={national}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={`WhatsApp number, country code ${countryCode}`}
          aria-invalid={showError || undefined}
          onChange={(e) => commit(sanitizeNationalInput(e.target.value))}
          onBlur={() => setTouched(true)}
          className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </div>

      {canCopyContact && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            commit(contactNational);
            setTouched(true);
          }}
          className={cn(
            "flex items-center gap-1.5 text-xs transition-colors",
            matchesContact
              ? "text-muted-foreground cursor-default"
              : "text-primary hover:text-primary/80",
          )}
        >
          <span
            className={cn(
              "flex h-3.5 w-3.5 items-center justify-center rounded-sm border",
              matchesContact
                ? "border-primary/60 bg-primary/20 text-primary"
                : "border-muted-foreground/40",
            )}
          >
            {matchesContact && <Check className="h-2.5 w-2.5" />}
          </span>
          Use the contact number
          <span className="text-muted-foreground">({countryCode} {contactNational})</span>
        </button>
      )}

      {showError && <p className="text-xs text-red-400">{validity.message}</p>}
    </div>
  );
}

/**
 * Read-only rendering, for surfaces that show a number they don't own — a deal
 * displaying its customer's number, for instance. Deliberately not an input:
 * a deal has no WhatsApp number of its own, and letting one be edited there
 * would copy the value and let it drift the moment the customer's changes.
 */
export function WhatsAppNumberDisplay({
  value,
  countryCode = DEFAULT_COUNTRY_CODE,
  source,
  className,
}: {
  value: string | null | undefined;
  countryCode?: string;
  /** Where the number came from, e.g. "from customer Campus Grocery". */
  source?: string;
  className?: string;
}) {
  const { national } = splitWhatsAppNumber(value, countryCode);

  if (!national) {
    return (
      <p className={cn("text-muted-foreground text-sm", className)}>
        No WhatsApp number{source ? ` on ${source}` : ""}
      </p>
    );
  }

  return (
    <div className={cn("space-y-0.5", className)}>
      <p className="text-foreground text-sm">
        {countryCode} {national}
      </p>
      {source && <p className="text-muted-foreground text-xs">from {source}</p>}
    </div>
  );
}
