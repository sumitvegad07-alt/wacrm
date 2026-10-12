import { describe, expect, it } from "vitest";
import { latestVersion, supersededBy, type QuotationVersion } from "./quotation-versions";

function v(partial: Partial<QuotationVersion> & { id: string; version: number }): QuotationVersion {
  return {
    quotation_number: `QT-0001-${partial.version}`,
    status: "Draft",
    date: "2026-10-01",
    total_amount: 1000,
    is_latest_version: false,
    is_active: true,
    parent_id: null,
    created_at: "2026-10-01T00:00:00Z",
    ...partial,
  };
}

const chain: QuotationVersion[] = [
  v({ id: "a", version: 1 }),
  v({ id: "b", version: 2 }),
  v({ id: "c", version: 3, is_latest_version: true }),
];

describe("latestVersion", () => {
  it("picks the version flagged as latest", () => {
    expect(latestVersion(chain)?.id).toBe("c");
  });

  it("falls back to the highest version number when no row carries the flag", () => {
    // Older data: `is_latest_version` was added after versioning shipped, so a
    // chain can exist with the flag unset on every row.
    const unflagged = [v({ id: "a", version: 1 }), v({ id: "b", version: 2 })];
    expect(latestVersion(unflagged)?.id).toBe("b");
  });

  it("returns null for an empty chain", () => {
    expect(latestVersion([])).toBeNull();
  });

  it("ignores a stale flag on an older row and trusts the highest version", () => {
    // Two rows flagged latest means a half-finished write; the newest wins.
    const conflicted = [
      v({ id: "a", version: 1, is_latest_version: true }),
      v({ id: "b", version: 2, is_latest_version: true }),
    ];
    expect(latestVersion(conflicted)?.id).toBe("b");
  });
});

describe("supersededBy", () => {
  it("names the newest version when looking at an older one", () => {
    expect(supersededBy(chain, "a")?.id).toBe("c");
    expect(supersededBy(chain, "b")?.id).toBe("c");
  });

  it("returns null when already on the newest version", () => {
    expect(supersededBy(chain, "c")).toBeNull();
  });

  it("returns null for a quotation that was never versioned", () => {
    expect(supersededBy([v({ id: "solo", version: 1, is_latest_version: true })], "solo")).toBeNull();
  });

  it("returns null for an empty chain, so a failed fetch shows no banner", () => {
    expect(supersededBy([], "a")).toBeNull();
  });
});
