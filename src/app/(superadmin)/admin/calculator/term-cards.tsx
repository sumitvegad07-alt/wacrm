// ============================================================
// The answer to the question that actually gets asked on a call:
// "CRM + SFA, five users — what is it for 3, 6 and 12 months?"
//
// All three terms, for one chosen plan, side by side. It used to take a tab
// change and a plan picker the founder could not find, so the first screen
// looked like it was quoting one fixed price. Every figure here re-prices from
// the shared engine in lib/plans/pricing.ts on every keystroke.
//
// Pure: no hooks, no router, no state. That is what lets it be rendered and
// asserted on in a test.
// ============================================================

import { inr } from "@/lib/proposals/format";
import { PLAN_LABEL, type PlanId } from "@/lib/plans/catalog";
import {
  TERM_LABEL,
  TERM_MONTHS,
  compareTerms,
  type BillingTerm,
} from "@/lib/plans/pricing";

export interface TermCardsProps {
  plan: PlanId;
  users: number;
  discountPct: number;
  gstEnabled: boolean;
  /** Highlighted as the term being quoted. */
  selectedTerm: BillingTerm;
  /** Omitted in tests and anywhere the cards are read-only. */
  onPick?: (term: BillingTerm) => void;
}

export function TermCards({
  plan,
  users,
  discountPct,
  gstEnabled,
  selectedTerm,
  onPick,
}: TermCardsProps) {
  const rows = compareTerms({ plan, users, discountPct, gstRate: gstEnabled ? 18 : 0 });

  return (
    <div>
      <h2 className="text-sm font-semibold text-foreground">
        {PLAN_LABEL[plan]} · {users} {users === 1 ? "user" : "users"}
        {discountPct > 0 ? ` · ${discountPct}% off` : ""}
      </h2>
      <p className="text-xs text-muted-foreground mt-0.5 mb-3">
        What one invoice costs on each billing term,{" "}
        {gstEnabled ? "including 18% GST" : "with no GST"}. Click a term to quote it.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {rows.map((r) => {
          const payable = gstEnabled ? r.total : r.net;
          const selected = r.term === selectedTerm;

          return (
            <button
              key={r.term}
              type="button"
              onClick={onPick ? () => onPick(r.term) : undefined}
              className={`text-left rounded-xl border p-4 transition-colors ${
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border bg-card hover:bg-muted/40"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-foreground">
                  {TERM_LABEL[r.term]}
                </span>
                <span className="text-xs text-muted-foreground">{TERM_MONTHS[r.term]} months</span>
              </div>

              <p className="text-2xl font-bold text-foreground mt-2 tabular-nums">
                ₹{inr(payable)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                per invoice{gstEnabled ? ", incl GST" : ", no GST"}
              </p>

              <dl className="mt-3 pt-3 border-t border-border space-y-1 text-xs">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Rate</dt>
                  <dd className="text-foreground tabular-nums">
                    ₹{inr(r.ratePerMonth)}/user/mo
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Over 12 months</dt>
                  <dd className="text-foreground tabular-nums">₹{inr(r.annualised)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">They save</dt>
                  <dd
                    className={
                      r.savingVsQuarterly > 0
                        ? "text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums"
                        : "text-muted-foreground"
                    }
                  >
                    {r.savingVsQuarterly > 0 ? `₹${inr(r.savingVsQuarterly)}` : "—"}
                  </dd>
                </div>
              </dl>
            </button>
          );
        })}
      </div>
    </div>
  );
}
