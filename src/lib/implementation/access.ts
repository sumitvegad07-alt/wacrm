import { planLines, type ProductLine } from '@/lib/plans/catalog';

/** True if the account's plan grants the product line a template belongs to. */
export function templateLineAllowed(plan: unknown, productLine: ProductLine): boolean {
  return planLines(plan)[productLine];
}

/**
 * Line-composed journeys: a step/milestone is shown when it is shared ('core'),
 * has no line yet (null — pre-migration, treat as always-applicable), or its line
 * is granted by the account's plan.
 */
export function stepLineAllowed(line: string | null | undefined, plan: unknown): boolean {
  if (!line || line === 'core') return true;
  const lines = planLines(plan) as Record<string, boolean>;
  return !!lines[line];
}
