/**
 * Catalog of tracking-health issues: the plain-English cause + the fix an admin can send the
 * agent. Kept as UI copy in TS (not in the database) so it can be reworded without a migration.
 *
 * Each detection in tracking-health.ts emits one of these stable IssueCodes; the UI looks the
 * code up here to render severity, title, cause, and the "message to send the agent".
 */

export type IssueCode =
  | "gps_off"
  | "permission_revoked"
  | "bg_permission_missing"
  | "battery_optimization"
  | "power_save_mode"
  | "phone_died"
  | "os_killed_app"
  | "app_outdated"
  | "mock_location"
  | "not_punched_in"
  | "not_punched_in_late"
  | "device_pending"
  | "no_heartbeat"
  | "unknown_gap";

export type Severity = "high" | "medium" | "info";

export interface IssueMeta {
  severity: Severity;
  title: string;
  /** Why tracking failed, in plain language for the admin. */
  cause: string;
  /** A ready-to-send instruction for the field agent. */
  fix: string;
}

export const ISSUE_CATALOG: Record<IssueCode, IssueMeta> = {
  battery_optimization: {
    severity: "high",
    title: "Battery optimization is on",
    cause:
      "Android is putting the app to sleep in the background, so it stops sending location after a while.",
    fix: "Open Settings → Apps → WACRM → Battery, and set it to 'Unrestricted'. Then punch out and punch in again.",
  },
  bg_permission_missing: {
    severity: "high",
    title: "Background location not allowed",
    cause:
      "Location is only allowed 'while using the app', so tracking stops whenever the app is in the background.",
    fix: "Open Settings → Apps → WACRM → Permissions → Location, and choose 'Allow all the time'.",
  },
  gps_off: {
    severity: "high",
    title: "Location (GPS) was turned off",
    cause: "The phone's location switch was turned off during the shift, so no position could be captured.",
    fix: "Turn Location back on from the quick-settings panel and keep it on during work hours.",
  },
  permission_revoked: {
    severity: "high",
    title: "Location permission was removed",
    cause: "Location permission for the app was revoked during the shift.",
    fix: "Open the app and grant location permission again ('Allow all the time').",
  },
  mock_location: {
    severity: "high",
    title: "Fake/mock GPS detected",
    cause: "One or more positions were reported by a mock-location (fake GPS) app.",
    fix: "Ask the agent to turn off any fake-GPS app and disable 'Mock location' in Developer Options.",
  },
  device_pending: {
    severity: "high",
    title: "Device pending approval",
    cause: "This agent's device hasn't been approved, so they can't punch in and be tracked.",
    fix: "Approve the device in Team → Employees → Manage → Mobile Device Security.",
  },
  power_save_mode: {
    severity: "medium",
    title: "Battery saver is on",
    cause: "Battery-saver mode throttles background location, causing gaps.",
    fix: "Turn off Battery Saver during work hours (Settings → Battery).",
  },
  os_killed_app: {
    severity: "medium",
    title: "The app was closed by the phone",
    cause: "Android shut the app down in the background (often paired with battery optimization).",
    fix: "Set the app's battery usage to 'Unrestricted' and enable Autostart if the phone has it.",
  },
  app_outdated: {
    severity: "medium",
    title: "Running an old app version",
    cause: "The agent's app is behind the latest version and may be missing tracking fixes.",
    fix: "Ask the agent to update to the latest WACRM app version and punch in again.",
  },
  no_heartbeat: {
    severity: "info",
    title: "Device health not reported yet",
    cause: "This agent's app hasn't sent a device-health report — usually an older app build.",
    fix: "Ask the agent to update the app; deeper diagnostics will appear once they do.",
  },
  not_punched_in_late: {
    severity: "high",
    title: "Not punched in — shift has started",
    cause:
      "The working window configured in Organisation Settings has already started, but this agent still hasn't punched in — so nothing about their day is being tracked.",
    fix: "Ask the agent to open the app and Punch In. Nothing is recorded until they do.",
  },
  not_punched_in: {
    severity: "info",
    title: "Not punched in today",
    cause: "No tracking session started today, so no location is expected.",
    fix: "No action needed unless the agent was meant to be on duty.",
  },
  phone_died: {
    severity: "info",
    title: "Phone battery ran out",
    cause: "The battery was very low just before tracking stopped — the phone likely powered off.",
    fix: "Not an app problem. Ask the agent to keep the phone charged during shifts.",
  },
  unknown_gap: {
    severity: "medium",
    title: "Tracking gap (cause unclear)",
    cause: "Location stopped for a while with no clear device reason recorded.",
    fix: "Ask the agent whether the app was open and location was on during this time.",
  },
};

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, info: 2 };

/** Sort issue codes most-severe first (stable within a severity). */
export function sortIssueCodes(codes: IssueCode[]): IssueCode[] {
  return [...codes].sort(
    (a, b) => SEVERITY_RANK[ISSUE_CATALOG[a].severity] - SEVERITY_RANK[ISSUE_CATALOG[b].severity],
  );
}

/** The most severe severity among a set of codes (null if none). */
export function worstSeverity(codes: IssueCode[]): Severity | null {
  if (codes.length === 0) return null;
  return sortIssueCodes(codes).map((c) => ISSUE_CATALOG[c].severity)[0];
}
