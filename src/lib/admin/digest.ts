// ============================================================
// Audit digest.
//
// The alerting built earlier is computed on page load, and nobody watches a
// page. This turns it into something that arrives: a daily or weekly summary
// of what happened across the platform.
//
// Composition is a pure function over already-fetched rows so the shape of the
// digest is testable without a scheduler, a mailbox, or a clock.
// ============================================================

import { analyseAudit, type AuditAlert, type AuditRow } from "./alerts";

export type DigestPeriod = "daily" | "weekly";

export const PERIOD_HOURS: Record<DigestPeriod, number> = {
  daily: 24,
  weekly: 24 * 7,
};

export interface DigestInput {
  period: DigestPeriod;
  generatedAt: string;
  auditRows: AuditRow[];
  newTenants: { id: string; name: string; created_at: string }[];
  deletedTenants: { id: string; name: string; deleted_at: string }[];
  stuckEvents: number;
  failedEvents: number;
  criticalTenants: { name: string; reason: string }[];
}

export interface DigestSection {
  title: string;
  lines: string[];
  /** Sections with nothing to report are dropped, not rendered as "0". */
  severity: "info" | "warn" | "critical";
}

export interface Digest {
  period: DigestPeriod;
  generatedAt: string;
  headline: string;
  sections: DigestSection[];
  alerts: AuditAlert[];
  /** True when nothing at all happened — callers may skip sending. */
  quiet: boolean;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function composeDigest(input: DigestInput): Digest {
  const sections: DigestSection[] = [];
  const alerts = analyseAudit(input.auditRows);

  const exports = input.auditRows.filter((r) => r.action === "csv_export");
  const criticalAlerts = alerts.filter((a) => a.severity === "critical");

  if (criticalAlerts.length > 0) {
    sections.push({
      title: "Suspicious access",
      severity: "critical",
      lines: criticalAlerts.slice(0, 10).map((a) => a.message),
    });
  }

  // Exports are called out separately even when they trip no alert: data
  // leaving the system is worth seeing every time, not only when it is large.
  if (exports.length > 0) {
    sections.push({
      title: "Data exports",
      severity: "warn",
      lines: exports.map(
        (e) =>
          `${e.actor_email ?? "superadmin"} exported ${plural(e.row_count ?? 0, "row")} from ${e.table_name ?? "?"}`,
      ),
    });
  }

  if (input.stuckEvents > 0 || input.failedEvents > 0) {
    const lines: string[] = [];
    if (input.stuckEvents > 0) {
      lines.push(
        `${plural(input.stuckEvents, "event")} enqueued but never attempted — the queue is not being consumed`,
      );
    }
    if (input.failedEvents > 0) {
      lines.push(`${plural(input.failedEvents, "event")} failed`);
    }
    sections.push({
      title: "Sync health",
      // A stalled queue is worse than individual failures: it means nothing is
      // running at all.
      severity: input.stuckEvents > 0 ? "critical" : "warn",
      lines,
    });
  }

  if (input.criticalTenants.length > 0) {
    sections.push({
      title: "Tenants needing attention",
      severity: "warn",
      lines: input.criticalTenants
        .slice(0, 15)
        .map((t) => `${t.name}: ${t.reason}`),
    });
  }

  if (input.newTenants.length > 0) {
    sections.push({
      title: "New tenants",
      severity: "info",
      lines: input.newTenants.map((t) => t.name),
    });
  }

  if (input.deletedTenants.length > 0) {
    sections.push({
      title: "Deleted tenants",
      severity: "info",
      lines: input.deletedTenants.map((t) => t.name),
    });
  }

  const quiet = sections.length === 0;

  const headline = quiet
    ? `Nothing to report (${input.period})`
    : criticalAlerts.length > 0 || input.stuckEvents > 0
      ? `Needs attention: ${plural(criticalAlerts.length + (input.stuckEvents > 0 ? 1 : 0), "issue")}`
      : `${plural(sections.reduce((n, s) => n + s.lines.length, 0), "item")} to review`;

  return {
    period: input.period,
    generatedAt: input.generatedAt,
    headline,
    sections,
    alerts,
    quiet,
  };
}

/** Plain-text rendering, suitable for email or a chat message. */
export function renderDigestText(digest: Digest): string {
  const header = [
    `WACRM ${digest.period} operations digest`,
    new Date(digest.generatedAt).toUTCString(),
    "",
    digest.headline,
  ];

  if (digest.quiet) return header.join("\n");

  const body = digest.sections.flatMap((s) => [
    "",
    `${s.severity === "critical" ? "[!] " : ""}${s.title}`,
    ...s.lines.map((l) => `  - ${l}`),
  ]);

  return [...header, ...body].join("\n");
}
