// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TableViewApi } from "@/hooks/use-table-view";
import type { ServerTableArgs, SupabaseBrowserClient } from "@/lib/table/server-query";
import { useServerTable } from "./use-server-table";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

function fakeTableView(overrides: Partial<TableViewApi> = {}): TableViewApi {
  return {
    storageKey: "k",
    filterState: {},
    pageSize: 20,
    setPageSize: vi.fn(),
    ...overrides,
  } as unknown as TableViewApi;
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("useServerTable", () => {
  it("asks for the first page and reports the total", async () => {
    const buildQuery = vi.fn(async (_s: SupabaseBrowserClient, _a: ServerTableArgs) => ({ data: [{ id: "a" }], count: 137, error: null }));
    const { result } = renderHook(() => useServerTable({ tableView: fakeTableView(), buildQuery }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([{ id: "a" }]);
    expect(result.current.total).toBe(137);
    expect(buildQuery.mock.calls[0][1]).toMatchObject({ from: 0, to: 19, search: "" });
  });

  it("asks for the right slice of a later page", async () => {
    const buildQuery = vi.fn(async (_s: SupabaseBrowserClient, _a: ServerTableArgs) => ({ data: [], count: 500, error: null }));
    const { result } = renderHook(() => useServerTable({ tableView: fakeTableView(), buildQuery }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setPage(4);
    });
    await waitFor(() => expect(buildQuery.mock.calls.at(-1)![1]).toMatchObject({ from: 60, to: 79 }));
  });

  it("debounces search and goes back to page 1", async () => {
    const buildQuery = vi.fn(async (_s: SupabaseBrowserClient, _a: ServerTableArgs) => ({ data: [], count: 999, error: null }));
    const { result } = renderHook(() =>
      useServerTable({ tableView: fakeTableView(), buildQuery, searchDebounceMs: 50 }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setPage(3);
    });
    await waitFor(() => expect(buildQuery.mock.calls.at(-1)![1]).toMatchObject({ from: 40 }));

    const callsBefore = buildQuery.mock.calls.length;
    act(() => {
      result.current.setSearch("ab");
    });
    act(() => {
      result.current.setSearch("abc");
    });

    // Still nothing: the debounce has not elapsed.
    expect(buildQuery.mock.calls.length).toBe(callsBefore);

    await waitFor(() => {
      const args = buildQuery.mock.calls.at(-1)![1];
      expect(args.search).toBe("abc");
      expect(args.from).toBe(0);
    });
    // One query for the settled text, not one per keystroke.
    expect(buildQuery.mock.calls.length).toBe(callsBefore + 1);
  });

  it("ignores a slow response that a newer one has already overtaken", async () => {
    type Res = { data: { id: string }[] | null; count: number | null; error: { message: string } | null };
    let resolveFirst: (v: Res) => void = () => {};
    // `count: 999` so page 2 is a real page — a small total would make the
    // clamp effect pull the hook back to page 1 and fire a third query.
    const buildQuery = vi
      .fn<(s: SupabaseBrowserClient, a: ServerTableArgs) => Promise<{ data: { id: string }[] | null; count: number | null; error: { message: string } | null }>>()
      .mockImplementationOnce(
        () =>
          new Promise<Res>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementation(async () => ({ data: [{ id: "new" }], count: 999, error: null }));

    const { result } = renderHook(() => useServerTable({ tableView: fakeTableView(), buildQuery }));
    await act(async () => {
      result.current.setPage(2);
    });
    await waitFor(() => expect(result.current.rows).toEqual([{ id: "new" }]));

    await act(async () => {
      resolveFirst({ data: [{ id: "stale" }], count: 42, error: null });
    });

    expect(result.current.rows).toEqual([{ id: "new" }]);
    expect(result.current.total).toBe(999);
  });

  it("does not query at all while disabled", async () => {
    const buildQuery = vi.fn(async (_s: SupabaseBrowserClient, _a: ServerTableArgs) => ({ data: [], count: 0, error: null }));
    const { result } = renderHook(() =>
      useServerTable({ tableView: fakeTableView(), buildQuery, enabled: false }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(buildQuery).not.toHaveBeenCalled();
  });

  it("clamps to the last page when the total shrinks under it", async () => {
    const buildQuery = vi.fn(async (_s: SupabaseBrowserClient, _a: ServerTableArgs) => ({ data: [], count: 5, error: null }));
    const { result } = renderHook(() => useServerTable({ tableView: fakeTableView(), buildQuery }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.setPage(9);
    });
    await waitFor(() => expect(result.current.page).toBe(1));
  });

  it("surfaces a query error instead of showing stale rows", async () => {
    const buildQuery = vi
      .fn<(s: SupabaseBrowserClient, a: ServerTableArgs) => Promise<{ data: { id: string }[] | null; count: number | null; error: { message: string } | null }>>()
      .mockImplementationOnce(async () => ({ data: [{ id: "a" }], count: 1, error: null }))
      .mockImplementationOnce(async () => ({ data: null, count: null, error: { message: "boom" } }));

    const { result } = renderHook(() => useServerTable({ tableView: fakeTableView(), buildQuery }));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    await act(async () => {
      result.current.reload();
    });
    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.rows).toEqual([]);
  });
});
