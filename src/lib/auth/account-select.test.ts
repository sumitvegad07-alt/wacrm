import { describe, expect, it, vi } from "vitest";
import { ACCOUNT_COLUMNS_BASE, ACCOUNT_COLUMNS_FULL, selectAccountRow } from "./account-select";

describe("selectAccountRow", () => {
  it("retries once without the DMS columns on 42703", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "42703", message: "column accounts.addon_lines does not exist" } })
      .mockResolvedValueOnce({ data: { id: "a" }, error: null });
    const r = await selectAccountRow(run);
    expect(r.data).toEqual({ id: "a" });
    expect(run.mock.calls.map((c) => c[0])).toEqual([ACCOUNT_COLUMNS_FULL, ACCOUNT_COLUMNS_BASE]);
    expect(ACCOUNT_COLUMNS_BASE).not.toMatch(/addon_lines|portal_seats_limit/);
  });

  it("retries on the message alone when no code is relayed", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "column accounts.portal_seats_limit does not exist" } })
      .mockResolvedValueOnce({ data: { id: "a" }, error: null });
    await selectAccountRow(run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry other errors (RLS, network)", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: { code: "42501", message: "permission denied" } });
    const r = await selectAccountRow(run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(r.error.code).toBe("42501");
  });

  it("does not retry on success", async () => {
    const run = vi.fn().mockResolvedValue({ data: { id: "a" }, error: null });
    await selectAccountRow(run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
