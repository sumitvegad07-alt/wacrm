import { planLines, type ProductLine } from '@/lib/plans/catalog';

/** True if the account's plan grants the product line a template belongs to. */
export function templateLineAllowed(plan: unknown, productLine: ProductLine): boolean {
  return planLines(plan)[productLine];
}
