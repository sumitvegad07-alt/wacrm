/**
 * What produced a location point. Mirrors the `location_pings.source` check constraint and the
 * mobile `PingSource` type in `wacrm-mobile/lib/location.ts`.
 *
 * Before this existed every row on All Locations / Track Report looked identical and was labelled
 * "Regular", so an admin could not tell a routine 10-minute breadcrumb from the moment a rep
 * actually stood in front of a customer. Those are the points that matter most in a dispute.
 */

export type PingSource =
  | "auto"
  | "punch_in"
  | "punch_out"
  | "visit_check_in"
  | "visit_check_out";

/** Badge colour intent, mapped to the Badge component's variants. */
export type PingSourceTone = "neutral" | "success" | "warning" | "info";

const LABELS: Record<PingSource, { label: string; tone: PingSourceTone }> = {
  auto: { label: "Auto", tone: "neutral" },
  punch_in: { label: "Punch In", tone: "success" },
  punch_out: { label: "Punch Out", tone: "warning" },
  visit_check_in: { label: "Visit Check-In", tone: "info" },
  visit_check_out: { label: "Visit Check-Out", tone: "info" },
};

/** Unknown/missing values fall back to "Auto" — rows written before `source` existed. */
export function pingSourceLabel(source: string | null | undefined): {
  label: string;
  tone: PingSourceTone;
} {
  return LABELS[(source ?? "auto") as PingSource] ?? LABELS.auto;
}

/** True for points a rep deliberately created, as opposed to background breadcrumbs. */
export function isManualPing(source: string | null | undefined): boolean {
  return source === "visit_check_in" || source === "visit_check_out";
}

/** Options for a select filter, in a sensible reading order. */
export const PING_SOURCE_OPTIONS: { label: string; value: PingSource }[] = [
  { label: "Auto", value: "auto" },
  { label: "Punch In", value: "punch_in" },
  { label: "Punch Out", value: "punch_out" },
  { label: "Visit Check-In", value: "visit_check_in" },
  { label: "Visit Check-Out", value: "visit_check_out" },
];
