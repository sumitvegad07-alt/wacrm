import { describe, expect, it } from "vitest";
import {
  bySeverity,
  DORMANT_DAYS,
  GPS_STALL_HOURS,
  healthLevel,
  signalsFor,
  summarise,
  type TenantHealth,
} from "./health";

const NOW = Date.parse("2026-08-18T12:00:00.000Z");
const DAY = 86_400_000;
const HOUR = 3_600_000;

function tenant(over: Partial<TenantHealth> = {}): TenantHealth {
  return {
    account_id: "a1",
    name: "Acme",
    subscription_plan: "Pro",
    subscription_status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    user_count: 3,
    last_login_at: new Date(NOW - DAY).toISOString(),
    contacts: 10,
    orders: 5,
    payments: 2,
    payments_total: 1000,
    records_last_7d: 4,
    last_ping_at: new Date(NOW - HOUR).toISOString(),
    open_sessions: 0,
    last_device_report: null,
    failed_automations: 0,
    stalled_flows: 0,
    ...over,
  };
}

describe("signalsFor", () => {
  it("is quiet for a healthy, active tenant", () => {
    expect(signalsFor(tenant(), NOW)).toEqual([]);
    expect(healthLevel(signalsFor(tenant(), NOW))).toBe("ok");
  });

  it("reports no_users and stops, rather than also calling it dormant", () => {
    // An account with no profiles never had anyone to go dormant. Emitting both
    // would double-count the same tenant in the fleet summary.
    const signals = signalsFor(tenant({ user_count: 0, last_login_at: null }), NOW);
    expect(signals).toHaveLength(1);
    expect(signals[0].code).toBe("no_users");
  });

  it("distinguishes never-activated from dormant", () => {
    const never = signalsFor(tenant({ last_login_at: null }), NOW);
    expect(never[0].code).toBe("never_activated");

    const dormant = signalsFor(
      tenant({ last_login_at: new Date(NOW - (DORMANT_DAYS + 1) * DAY).toISOString() }),
      NOW,
    );
    expect(dormant[0].code).toBe("dormant");
    expect(dormant[0].level).toBe("critical");
  });

  it("flags a tenant that logs in but creates nothing", () => {
    const signals = signalsFor(tenant({ records_last_7d: 0 }), NOW);
    expect(signals.map((s) => s.code)).toContain("idle");
  });

  it("does not flag idle when the tenant is already dormant", () => {
    // Dormant is the stronger statement; reporting both is noise.
    const signals = signalsFor(
      tenant({
        last_login_at: new Date(NOW - (DORMANT_DAYS + 5) * DAY).toISOString(),
        records_last_7d: 0,
      }),
      NOW,
    );
    expect(signals.map((s) => s.code)).toEqual(["dormant"]);
  });

  it("flags stalled GPS only for tenants that have ever pinged", () => {
    const stalled = signalsFor(
      tenant({ last_ping_at: new Date(NOW - (GPS_STALL_HOURS + 1) * HOUR).toISOString() }),
      NOW,
    );
    expect(stalled.map((s) => s.code)).toContain("gps_stalled");

    // A tenant not using field tracking must not be flagged for absent GPS.
    const noTracking = signalsFor(tenant({ last_ping_at: null }), NOW);
    expect(noTracking.map((s) => s.code)).not.toContain("gps_stalled");
  });

  it("flags an open tracking session whose pings have gone quiet", () => {
    const signals = signalsFor(
      tenant({
        open_sessions: 2,
        last_ping_at: new Date(NOW - (GPS_STALL_HOURS + 2) * HOUR).toISOString(),
      }),
      NOW,
    );
    expect(signals.map((s) => s.code)).toContain("session_stuck");
  });

  it("does not flag an open session that is still pinging", () => {
    const signals = signalsFor(tenant({ open_sessions: 1 }), NOW);
    expect(signals.map((s) => s.code)).not.toContain("session_stuck");
  });

  it("treats automation failures as critical and stalled flows as info", () => {
    expect(signalsFor(tenant({ failed_automations: 3 }), NOW)[0].level).toBe("critical");
    expect(signalsFor(tenant({ stalled_flows: 2 }), NOW)[0].level).toBe("info");
  });

  it("tolerates an unparseable timestamp without crashing", () => {
    expect(() => signalsFor(tenant({ last_login_at: "not-a-date" }), NOW)).not.toThrow();
  });
});

describe("summarise", () => {
  it("counts each tenant once, at its worst level", () => {
    const fleet = [
      tenant({ account_id: "ok" }),
      tenant({ account_id: "warn", records_last_7d: 0 }),
      tenant({ account_id: "crit", failed_automations: 1 }),
      tenant({ account_id: "empty", user_count: 0, last_login_at: null }),
    ];
    const s = summarise(fleet, NOW);
    expect(s.total).toBe(4);
    expect(s.ok).toBe(1);
    expect(s.warn).toBe(2); // idle + no_users
    expect(s.critical).toBe(1);
    expect(s.ok + s.info + s.warn + s.critical).toBe(s.total);
  });

  it("counts never-activated tenants as inactive for commercial metrics", () => {
    const s = summarise(
      [
        tenant({ user_count: 0, last_login_at: null }),
        tenant({ last_login_at: null }),
        tenant(),
      ],
      NOW,
    );
    expect(s.inactive).toBe(2);
  });

  it("handles an empty fleet", () => {
    expect(summarise([], NOW)).toMatchObject({ total: 0, ok: 0, critical: 0 });
  });
});

describe("bySeverity", () => {
  it("puts the worst tenants first and breaks ties by name", () => {
    const fleet = [
      tenant({ name: "Zeta" }),
      tenant({ name: "Alpha", failed_automations: 1 }),
      tenant({ name: "Beta", records_last_7d: 0 }),
      tenant({ name: "Acme" }),
    ];
    expect(bySeverity(fleet, NOW).map((t) => t.name)).toEqual([
      "Alpha", // critical
      "Beta", // warn
      "Acme", // ok, alphabetical
      "Zeta",
    ]);
  });

  it("does not mutate the input array", () => {
    const fleet = [tenant({ name: "B" }), tenant({ name: "A", failed_automations: 1 })];
    const copy = [...fleet];
    bySeverity(fleet, NOW);
    expect(fleet).toEqual(copy);
  });
});
