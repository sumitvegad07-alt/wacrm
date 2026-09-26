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

import type { LineItem, ProposalData } from "./types";
import { getTemplate } from "./registry";

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

  const rate = target.listRatePerYear;
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
