import { describe, expect, it } from "vitest";
import {
  alertsForRow,
  analyseAudit,
  burstAlerts,
  BULK_ROW_THRESHOLD,
  SWEEP_COUNT_THRESHOLD,
  type AuditRow,
} from "./alerts";

function row(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "r1",
    actor_user_id: "u1",
    actor_email: "boss@example.com",
    action: "browse_table",
    table_name: "contacts",
    target_account_id: "acct-1",
    row_count: 10,
    created_at: "2026-08-18T10:00:00.000Z",
    ...over,
  };
}

describe("alertsForRow", () => {
  it("stays quiet for a routine tenant-scoped read", () => {
    expect(alertsForRow(row())).toEqual([]);
  });

  it("flags a cross-tenant read of a sensitive table", () => {
    // The distinguishing signal is target_account_id === null, which the
    // browser records exactly when no tenant filter was applied.
    const alerts = alertsForRow(
      row({ table_name: "profiles", target_account_id: null, row_count: 17 }),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("cross_tenant_sweep");
    expect(alerts[0].severity).toBe("warning");
  });

  it("escalates a cross-tenant sensitive read to critical once it is also bulk", () => {
    const alerts = alertsForRow(
      row({
        table_name: "payments",
        target_account_id: null,
        row_count: BULK_ROW_THRESHOLD,
      }),
    );
    expect(alerts.map((a) => a.kind).sort()).toEqual([
      "bulk_read",
      "cross_tenant_sweep",
    ]);
    expect(alerts.every((a) => a.severity === "critical")).toBe(true);
  });

  it("does not flag a cross-tenant read that returned nothing", () => {
    // An empty result leaked no data; flagging it would train people to ignore
    // the alert list.
    expect(
      alertsForRow(
        row({ table_name: "profiles", target_account_id: null, row_count: 0 }),
      ),
    ).toEqual([]);
  });

  it("treats a bulk read of a non-sensitive table as info, not critical", () => {
    const alerts = alertsForRow(
      row({ table_name: "product_units", row_count: BULK_ROW_THRESHOLD + 1 }),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe("info");
  });

  it("tolerates a null row_count", () => {
    expect(alertsForRow(row({ row_count: null }))).toEqual([]);
  });
});

describe("burstAlerts", () => {
  const burst = (n: number, stepMs: number, actor = "u1"): AuditRow[] =>
    Array.from({ length: n }, (_, i) =>
      row({
        id: `r${i}`,
        actor_user_id: actor,
        table_name: "location_pings",
        created_at: new Date(Date.parse("2026-08-18T10:00:00.000Z") + i * stepMs).toISOString(),
      }),
    );

  it("flags many sensitive reads inside the window", () => {
    const alerts = burstAlerts(burst(SWEEP_COUNT_THRESHOLD, 1000));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe("burst");
  });

  it("stays quiet when the same reads are spread beyond the window", () => {
    // 10 minutes apart — same volume, no burst.
    expect(burstAlerts(burst(SWEEP_COUNT_THRESHOLD, 10 * 60 * 1000))).toEqual([]);
  });

  it("does not aggregate across different actors", () => {
    const mixed = [
      ...burst(SWEEP_COUNT_THRESHOLD - 1, 1000, "u1"),
      ...burst(SWEEP_COUNT_THRESHOLD - 1, 1000, "u2"),
    ];
    expect(burstAlerts(mixed)).toEqual([]);
  });

  it("ignores non-sensitive tables entirely", () => {
    const rows = burst(SWEEP_COUNT_THRESHOLD * 2, 1000).map((r) => ({
      ...r,
      table_name: "product_units",
    }));
    expect(burstAlerts(rows)).toEqual([]);
  });

  it("detects a burst even when rows arrive out of order", () => {
    const rows = burst(SWEEP_COUNT_THRESHOLD, 1000).reverse();
    expect(burstAlerts(rows)).toHaveLength(1);
  });

  it("reports one burst per actor rather than one per row", () => {
    const alerts = burstAlerts(burst(SWEEP_COUNT_THRESHOLD * 3, 500));
    expect(alerts).toHaveLength(1);
  });
});

describe("analyseAudit", () => {
  it("orders critical before warning before info", () => {
    const rows = [
      row({ id: "info", table_name: "product_units", row_count: BULK_ROW_THRESHOLD }),
      row({
        id: "crit",
        table_name: "payments",
        target_account_id: null,
        row_count: BULK_ROW_THRESHOLD,
      }),
      row({ id: "warn", table_name: "profiles", target_account_id: null, row_count: 5 }),
    ];
    expect(analyseAudit(rows).map((a) => a.severity)).toEqual([
      "critical",
      "critical",
      "warning",
      "info",
    ]);
  });

  it("returns nothing for an empty log", () => {
    expect(analyseAudit([])).toEqual([]);
  });
});
