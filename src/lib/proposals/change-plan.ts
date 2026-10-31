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

/**
 * Plans in the order a row label must be tested against them.
 *
 * Compound plans first: "OZZO CRM" is a prefix of "OZZO CRM + SFA", so testing
 * CRM early would claim every CRM + SFA row for the wrong plan.
 */
const PLAN_MATCH_ORDER = ["CRM_SFA", "CRM_WFA", "SFA", "WFA", "CRM"] as const;

/** The plan a price row belongs to, or null when it is a row the founder added. */
function planOfRow(label: string): string | null {
  for (const candidate of PLAN_MATCH_ORDER) {
    if (!isNewPlan(candidate)) continue;
    const template = getTemplate(candidate);
    const prefix = template?.content.seatLabelPrefix;
    if (prefix && (label ?? "").startsWith(prefix)) return candidate;
  }
  return null;
}

/**
 * How many leading rows are the PLAN's own, rather than the founder's.
 *
 * Counted by label rather than assumed to be the first `seats.length` rows:
 * the packs ship one seat row since 31 October 2026, and a proposal saved
 * before that has two. Taking only the first would leave the second behind as
 * a stale "— Admin / Manager" line on a document for a different plan.
 */
function planRowCount(lineItems: LineItem[]): number {
  let n = 0;
  for (const item of lineItems ?? []) {
    if (planOfRow(item?.label ?? "") === null) break;
    n += 1;
  }
  return n;
}

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
  const planRows = planRowCount(existing);

  // The new plan's seat rows take over the ones they replace, keeping the user
  // counts, each row's own period and its dates. Rows the founder added beyond
  // them (a training day, an extra licence tier) keep their own names and
  // counts — only the plan's own rows are renamed.
  const lineItems: LineItem[] = seats.map((seat, i) => {
    const from = existing[i];

    // Plan rows the target has no seat for are folded into the last seat
    // rather than dropped: a proposal written when the packs shipped a field
    // row and an admin row must not silently lose the admin seats.
    const surplus =
      i === seats.length - 1
        ? existing
            .slice(seats.length, planRows)
            .reduce((sum, row) => sum + (Number(row?.users) || 0), 0)
        : 0;

    return {
      label: seat.label,
      subLabel: seat.subLabel,
      users: (from?.users ?? seat.users) + surplus,
      rate,
      // The period is about the deal, not the plan, so it survives the switch.
      ...(from?.months === undefined ? {} : { months: from.months }),
      ...(from?.periodStart ? { periodStart: from.periodStart } : {}),
      ...(from?.periodEnd ? { periodEnd: from.periodEnd } : {}),
    };
  });

  // Rows beyond the plan's own are the founder's (a training day, an extra
  // tier). Their price is not plan-derived, so they are left exactly as typed.
  for (const extra of existing.slice(Math.max(seats.length, planRows))) {
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
 * recovered from the first row's label. Matching is by PREFIX, so a proposal
 * saved when the packs shipped two seat rows still resolves. Falling back to 0
 * means a proposal whose plan cannot be identified is left exactly as typed
 * rather than re-priced on a guess.
 */
function listRateFor(data: ProposalData, term: BillingTerm): number {
  const plan = planOfRow(data.lineItems?.[0]?.label ?? "");
  const template = plan ? getTemplate(plan) : undefined;
  return template ? termRatePerMonth(template.plan, term) : 0;
}
