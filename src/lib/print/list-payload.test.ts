import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  formatCell,
  PRINT_TTL_MS,
  readListPayload,
  stashListPayload,
  type ListPrintPayload,
} from "./list-payload";

/**
 * A stand-in for the browser's localStorage, including `length` and `key(i)`.
 *
 * The previous version of these tests stubbed only getItem/setItem, which is
 * what let the real bug through: the code used sessionStorage, the print tab
 * is opened with `noopener` and so never received it, and nothing here could
 * tell. This stub is shared between "tabs" exactly as localStorage really is.
 */
function makeStore(opts: { failWrites?: boolean } = {}) {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.failWrites) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

const payload: ListPrintPayload = {
  title: "Orders",
  columns: [{ key: "no", label: "Order #" }],
  rows: [{ no: "SO-1" }],
  total: 1,
  truncated: false,
  printedAt: "2026-10-26T10:00:00.000Z",
};

beforeEach(() => {
  vi.useRealTimers();
  vi.stubGlobal("localStorage", makeStore());
});

describe("list payload hand-off", () => {
  test("a stashed payload reads back identically", () => {
    const key = stashListPayload(payload)!;
    expect(readListPayload(key)).toEqual(payload);
  });

  // The actual bug: the print tab is a separate tab with no opener. It must
  // be able to read what the list tab wrote, which is what localStorage does
  // and sessionStorage does not.
  test("it is written somewhere another tab can read", () => {
    const store = makeStore();
    vi.stubGlobal("localStorage", store);
    const key = stashListPayload(payload)!;

    // A different tab: same localStorage, no opener, no sessionStorage.
    vi.stubGlobal("sessionStorage", makeStore());
    expect(readListPayload(key)).toEqual(payload);
  });

  test("reloading the print tab still works — the read is not one-shot", () => {
    const key = stashListPayload(payload)!;
    expect(readListPayload(key)).toEqual(payload);
    expect(readListPayload(key)).toEqual(payload);
  });

  test("each stash gets its own key, so two print tabs cannot collide", () => {
    expect(stashListPayload(payload)).not.toBe(stashListPayload(payload));
  });

  test("an unknown key gives null rather than throwing", () => {
    expect(readListPayload("nope")).toBeNull();
  });

  test("corrupt stored JSON gives null rather than throwing", () => {
    localStorage.setItem("wacrm_print_list_1_x", "{not json");
    expect(readListPayload("wacrm_print_list_1_x")).toBeNull();
  });

  // Printed lists are big and worthless once printed. Left alone they would
  // pile up until they blocked the next print.
  test("old stashes are cleared out on the next write", () => {
    const store = makeStore();
    vi.stubGlobal("localStorage", store);
    const stale = `wacrm_print_list_${Date.now() - PRINT_TTL_MS - 1000}_old`;
    store.map.set(stale, "{}");

    stashListPayload(payload);

    expect(store.getItem(stale)).toBeNull();
  });

  test("only a few recent stashes are kept", () => {
    const store = makeStore();
    vi.stubGlobal("localStorage", store);
    for (let i = 0; i < 6; i++) stashListPayload(payload);
    expect(store.length).toBeLessThanOrEqual(3);
  });

  // A list too big for the browser's quota must be reported, not turned into
  // a print tab that can only say the link expired.
  test("a list that cannot be stored returns null instead of a dead key", () => {
    vi.stubGlobal("localStorage", makeStore({ failWrites: true }));
    expect(stashListPayload(payload)).toBeNull();
  });

  test("storage blocked outright is null, not a crash", () => {
    vi.stubGlobal("localStorage", {
      get length() {
        throw new Error("blocked");
      },
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(stashListPayload(payload)).toBeNull();
    expect(readListPayload("anything")).toBeNull();
  });
});

describe("formatCell", () => {
  test("empty values print as a dash", () => {
    expect(formatCell(null)).toBe("—");
    expect(formatCell(undefined)).toBe("—");
    expect(formatCell("")).toBe("—");
  });

  test("zero and false are values, not blanks", () => {
    expect(formatCell(0)).toBe("0");
    expect(formatCell(false)).toBe("No");
  });

  test("numbers and booleans print readably", () => {
    expect(formatCell(1250.5)).toBe("1250.5");
    expect(formatCell(true)).toBe("Yes");
  });

  test("a joined record prints its name, never [object Object]", () => {
    expect(formatCell({ name: "Priya" })).toBe("Priya");
    expect(formatCell({ full_name: "Rahul" })).toBe("Rahul");
    expect(formatCell({ title: "Big deal" })).toBe("Big deal");
    expect(formatCell({ unexpected: 1 })).not.toContain("[object");
  });

  test("an array of joined records prints them all", () => {
    expect(formatCell([{ name: "A" }, { name: "B" }])).toBe("A, B");
  });

  test("a date column prints as a date, like the CSV export", () => {
    const out = formatCell("2026-10-26T00:00:00.000Z", "date");
    expect(out).toBe(new Date("2026-10-26T00:00:00.000Z").toLocaleDateString());
    expect(out).not.toContain("T00:00");
  });

  test("an unparseable date falls through instead of printing Invalid Date", () => {
    expect(formatCell("not a date", "date")).toBe("not a date");
  });

  test("an empty date column is still a dash", () => {
    expect(formatCell(null, "date")).toBe("—");
  });
});
