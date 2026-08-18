import { describe, expect, it } from "vitest";
import { composeDigest, renderDigestText, type DigestInput } from "./digest";
import type { AuditRow } from "./alerts";

function auditRow(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "a1",
    actor_user_id: "u1",
    actor_email: "boss@example.com",
    action: "browse_table",
    table_name: "contacts",
    target_account_id: "acct-1",
    row_count: 5,
    created_at: "2026-08-18T10:00:00.000Z",
    ...over,
  };
}

function input(over: Partial<DigestInput> = {}): DigestInput {
  return {
    period: "daily",
    generatedAt: "2026-08-18T12:00:00.000Z",
    auditRows: [],
    newTenants: [],
    deletedTenants: [],
    stuckEvents: 0,
    failedEvents: 0,
    criticalTenants: [],
    ...over,
  };
}

describe("composeDigest", () => {
  it("reports quiet when nothing happened", () => {
    const d = composeDigest(input());
    expect(d.quiet).toBe(true);
    expect(d.sections).toEqual([]);
    expect(d.headline).toContain("Nothing to report");
  });

  it("omits empty sections rather than rendering zeroes", () => {
    // A digest full of "0 exports, 0 failures" trains the reader to skim past
    // the one line that matters.
    const d = composeDigest(input({ newTenants: [{ id: "1", name: "Acme", created_at: "" }] }));
    expect(d.sections.map((s) => s.title)).toEqual(["New tenants"]);
  });

  it("lists every export, even ones too small to trip an alert", () => {
    const d = composeDigest(
      input({
        auditRows: [
          auditRow({ action: "csv_export", table_name: "contacts", row_count: 3 }),
        ],
      }),
    );
    const section = d.sections.find((s) => s.title === "Data exports");
    expect(section).toBeDefined();
    expect(section!.lines[0]).toContain("3 rows from contacts");
  });

  it("uses singular wording for a single row", () => {
    const d = composeDigest(
      input({
        auditRows: [auditRow({ action: "csv_export", row_count: 1 })],
      }),
    );
    expect(d.sections[0].lines[0]).toContain("1 row from");
  });

  it("treats a stalled queue as critical, and plain failures as a warning", () => {
    const stalled = composeDigest(input({ stuckEvents: 39 }));
    expect(stalled.sections.find((s) => s.title === "Sync health")!.severity).toBe(
      "critical",
    );
    expect(stalled.sections[0].lines[0]).toContain("never attempted");

    const failing = composeDigest(input({ failedEvents: 4 }));
    expect(failing.sections.find((s) => s.title === "Sync health")!.severity).toBe(
      "warn",
    );
  });

  it("surfaces cross-tenant sensitive reads as suspicious access", () => {
    const d = composeDigest(
      input({
        auditRows: [
          auditRow({
            table_name: "payments",
            target_account_id: null,
            row_count: 900,
          }),
        ],
      }),
    );
    expect(d.sections[0].title).toBe("Suspicious access");
    expect(d.headline).toContain("Needs attention");
  });

  it("orders critical sections before informational ones", () => {
    const d = composeDigest(
      input({
        stuckEvents: 5,
        newTenants: [{ id: "1", name: "Acme", created_at: "" }],
      }),
    );
    expect(d.sections[0].severity).toBe("critical");
    expect(d.sections[d.sections.length - 1].severity).toBe("info");
  });

  it("caps long lists so the digest stays readable", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      name: `Tenant ${i}`,
      reason: "dormant",
    }));
    const d = composeDigest(input({ criticalTenants: many }));
    expect(d.sections[0].lines.length).toBeLessThanOrEqual(15);
  });
});

describe("renderDigestText", () => {
  it("renders a quiet digest as just the header", () => {
    const text = renderDigestText(composeDigest(input()));
    expect(text).toContain("Nothing to report");
    expect(text).not.toContain("  - ");
  });

  it("marks critical sections in the plain-text output", () => {
    const text = renderDigestText(composeDigest(input({ stuckEvents: 3 })));
    expect(text).toContain("[!] Sync health");
    expect(text).toContain("  - 3 events enqueued but never attempted");
  });

  it("names the period", () => {
    const text = renderDigestText(composeDigest(input({ period: "weekly" })));
    expect(text).toContain("weekly operations digest");
  });
});
