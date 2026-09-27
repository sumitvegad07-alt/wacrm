import { describe, it, expect } from "vitest";
import { cutoffFor, retentionPlan } from "./policy";

describe("cutoffFor", () => {
  it("puts the tracking cutoff one year before today", () => {
    const cutoff = cutoffFor("tracking", new Date("2026-09-27T00:00:00Z"));
    expect(cutoff.toISOString().slice(0, 10)).toBe("2025-09-27");
  });
});

describe("per-account override", () => {
  const now = new Date("2026-09-27T00:00:00Z");

  it("lets one account keep tracking data longer", () => {
    const cutoff = cutoffFor("tracking", now, 730);
    expect(cutoff.toISOString().slice(0, 10)).toBe("2024-09-27");
  });

  it("does not let an override touch machine logs", () => {
    const cutoff = cutoffFor("machine_log", now, 730);
    expect(cutoff.toISOString().slice(0, 10)).toBe("2026-06-29");
  });
});

describe("retentionPlan", () => {
  const now = new Date("2026-09-27T00:00:00Z");

  it("schedules location pings against their own timestamp column", () => {
    const pings = retentionPlan(now).find((j) => j.table === "location_pings");

    expect(pings).toBeDefined();
    expect(pings!.dateColumn).toBe("recorded_at");
    expect(pings!.cutoff.toISOString().slice(0, 10)).toBe("2025-09-27");
  });

  it("refuses to delete a ping until its day has been summarised", () => {
    const pings = retentionPlan(now).find((j) => j.table === "location_pings")!;
    expect(pings.requiresSummary).toBe(true);
  });

  // The guard that matters most. Anyone adding a table to the plan in future
  // has to get past this list, because deleting from any of them would destroy
  // a customer's business records — outstanding balances are derived from
  // orders and payments, and tracking_sessions IS the attendance record.
  it("never schedules business data for deletion", () => {
    const forbidden = [
      "orders",
      "order_items",
      "payments",
      "quotations",
      "expenses",
      "stock_ledger",
      "contacts",
      "products",
      "site_visits",
      "tasks",
      "leads",
      "deals",
      "leaves",
      "tracking_sessions",
      "accounts",
      "profiles",
      "territories",
    ];
    const scheduled = retentionPlan(now).map((j) => j.table);

    for (const table of forbidden) {
      expect(scheduled).not.toContain(table);
    }
  });

  it("gives every job a cutoff in the past", () => {
    for (const job of retentionPlan(now)) {
      expect(job.cutoff.getTime()).toBeLessThan(now.getTime());
    }
  });

  it("applies an account override to tracking but leaves logs alone", () => {
    const jobs = retentionPlan(now, 730);
    const pings = jobs.find((j) => j.table === "location_pings")!;
    const health = jobs.find((j) => j.table === "device_health_snapshots")!;

    expect(pings.cutoff.toISOString().slice(0, 10)).toBe("2024-09-27");
    expect(health.cutoff.toISOString().slice(0, 10)).toBe("2026-06-29");
  });
});
