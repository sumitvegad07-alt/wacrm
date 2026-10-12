import { describe, expect, it, vi } from "vitest";
import { fetchAllPages, EXPORT_CHUNK, EXPORT_MAX_ROWS } from "./export-all-pages";
import type { ServerTableQuery, SupabaseBrowserClient } from "./server-query";

const supa = {} as SupabaseBrowserClient;
const noFilters = { search: "", filters: {} };

/** A fake server holding `total` rows, answering any `.range()` honestly. */
function serverWith(total: number) {
  return vi.fn(async (_s: SupabaseBrowserClient, { from, to }: { from: number; to: number }) => {
    const last = Math.min(to, total - 1);
    const length = Math.max(0, last - from + 1);
    return {
      data: Array.from({ length }, (_, i) => ({ id: from + i })),
      count: total,
      error: null,
    };
  }) as unknown as ServerTableQuery<{ id: number }> & { mock: { calls: unknown[] } };
}

describe("fetchAllPages", () => {
  it("walks every chunk until it has the whole result", async () => {
    const total = 2500;
    const query = serverWith(total);

    const { rows, truncated } = await fetchAllPages(supa, query, noFilters);

    expect(rows).toHaveLength(total);
    expect(truncated).toBe(false);
    expect(query.mock.calls).toHaveLength(Math.ceil(total / EXPORT_CHUNK));
  });

  it("handles a result that is exactly one chunk", async () => {
    const query = serverWith(EXPORT_CHUNK);
    const { rows, truncated } = await fetchAllPages(supa, query, noFilters);
    expect(rows).toHaveLength(EXPORT_CHUNK);
    expect(truncated).toBe(false);
  });

  it("handles an empty result without looping", async () => {
    const query = serverWith(0);
    const { rows, truncated } = await fetchAllPages(supa, query, noFilters);
    expect(rows).toEqual([]);
    expect(truncated).toBe(false);
    expect(query.mock.calls).toHaveLength(1);
  });

  it("stops at the safety cap and says it was truncated", async () => {
    const query = serverWith(EXPORT_MAX_ROWS + 5000);

    const { rows, truncated } = await fetchAllPages(supa, query, noFilters);

    expect(rows).toHaveLength(EXPORT_MAX_ROWS);
    expect(truncated).toBe(true);
  });

  it("throws on a failed chunk rather than exporting half a file", async () => {
    const query = (async () => ({
      data: null,
      count: 10,
      error: { message: "boom" },
    })) as unknown as ServerTableQuery<{ id: number }>;

    await expect(fetchAllPages(supa, query, noFilters)).rejects.toThrow("boom");
  });

  it("passes the current search and filters to every chunk", async () => {
    const query = serverWith(1500);
    await fetchAllPages(supa, query, { search: "sharma", filters: { status: "Closed" } });

    for (const call of query.mock.calls as [unknown, { search: string; filters: unknown }][]) {
      expect(call[1]).toMatchObject({ search: "sharma", filters: { status: "Closed" } });
    }
  });

  it("reports progress as it goes", async () => {
    const query = serverWith(1500);
    const onProgress = vi.fn();

    await fetchAllPages(supa, query, noFilters, onProgress);

    expect(onProgress).toHaveBeenCalledWith(1000, 1500);
    expect(onProgress).toHaveBeenCalledWith(1500, 1500);
  });
});
