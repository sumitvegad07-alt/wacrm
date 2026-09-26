// ============================================================
// Plan line → proposal template.
//
// SFA is the only template today. CRM and WFA proposals are a new entry here
// plus their own pages component — not a second builder, which is why the form,
// the storage and the print route all read the plan from the row.
// ============================================================

import type { ProposalData, ProposalFieldGroup, ProposalPlan } from "./types";
import { SFA_GROUPS, sfaDefaults } from "./templates/sfa/defaults";

export interface ProposalTemplate {
  plan: ProposalPlan;
  label: string;
  groups: ProposalFieldGroup[];
  defaults: (proposalDate: string) => ProposalData;
}

const TEMPLATES: ProposalTemplate[] = [
  {
    plan: "SFA",
    label: "OZZO SFA — Sales Force Automation",
    groups: SFA_GROUPS,
    defaults: sfaDefaults,
  },
];

export function getTemplate(plan: string): ProposalTemplate | undefined {
  return TEMPLATES.find((t) => t.plan === plan);
}

export function listTemplates(): ProposalTemplate[] {
  return TEMPLATES;
}

/** Reads "client.shortName" out of the payload, so the form needs no per-field wiring. */
export function getByPath(data: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[key];
    return undefined;
  }, data);
}

/** Immutable counterpart, so React state updates never mutate the loaded payload. */
export function setByPath<T>(data: T, path: string, value: unknown): T {
  const [key, ...rest] = path.split(".");
  const node = (data ?? {}) as Record<string, unknown>;

  return {
    ...node,
    [key]: rest.length === 0 ? value : setByPath(node[key] ?? {}, rest.join("."), value),
  } as T;
}
