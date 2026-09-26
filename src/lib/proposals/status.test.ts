import { describe, expect, test } from "vitest";
import { isProposalStatus, statusPatch } from "./status";

const NOW = new Date("2026-09-26T10:00:00Z");

describe("statusPatch", () => {
  test("stamps sent_at when a proposal goes out", () => {
    const p = statusPatch("sent", {}, NOW);

    expect(p.status).toBe("sent");
    expect(p.sent_at).toBe(NOW.toISOString());
    expect(p.decided_at).toBeNull();
  });

  test("does not move sent_at when re-marking as sent", () => {
    const original = "2026-09-01T00:00:00.000Z";
    expect(statusPatch("sent", { sent_at: original }, NOW).sent_at).toBe(original);
  });

  test("stamps decided_at on won — that month is the business", () => {
    const p = statusPatch("won", { sent_at: "2026-08-01T00:00:00.000Z" }, NOW);

    expect(p.status).toBe("won");
    expect(p.decided_at).toBe(NOW.toISOString());
    expect(p.sent_at).toBe("2026-08-01T00:00:00.000Z");
  });

  test("stamps decided_at on lost too, so win rate has both sides", () => {
    expect(statusPatch("lost", {}, NOW).decided_at).toBe(NOW.toISOString());
  });

  test("records that a deal went out even when won straight from draft", () => {
    expect(statusPatch("won", { sent_at: null }, NOW).sent_at).toBe(NOW.toISOString());
  });

  test("clears both timestamps when pulled back to draft", () => {
    const p = statusPatch("draft", { sent_at: "2026-08-01T00:00:00.000Z" }, NOW);

    expect(p.sent_at).toBeNull();
    expect(p.decided_at).toBeNull();
  });
});

describe("isProposalStatus", () => {
  test("accepts the four real statuses", () => {
    for (const s of ["draft", "sent", "won", "lost"]) {
      expect(isProposalStatus(s)).toBe(true);
    }
  });

  test("rejects anything else", () => {
    expect(isProposalStatus("WON")).toBe(false);
    expect(isProposalStatus("deleted")).toBe(false);
    expect(isProposalStatus(null)).toBe(false);
  });
});
