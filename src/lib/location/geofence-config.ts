// accounts.settings -> 'geo_fencing', read the same way everywhere.
//
// One parent switch with two independent sub-switches:
//
//   enabled            parent. Off == no fencing of any kind.
//     visit_enabled      fence visit check-in / check-out (the 2026-09-10 feature).
//                        ABSENT == true, so tenants already fencing visits are
//                        untouched by the arrival of the sub-switch.
//     attendance_enabled fence punch-in / punch-out against Attendance Locations.
//                        ABSENT == false, so no tenant gains a punch fence on deploy.
//
// They are deliberately not mutually exclusive: plenty of tenants want both.
//
// The two defaults above are the whole backward-compatibility contract of this
// feature and are covered by geofence-config.test.ts. The SQL triggers in
// 20260927180000_geofence_attendance_v1.sql apply the identical defaults.

/** The five radii an admin may choose, shared by both fences. */
export const FENCE_RADII = [50, 100, 250, 500, 1000] as const;
export type FenceRadius = (typeof FENCE_RADII)[number];

/** Which punch events a single Attendance Location fences. */
export type FenceScope = "punch_in" | "punch_out" | "both";

export const FENCE_SCOPE_LABEL: Record<FenceScope, string> = {
  punch_in: "Punch In only",
  punch_out: "Punch Out only",
  both: "Punch In and Punch Out",
};

export interface GeoFencingSettings {
  enabled: boolean;
  visit_enabled: boolean;
  attendance_enabled: boolean;
  enforce_check_in: boolean;
  enforce_check_out: boolean;
  radius_m: FenceRadius;
}

export const DEFAULT_GEO_FENCING: GeoFencingSettings = {
  enabled: false,
  visit_enabled: true,
  attendance_enabled: false,
  enforce_check_in: true,
  enforce_check_out: false,
  radius_m: 50,
};

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Coerce whatever is in the JSONB into a complete, trustworthy config. */
export function normalizeGeoFencing(raw: unknown): GeoFencingSettings {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const radiusRaw = Number(src.radius_m);
  const radius_m: FenceRadius = (FENCE_RADII as readonly number[]).includes(radiusRaw)
    ? (radiusRaw as FenceRadius)
    : DEFAULT_GEO_FENCING.radius_m;
  return {
    enabled: bool(src.enabled, DEFAULT_GEO_FENCING.enabled),
    visit_enabled: bool(src.visit_enabled, DEFAULT_GEO_FENCING.visit_enabled),
    attendance_enabled: bool(src.attendance_enabled, DEFAULT_GEO_FENCING.attendance_enabled),
    enforce_check_in: bool(src.enforce_check_in, DEFAULT_GEO_FENCING.enforce_check_in),
    enforce_check_out: bool(src.enforce_check_out, DEFAULT_GEO_FENCING.enforce_check_out),
    radius_m,
  };
}

/** Read the config straight off an `accounts` row's settings JSONB. */
export function readGeoFencing(settings: unknown): GeoFencingSettings {
  const s =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  return normalizeGeoFencing(s.geo_fencing);
}

/** Is anything actually blocked on a visit? (On, but enforcing neither end, blocks nothing.) */
export function visitFencingOn(c: GeoFencingSettings): boolean {
  return c.enabled && c.visit_enabled && (c.enforce_check_in || c.enforce_check_out);
}

/**
 * Is attendance fencing live for this account? Whether a given rep is actually
 * fenced also depends on their assigned locations — see
 * wacrm-mobile/src/lib/geo/attendance-fence.ts.
 */
export function attendanceFencingOn(c: GeoFencingSettings): boolean {
  return c.enabled && c.attendance_enabled;
}
