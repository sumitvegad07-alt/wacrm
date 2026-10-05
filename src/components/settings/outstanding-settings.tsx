"use client";

import { useState } from "react";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ORDER_STATUS_PRESETS,
  ORDER_STATUSES,
  PAYMENT_STATUS_PRESETS,
  PAYMENT_STATUSES,
  matchOrderPreset,
  matchPaymentPreset,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/payments/outstanding-config";

/**
 * "When does an order become money the customer owes us?"
 *
 * Presentational: the owning settings panel holds the chosen statuses and does
 * the saving, so this can be rendered and asserted on without a Supabase client
 * or a signed-in session.
 *
 * The business moments below are shortcuts over sets of statuses. Custom reveals
 * the raw ticks for an account whose workflow none of them describe.
 */
const ORDER_RULE_CHOICES = [
  {
    value: "on_creation" as const,
    label: "An order is created",
    help: "Owed the moment a salesman books it. Cancelled and Rejected orders never count.",
  },
  {
    value: "on_approval" as const,
    label: "An order is Approved",
    help: "Owed once the office accepts the order.",
  },
  {
    value: "on_dispatch" as const,
    label: "Goods are dispatched",
    help: "Owed once goods leave. A part dispatch counts the whole order value.",
  },
  {
    value: "on_close" as const,
    label: "An order is Closed",
    help: "Owed only when the order is complete. This is the default.",
  },
  { value: "custom" as const, label: "Custom", help: "Choose the exact order statuses yourself." },
];

const PAYMENT_RULE_CHOICES = [
  {
    value: "approved_only" as const,
    label: "A payment is Approved",
    help: "Only money an approver has confirmed. This is the default.",
  },
  {
    value: "pending_and_approved" as const,
    label: "A payment is entered",
    help: "Also credits cash a rep has collected but nobody has verified yet.",
  },
  { value: "custom" as const, label: "Custom", help: "Choose the exact payment statuses yourself." },
];

export interface OutstandingSettingsProps {
  orderStatuses: OrderStatus[];
  paymentStatuses: PaymentStatus[];
  disabled?: boolean;
  onChange: (next: { orderStatuses: OrderStatus[]; paymentStatuses: PaymentStatus[] }) => void;
}

function RuleButton({
  label,
  help,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  help: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "text-left p-3 rounded-lg border transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40",
      )}
    >
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{help}</p>
    </button>
  );
}

export function OutstandingSettings({
  orderStatuses,
  paymentStatuses,
  disabled,
  onChange,
}: OutstandingSettingsProps) {
  // Whether the raw status ticks are showing. Derived state alone is not enough:
  // an admin who opens Custom and happens to tick a combination equal to a preset
  // would otherwise see the list vanish from under them mid-edit. Seeded from the
  // saved values so an account already on a custom set opens with its ticks shown.
  const [showCustomOrders, setShowCustomOrders] = useState(
    () => matchOrderPreset(orderStatuses) === "custom",
  );
  const [showCustomPayments, setShowCustomPayments] = useState(
    () => matchPaymentPreset(paymentStatuses) === "custom",
  );

  const orderPreset = showCustomOrders ? "custom" : matchOrderPreset(orderStatuses);
  const paymentPreset = showCustomPayments ? "custom" : matchPaymentPreset(paymentStatuses);

  /** Tick/untick one status, keeping the list in canonical order. */
  function toggle<T extends string>(all: readonly T[], current: T[], status: T, on: boolean): T[] {
    return on ? all.filter((s) => s === status || current.includes(s)) : current.filter((s) => s !== status);
  }

  return (
    <div className="space-y-4 pt-6 border-t border-border">
      <div className="flex items-start gap-2">
        <Wallet className="h-4 w-4 text-muted-foreground mt-0.5" />
        <div>
          <h3 className="text-sm font-semibold">Outstanding Calculation</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Decide the moment an order becomes money a customer owes you, and which payments
            count as money received. Outstanding is{" "}
            <strong>worked out live, not stored as a fixed figure</strong>, so changing this
            restates every customer&apos;s balance straight away — including the credit-limit
            check that blocks new orders.
          </p>
        </div>
      </div>

      {/* Orders */}
      <div className="space-y-2 pl-6 border-l-2 border-primary/20">
        <p className="text-sm font-medium">An order counts as outstanding when</p>
        <div className="grid grid-cols-1 gap-2">
          {ORDER_RULE_CHOICES.map((choice) => (
            <RuleButton
              key={choice.value}
              label={choice.label}
              help={choice.help}
              selected={orderPreset === choice.value}
              disabled={disabled}
              onClick={() => {
                if (choice.value === "custom") {
                  setShowCustomOrders(true);
                  return;
                }
                setShowCustomOrders(false);
                onChange({
                  orderStatuses: [...ORDER_STATUS_PRESETS[choice.value]],
                  paymentStatuses,
                });
              }}
            />
          ))}
        </div>

        {orderPreset === "custom" && (
          <div className="pt-1">
            <p className="text-xs text-muted-foreground mb-2">
              Tick every order status that should count as owed.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ORDER_STATUSES.map((status) => (
                <label key={status} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={orderStatuses.includes(status)}
                    onChange={(e) =>
                      onChange({
                        orderStatuses: toggle(ORDER_STATUSES, orderStatuses, status, e.target.checked),
                        paymentStatuses,
                      })
                    }
                  />
                  {status}
                </label>
              ))}
            </div>
            {orderStatuses.length === 0 && (
              <p className="text-xs text-destructive mt-2">
                Pick at least one status — with none ticked every customer would show a zero
                balance.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Payments */}
      <div className="space-y-2 pl-6 border-l-2 border-primary/20">
        <p className="text-sm font-medium">A payment reduces outstanding when</p>
        <div className="grid grid-cols-1 gap-2">
          {PAYMENT_RULE_CHOICES.map((choice) => (
            <RuleButton
              key={choice.value}
              label={choice.label}
              help={choice.help}
              selected={paymentPreset === choice.value}
              disabled={disabled}
              onClick={() => {
                if (choice.value === "custom") {
                  setShowCustomPayments(true);
                  return;
                }
                setShowCustomPayments(false);
                onChange({
                  orderStatuses,
                  paymentStatuses: [...PAYMENT_STATUS_PRESETS[choice.value]],
                });
              }}
            />
          ))}
        </div>

        {paymentPreset === "custom" && (
          <div className="pt-1">
            <p className="text-xs text-muted-foreground mb-2">
              Tick every payment status that should count as received.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_STATUSES.map((status) => (
                <label key={status} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={paymentStatuses.includes(status)}
                    onChange={(e) =>
                      onChange({
                        orderStatuses,
                        paymentStatuses: toggle(
                          PAYMENT_STATUSES,
                          paymentStatuses,
                          status,
                          e.target.checked,
                        ),
                      })
                    }
                  />
                  {status}
                </label>
              ))}
            </div>
            {paymentStatuses.length === 0 && (
              <p className="text-xs text-destructive mt-2">
                Pick at least one status — with none ticked no payment would ever reduce a
                balance.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
