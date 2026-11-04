"use client";

import { NavButton } from "@/components/ui/nav-button";
import { SettingsPanel } from "@/components/settings/settings-layout";

// NOTE: Order status is not configurable, by design. It's a fixed state machine
// (Pending → Approved → Part Dispatch → Dispatched → Closed, plus Rejected/Cancelled)
// enforced in the database (migrations 086 & 089). The editable list was removed
// from this screen, and the backing `order_statuses` table was dropped in
// 20260810123000 — it had drifted to names the state machine did not recognise,
// so it showed statuses that governed nothing. The status list now lives in one
// place: src/lib/orders/statuses.ts.
//
// 2026-11-04: the distribution-hierarchy switch, the level names and the
// level-less-customer warning left this screen. They were one half of secondary
// sales while "Customer mapping" — the other half — sat in Organisation
// settings, so configuring one feature meant two screens. The founder:
//
//   "Currently we have 2 settings enable customer hierarchy and customer
//    mapping — those 2 settings are actually not good option, that actually
//    force users to perform two separate tasks for one action."
//
// Both are now the Secondary sales card in Organisation settings, and the
// level-less count is one of the readiness numbers it shows. What is left here
// is only what is genuinely about the order lifecycle, which needs no data: the
// panel no longer reads the account row at all.
export function OrdersSettings() {
  return (
    <SettingsPanel
      description="How an order moves through its lifecycle. Statuses are fixed (Pending → Approved → Part Dispatch → Dispatched → Closed)."
      className="animate-in fade-in-50 duration-200"
    >
      <div className="mt-4 grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">
            Looking for customer levels and primary/secondary sales?
          </p>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            They moved. Your levels, who supplies whom and the primary/secondary rule are now one
            setting called <strong>Secondary sales</strong>, in Organisation settings.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <NavButton href="/settings?tab=organization" variant="outline" size="sm">
              Open Secondary sales
            </NavButton>
            <NavButton href="/contacts/mapping" variant="outline" size="sm">
              Customer mapping
            </NavButton>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-foreground">
            Order Lifecycle &amp; Classification Guide
          </h3>
          <div className="space-y-3 text-xs text-muted-foreground">
            <div className="rounded-md border border-border/50 bg-muted/50 p-3">
              <p className="mb-1 font-medium text-foreground">Fixed Status Machine</p>
              <p>
                All orders follow an enforced lifecycle:{" "}
                <strong>Pending → Approved → Part Dispatch → Dispatched → Closed</strong> (plus
                Rejected/Cancelled).
              </p>
            </div>
            <div className="rounded-md border border-border/50 bg-muted/50 p-3">
              <p className="mb-1 font-medium text-foreground">Primary vs. Secondary Orders</p>
              <p>
                With secondary sales on, an order from a <strong>Level 1</strong> customer — your
                top level, whatever you have named it — is recorded as a Primary sale. Orders from
                every level below are Secondary. A customer with no level yet is recorded as{" "}
                <strong>Direct</strong>, which means &ldquo;not known&rdquo; rather than a real
                position in your chain.
              </p>
            </div>
          </div>
        </div>
      </div>
    </SettingsPanel>
  );
}
