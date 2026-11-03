import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `parent_code` on a customer import — "this dealer is supplied by that
 * distributor", given by the distributor's Customer Code.
 *
 * WHY THIS IS A SECOND PASS rather than part of the import itself. The insert
 * lives in `import_commit`, a ~260-line database function that has been
 * redefined eight times and whose live body is known to have diverged from the
 * newest file in the repo — that file carries its own guard refusing to apply
 * unless the live body already has the customer_code changes, and says to
 * export the live body before rebasing. Adding two columns to it blind, with
 * no read access to production, risks silently reverting fixes to task
 * assignees, stock, custom values and territory resolution. Not worth it for
 * one column.
 *
 * The client already holds every row it just sent, so the mapping can be
 * resolved afterwards with ordinary updates — and those go through
 * `trg_enforce_customer_parent`, so an illegal pair is refused by the database
 * exactly as it would be from the form. Nothing is weaker for being a second
 * pass; it is only later.
 *
 * Beat mapping mode skips this entirely: there the database owns `parent_id`
 * from the beat, so writing an imported value would simply be overwritten by
 * the next re-sync, and pretending otherwise would be a lie in the summary.
 */

export type ParentImportRow = Record<string, unknown>;

export interface ParentResolveResult {
  /** Customers given a supplier. */
  mapped: number;
  /** Rows that named a parent code nothing matched. */
  unmatchedParent: string[];
  /** Rows whose own customer could not be found to update. */
  unmatchedChild: string[];
  /** Pairs the database refused, with its reason. */
  refused: { code: string; reason: string }[];
}

function text(row: ParentImportRow, key: string): string {
  const v = row[key];
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

/** Digits only, matching how `contacts.phone_normalized` is generated. */
function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Resolves `parent_code` for rows that carry one.
 *
 * A row identifies its own customer by `customer_code` when it has one, and by
 * phone otherwise — phone being the key the customer importer already dedupes
 * on, so it is the one value every imported customer is guaranteed to have.
 */
export async function resolveImportedParents(
  supabase: SupabaseClient,
  accountId: string,
  rows: readonly ParentImportRow[],
): Promise<ParentResolveResult> {
  const result: ParentResolveResult = {
    mapped: 0,
    unmatchedParent: [],
    unmatchedChild: [],
    refused: [],
  };

  const withParent = rows.filter((r) => text(r, 'parent_code') !== '');
  if (withParent.length === 0) return result;

  const parentCodes = [...new Set(withParent.map((r) => text(r, 'parent_code')))];
  const childCodes = [...new Set(withParent.map((r) => text(r, 'customer_code')).filter(Boolean))];
  const childPhones = [
    ...new Set(withParent.map((r) => digits(text(r, 'phone'))).filter(Boolean)),
  ];

  // One read for every customer either side of the mapping might name.
  const { data, error } = await supabase
    .from('contacts')
    .select('id, customer_code, phone_normalized')
    .eq('account_id', accountId)
    .or(
      [
        childCodes.length || parentCodes.length
          ? `customer_code.in.(${[...childCodes, ...parentCodes].map((c) => `"${c}"`).join(',')})`
          : null,
        childPhones.length ? `phone_normalized.in.(${childPhones.join(',')})` : null,
      ]
        .filter(Boolean)
        .join(','),
    );
  if (error) throw error;

  const byCode = new Map<string, string>();
  const byPhone = new Map<string, string>();
  for (const row of (data ?? []) as {
    id: string;
    customer_code: string | null;
    phone_normalized: string | null;
  }[]) {
    if (row.customer_code) byCode.set(row.customer_code.trim().toLowerCase(), row.id);
    if (row.phone_normalized) byPhone.set(row.phone_normalized, row.id);
  }

  // Group children by the supplier they named, so each supplier costs one
  // update rather than one per dealer.
  const childrenByParent = new Map<string, string[]>();
  for (const row of withParent) {
    const parentCode = text(row, 'parent_code');
    const parentId = byCode.get(parentCode.toLowerCase());
    if (!parentId) {
      result.unmatchedParent.push(parentCode);
      continue;
    }
    const ownCode = text(row, 'customer_code');
    const childId =
      (ownCode ? byCode.get(ownCode.toLowerCase()) : undefined) ??
      byPhone.get(digits(text(row, 'phone')));
    if (!childId) {
      result.unmatchedChild.push(ownCode || text(row, 'phone') || '(unidentified row)');
      continue;
    }
    // A customer supplying themselves is caught here as well as by the
    // database, so the summary can say which code did it.
    if (childId === parentId) {
      result.refused.push({ code: parentCode, reason: 'a customer cannot supply themselves' });
      continue;
    }
    const list = childrenByParent.get(parentId) ?? [];
    list.push(childId);
    childrenByParent.set(parentId, list);
  }

  for (const [parentId, childIds] of childrenByParent) {
    const { error: updateError, count } = await supabase
      .from('contacts')
      .update({ parent_id: parentId }, { count: 'exact' })
      .eq('account_id', accountId)
      .in('id', childIds);
    if (updateError) {
      // The guard refused the whole batch (wrong level, a loop). Retry one at a
      // time so one bad pair does not lose the good ones with it.
      for (const childId of childIds) {
        const { error: oneError } = await supabase
          .from('contacts')
          .update({ parent_id: parentId })
          .eq('account_id', accountId)
          .eq('id', childId);
        if (oneError) {
          result.refused.push({ code: childId, reason: oneError.message });
        } else {
          result.mapped += 1;
        }
      }
      continue;
    }
    result.mapped += count ?? childIds.length;
  }

  return result;
}

/** One line for the import summary, or null when there was nothing to say. */
export function describeParentResolve(r: ParentResolveResult): string | null {
  if (
    r.mapped === 0 &&
    r.unmatchedParent.length === 0 &&
    r.unmatchedChild.length === 0 &&
    r.refused.length === 0
  ) {
    return null;
  }
  const parts: string[] = [];
  if (r.mapped > 0) {
    parts.push(`${r.mapped} customer${r.mapped === 1 ? '' : 's'} given a supplier`);
  }
  const missing = new Set(r.unmatchedParent);
  if (missing.size > 0) {
    parts.push(
      `${missing.size} supplier code${missing.size === 1 ? '' : 's'} not found (${[...missing]
        .slice(0, 3)
        .join(', ')}${missing.size > 3 ? '…' : ''})`,
    );
  }
  if (r.unmatchedChild.length > 0) {
    parts.push(`${r.unmatchedChild.length} row(s) could not be matched back to a customer`);
  }
  if (r.refused.length > 0) {
    parts.push(`${r.refused.length} refused (${r.refused[0].reason})`);
  }
  return parts.join('; ') + '.';
}
