import type { ReactNode } from "react";

/**
 * A field that survived the form's `renderCustomSystemField` veto, paired with
 * whatever that function returned for it, so the caller never has to ask twice.
 */
export interface VisibleSectionField<F> {
  field: F;
  /** undefined = draw the default input; anything else = draw this instead. */
  customNode: ReactNode | undefined;
}

/**
 * The fields a section will actually paint.
 *
 * The render contract a form relies on is three-way, and the difference between
 * the last two matters (see `custom-fields render contract`):
 *   null      → the form hides this field entirely
 *   undefined → the form has no opinion; draw the default input
 *   a node    → draw that node in place of the default input
 *
 * Resolving the veto up front lets a section ask "will anything show?" before it
 * commits to painting its header, instead of discovering mid-loop that every
 * field opted out and leaving an empty heading behind.
 */
export function visibleSectionFields<F>(
  fields: F[],
  renderCustomSystemField?: (field: F) => ReactNode | null | undefined,
): VisibleSectionField<F>[] {
  const resolved: VisibleSectionField<F>[] = [];

  for (const field of fields) {
    const customNode = renderCustomSystemField ? renderCustomSystemField(field) : undefined;
    if (customNode === null) continue;
    resolved.push({ field, customNode: customNode ?? undefined });
  }

  return resolved;
}
