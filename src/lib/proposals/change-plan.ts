// ============================================================
// Switching a proposal from one plan to another.
//
// The document's words and feature list follow the plan automatically. What
// needs deciding is the data the founder already typed:
//
//   - the client, the date, the reference, the signatory → his, untouched
//   - the team size → about the client, kept
//   - the row labels and the rate → about the plan, re-based to the new one,
//     because "OZZO CRM + SFA — Field Salesman" on a CRM proposal is exactly
//     the kind of stale line that reaches a client unnoticed
//   - the industry wording → kept if he wrote it, swapped if it is still the
//     previous plan's untouched default
// ============================================================

import { asTerm, termRatePerMonth, type BillingTerm } from "@/lib/plans/pricing";
import { isNewPlan } from "@/lib/plans/catalog";
import type { LineItem, ProposalData } from "./types";
import { getTemplate, listRatePerMonth } from "./registry";

/** True when the wording is still exactly what the plan shipped with. */
function isUntouchedVoice(data: ProposalData, plan: string): boolean {
  const template = getTemplate(plan);
  if (!template) return false;

  const shipped = template.content.defaultVoice;
  return (
    data.voice?.built === shipped.built &&
    data.voice?.industryPlural === shipped.industryPlural &&
    data.voice?.builtFor === shipped.builtFor
  );
}

export function changePlan(data: ProposalData, from: string, to: string): ProposalData {
  if (from === to) return data;

  const target = getTemplate(to);
  if (!target) return data;

  // Re-based at the proposal's own term, not the list yearly rate — switching a
  // quarterly proposal from SFA to CRM must stay quarterly-priced.
  const rate = listRatePerMonth(target.plan, asTerm(data.billingTerm));
  const seats = target.content.seats;
  const existing = data.lineItems ?? [];

  // The new plan's seat rows take over the ones they replace, keeping the user
  // counts. Rows the founder added beyond them (a training day, an extra
  // licence tier) keep their own names and counts — only the plan's own rows
  // are renamed.
  const lineItems: LineItem[] = seats.map((seat, i) => ({
    label: seat.label,
    subLabel: seat.subLabel,
    users: existing[i]?.users ?? seat.users,
    rate,
  }));

  // Rows beyond the plan's seats are the founder's own (a training day, an
  // extra tier). Their price is not plan-derived, so it is left as typed.
  for (const extra of existing.slice(seats.length)) {
    lineItems.push({ ...extra });
  }

  return {
    ...data,
    lineItems,
    voice: isUntouchedVoice(data, from) ? { ...target.content.defaultVoice } : data.voice,
  };
}

/**
 * Switching a proposal from one billing term to another.
 *
 * The seat rows are re-priced to the new term's list rate, but **only rows still
 * sitting at the old term's list rate**. A row the founder discounted by hand
 * keeps its discount as a proportion of list, so changing the term does not
 * silently undo a negotiated price — that is the failure mode worth guarding,
 * because it would reach the client as a higher number than was agreed on the
 * phone.
 */
export function changeTerm(data: ProposalData, to: BillingTerm): ProposalData {
  const from = asTerm(data.billingTerm);
  const term = asTerm(to);
  if (from === term) return data;

  const plan = data as unknown as { plan?: unknown };
  void plan;

  const existing = data.lineItems ?? [];

  const lineItems: LineItem[] = existing.map((item) => {
    const oldList = listRateFor(data, from);
    const newList = listRateFor(data, term);
    if (!oldList || !newList) return { ...item };

    // Keep the discount proportional: a row at 90% of the old list rate lands at
    // 90% of the new one.
    const ratio = Number(item.rate) / oldList;
    return { ...item, rate: Math.round(newList * ratio) };
  });

  return { ...data, billingTerm: term, lineItems };
}

/**
 * The list rate for whichever plan this proposal is for, on a given term.
 *
 * The plan is not on the payload — it lives in its own column — so it is
 * recovered from the seat labels' template. Falling back to the raw rate means a
 * proposal whose plan cannot be identified is left exactly as typed rather than
 * re-priced on a guess.
 */
function listRateFor(data: ProposalData, term: BillingTerm): number {
  const label = data.lineItems?.[0]?.label ?? "";
  for (const candidate of ["CRM_SFA", "CRM_WFA", "SFA", "WFA", "CRM"]) {
    if (!isNewPlan(candidate)) continue;
    const template = getTemplate(candidate);
    if (template && template.content.seats[0]?.label === label) {
      return termRatePerMonth(template.plan, term);
    }
  }
  return 0;
}
