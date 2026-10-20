import { describe, expect, test } from "vitest";
import { canTransition, isEditable, isInvoiceStatus, nextStatuses, statusPatch } from "./status";

describe("isInvoiceStatus", () => {
  test("accepts the five real statuses and nothing else", () => {
    expect(isInvoiceStatus("draft")).toBe(true);
    expect(isInvoiceStatus("part_paid")).toBe(true);
    expect(isInvoiceStatus("sent")).toBe(false);
    expect(isInvoiceStatus(null)).toBe(false);
  });
});

describe("canTransition", () => {
  test("a draft may be issued or cancelled", () => {
    expect(canTransition("draft", "issued")).toBe(true);
    expect(canTransition("draft", "cancelled")).toBe(true);
  });

  test("a draft may not jump straight to paid", () => {
    expect(canTransition("draft", "paid")).toBe(false);
  });

  test("an issued invoice may be part paid, paid or cancelled", () => {
    expect(canTransition("issued", "part_paid")).toBe(true);
    expect(canTransition("issued", "paid")).toBe(true);
    expect(canTransition("issued", "cancelled")).toBe(true);
  });

  test("nothing goes back to draft once issued", () => {
    expect(canTransition("issued", "draft")).toBe(false);
    expect(canTransition("part_paid", "draft")).toBe(false);
  });

  test("part paid may finish or be cancelled, but not reopen", () => {
    expect(canTransition("part_paid", "paid")).toBe(true);
    expect(canTransition("part_paid", "cancelled")).toBe(true);
    expect(canTransition("part_paid", "issued")).toBe(false);
  });

  test("paid and cancelled are terminal", () => {
    expect(nextStatuses("paid")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
    expect(canTransition("paid", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "issued")).toBe(false);
  });

  test("a status never transitions to itself", () => {
    expect(canTransition("issued", "issued")).toBe(false);
  });
});

describe("isEditable", () => {
  test("only a draft may be edited — an issued invoice is frozen", () => {
    expect(isEditable("draft")).toBe(true);
    expect(isEditable("issued")).toBe(false);
    expect(isEditable("part_paid")).toBe(false);
    expect(isEditable("paid")).toBe(false);
    expect(isEditable("cancelled")).toBe(false);
  });
});

describe("statusPatch", () => {
  test("marking paid records the whole total and the date", () => {
    expect(statusPatch("paid", 0, 31860, "2026-10-20")).toEqual({
      status: "paid",
      amount_received: 31860,
      paid_at: "2026-10-20",
    });
  });

  test("marking part paid keeps what was received and no paid date", () => {
    expect(statusPatch("part_paid", 10000, 31860, "2026-10-20")).toEqual({
      status: "part_paid",
      amount_received: 10000,
      paid_at: null,
    });
  });

  test("a part payment of the full amount is still recorded as part paid, not guessed", () => {
    // The founder's click is the fact. Promoting it to paid behind his back
    // would stamp a payment date he did not enter.
    expect(statusPatch("part_paid", 31860, 31860, "2026-10-20").status).toBe("part_paid");
  });

  test("a part payment is never more than the total", () => {
    expect(statusPatch("part_paid", 99999, 31860, "2026-10-20").amount_received).toBe(31860);
  });

  test("issuing and cancelling touch no money", () => {
    expect(statusPatch("issued", 0, 31860, "2026-10-20")).toEqual({ status: "issued" });
    expect(statusPatch("cancelled", 0, 31860, "2026-10-20")).toEqual({ status: "cancelled" });
  });
});
