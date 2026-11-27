import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_COLUMNS_BASE,
  ACCOUNT_COLUMNS_FULL,
  ACCOUNT_COLUMNS_LATEST,
  selectAccountRow,
} from "./account-select";

describe("selectAccountRow", () => {
  it("steps down one rung when only the newest column is missing", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42703", message: "column accounts.custom_features does not exist" },
      })
      .mockResolvedValueOnce({ data: { id: "a" }, error: null });
    const r = await selectAccountRow(run);
    expect(r.data).toEqual({ id: "a" });
    expect(run.mock.calls.map((c) => c[0])).toEqual([
      ACCOUNT_COLUMNS_LATEST,
      ACCOUNT_COLUMNS_FULL,
    ]);
  });

  it("keeps the DMS columns when custom_features is the only one missing", async () => {
    // The regression this ladder exists to prevent: one missing column must not
    // cost the account addon_lines as well, or the live DMS goes dark.
    const run = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "42703" } })
      .mockResolvedValueOnce({ data: { id: "a", addon_lines: ["dms"] }, error: null });
    const r = await selectAccountRow(run);
    expect(r.data.addon_lines).toEqual(["dms"]);
    expect(run.mock.calls[1][0]).toMatch(/addon_lines/);
  });

  it("falls all the way to BASE on a pre-DMS schema", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "42703" } })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "42703", message: "column accounts.addon_lines does not exist" },
      })
      .mockResolvedValueOnce({ data: { id: "a" }, error: null });
    const r = await selectAccountRow(run);
    expect(r.data).toEqual({ id: "a" });
    expect(run.mock.calls.map((c) => c[0])).toEqual([
      ACCOUNT_COLUMNS_LATEST,
      ACCOUNT_COLUMNS_FULL,
      ACCOUNT_COLUMNS_BASE,
    ]);
    expect(ACCOUNT_COLUMNS_BASE).not.toMatch(/addon_lines|portal_seats_limit|custom_features/);
    expect(ACCOUNT_COLUMNS_FULL).not.toMatch(/custom_features/);
  });

  it("retries on the message alone when no code is relayed", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "column accounts.portal_seats_limit does not exist" },
      })
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

  it("returns the last error rather than hanging when every rung is refused", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: { code: "42703" } });
    const r = await selectAccountRow(run);
    expect(run).toHaveBeenCalledTimes(3);
    expect(r.error.code).toBe("42703");
  });
});
