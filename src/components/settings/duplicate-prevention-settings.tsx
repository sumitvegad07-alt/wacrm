"use client";

import { Copy, Lock } from "lucide-react";
import {
  CUSTOMER_UNIQUE_KEYS,
  LEAD_UNIQUE_KEYS,
  type CustomerUniqueKey,
  type LeadUniqueKey,
  type UniqueKeyField,
} from "@/lib/dedupe/unique-keys";

/**
 * "Which fields stop someone saving a duplicate?"
 *
 * Presentational, so it can be rendered and asserted on without a Supabase
 * client or a signed-in session; the owning panel holds the values and saves.
 *
 * Several fields can be ticked and ANY match blocks the save — the way
 * Salesforce and Zoho do it, rather than one winning key.
 */

export interface DuplicatePreventionSettingsProps {
  productUniqueKey: "name" | "code";
  customerKeys: CustomerUniqueKey[];
  leadKeys: LeadUniqueKey[];
  disabled?: boolean;
  /**
   * Which record types this account actually has.
   *
   * The card always showed all three columns, so an SFA-only tenant was asked
   * which Lead fields must be unique when the plan gives them no Leads screen
   * at all — the founder's "I can see CRM things in only SFA plan too". The
   * settings are kept in the account's JSON either way; a column the plan does
   * not include is simply not offered.
   */
  showLeads?: boolean;
  showProducts?: boolean;
  onChange: (next: {
    productUniqueKey: "name" | "code";
    customerKeys: CustomerUniqueKey[];
    leadKeys: LeadUniqueKey[];
  }) => void;
}

/** The Contact Number row: shown so the rule is visible, locked because it is real. */
function AlwaysOnPhoneRow({ what }: { what: string }) {
  return (
    <label data-touch-target className="flex min-h-11 md:min-h-0 items-center gap-2 text-sm text-muted-foreground">
      <input type="checkbox" checked readOnly disabled className="size-4 shrink-0" />
      <span>Contact Number</span>
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/80">
        <Lock className="size-3" /> always on
      </span>
      <span className="sr-only">
        Two {what} in the same account can never share a phone number.
      </span>
    </label>
  );
}

function KeyChecklist<K extends string>({
  fields,
  selected,
  disabled,
  onToggle,
}: {
  fields: UniqueKeyField<K>[];
  selected: K[];
  disabled?: boolean;
  onToggle: (next: K[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      {fields.map((field) => (
        <label key={field.key} data-touch-target className="flex min-h-11 md:min-h-0 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 shrink-0"
            disabled={disabled}
            checked={selected.includes(field.key)}
            onChange={(e) =>
              onToggle(
                e.target.checked
                  ? fields.filter((f) => f.key === field.key || selected.includes(f.key)).map((f) => f.key)
                  : selected.filter((k) => k !== field.key),
              )
            }
          />
          {field.label}
        </label>
      ))}
    </div>
  );
}

export function DuplicatePreventionSettings({
  productUniqueKey,
  customerKeys,
  leadKeys,
  disabled,
  showLeads = true,
  showProducts = true,
  onChange,
}: DuplicatePreventionSettingsProps) {
  // Customers are a base module on every plan, so there is always one column.
  const columns = 1 + (showLeads ? 1 : 0) + (showProducts ? 1 : 0);
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-4 space-y-5">
      <div className="flex items-start gap-2">
        <Copy className="h-4 w-4 text-muted-foreground mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Prevent duplicate records</p>
          <p className="text-xs text-muted-foreground mt-1">
            Tick the fields that must be unique. A save is blocked when{" "}
            <strong>any</strong> ticked field already exists on another active record.
          </p>
        </div>
      </div>

      <div
        className={
          "grid gap-5 " +
          (columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-1")
        }
      >
        {/* Customers */}
        <div>
          <p className="text-sm font-medium text-foreground mb-1.5">Customer</p>
          <KeyChecklist
            fields={CUSTOMER_UNIQUE_KEYS}
            selected={customerKeys}
            disabled={disabled}
            onToggle={(next) => onChange({ productUniqueKey, customerKeys: next, leadKeys })}
          />
          <div className="mt-1.5">
            <AlwaysOnPhoneRow what="customers" />
          </div>
        </div>

        {/* Leads — CRM line only. */}
        {showLeads && (
        <div>
          <p className="text-sm font-medium text-foreground mb-1.5">Lead</p>
          <KeyChecklist
            fields={LEAD_UNIQUE_KEYS}
            selected={leadKeys}
            disabled={disabled}
            onToggle={(next) => onChange({ productUniqueKey, customerKeys, leadKeys: next })}
          />
          <div className="mt-1.5">
            <AlwaysOnPhoneRow what="leads" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Leads had no duplicate checking at all before now, so nothing is ticked until you
            choose. Turning one on starts rejecting saves that used to be allowed.
          </p>
        </div>
        )}

        {/* Products — the catalogue, which is sold with CRM and with SFA but
            never with WFA alone. Unchanged single choice (founder, 2026-10-05). */}
        {showProducts && (
        <div>
          <p className="text-sm font-medium text-foreground mb-1.5">Product unique key</p>
          <div className="space-y-1.5">
            {(
              [
                { value: "name" as const, label: "Name" },
                { value: "code" as const, label: "Product Code" },
              ]
            ).map((opt) => (
              <label key={opt.value} data-touch-target className="flex min-h-11 md:min-h-0 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="product-unique-key"
                  className="size-4 shrink-0"
                  disabled={disabled}
                  checked={productUniqueKey === opt.value}
                  onChange={() => onChange({ productUniqueKey: opt.value, customerKeys, leadKeys })}
                />
                {opt.label}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Products keep a single choice.
          </p>
        </div>
        )}
      </div>
    </div>
  );
}
