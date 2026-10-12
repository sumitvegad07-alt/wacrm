/**
 * Turning a table selection into map pins.
 *
 * "Show on map" existed per row only, so an admin who wanted to see where a
 * territory's customers actually sit had to open them one at a time. Splitting
 * the selection is its own step because a real customer list always holds rows
 * with no coordinate yet, and silently dropping them would make the map look
 * like the whole selection when it is not.
 */

/**
 * The geo-tag columns customers and leads share. A narrow cast target, so a
 * caller reading them off its own row type does not have to reach for `any`.
 */
export interface GeoTaggedRow {
  latitude?: number | string | null;
  longitude?: number | string | null;
}

/** One plotted record. `id` is kept so a caller can tie a pin back to its row. */
export interface SelectionPoint {
  id: string;
  title: string;
  lat: number;
  lng: number;
}

export interface SelectionPointAccessors<T> {
  /** Label for the pin tooltip, e.g. company name falling back to person name. */
  titleOf: (row: T) => string | null | undefined;
  latOf: (row: T) => number | string | null | undefined;
  lngOf: (row: T) => number | string | null | undefined;
  /** Defaults to `row.id`. */
  idOf?: (row: T) => string;
}

/** Postgres returns `numeric` as a string, so coordinates arrive either way. */
function toCoord(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split the selected rows into the ones that can be plotted and the names of
 * the ones that cannot. Both lists keep the table's own order, so pin 1 is the
 * first selected row in the list the admin is looking at.
 */
export function splitMappableSelection<T>(
  rows: T[],
  selectedIds: Set<string>,
  accessors: SelectionPointAccessors<T>,
): { points: SelectionPoint[]; skipped: string[] } {
  const idOf = accessors.idOf ?? ((row: T) => (row as T & { id: string }).id);
  const points: SelectionPoint[] = [];
  const skipped: string[] = [];

  if (selectedIds.size === 0) return { points, skipped };

  for (const row of rows) {
    const id = idOf(row);
    if (!selectedIds.has(id)) continue;

    const title = (accessors.titleOf(row) || "").trim() || "Unnamed record";
    const lat = toCoord(accessors.latOf(row));
    const lng = toCoord(accessors.lngOf(row));

    if (lat === null || lng === null) {
      skipped.push(title);
      continue;
    }
    points.push({ id, title, lat, lng });
  }

  return { points, skipped };
}

/**
 * The line shown under a multi-record map, or `null` when the map really is the
 * whole selection and a reassurance would just be noise.
 */
export function mappedSelectionSummary(shown: number, skipped: string[]): string | null {
  if (skipped.length === 0) return null;
  const total = shown + skipped.length;
  const verb = skipped.length === 1 ? "has" : "have";
  return `${shown} of ${total} shown — ${skipped.length} ${verb} no saved location`;
}
