import { beforeEach, describe, expect, test, vi } from "vitest";
import { formatCell, readListPayload, stashListPayload } from "./list-payload";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

const payload = {
  title: "Orders",
  columns: [{ key: "no", label: "Order #" }],
  rows: [{ no: "SO-1" }],
  total: 1,
  truncated: false,
  printedAt: "2026-10-26T10:00:00.000Z",
};

describe("list payload hand-off", () => {
  test("a stashed payload reads back identically", () => {
    const key = stashListPayload(payload);
    expect(readListPayload(key)).toEqual(payload);
  });

  test("each stash gets its own key, so two print tabs cannot collide", () => {
    expect(stashListPayload(payload)).not.toBe(stashListPayload(payload));
  });

  test("an unknown key gives null rather than throwing", () => {
    expect(readListPayload("nope")).toBeNull();
  });

  test("corrupt stored JSON gives null rather than throwing", () => {
    store.set("wacrm_print_list_x", "{not json");
    expect(readListPayload("wacrm_print_list_x")).toBeNull();
  });

  // Private windows and blocked site data make these throw rather than
  // return. A print that cannot be prepared must not take the page down.
  test("a storage that throws does not take the caller down", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => stashListPayload(payload)).not.toThrow();
    expect(readListPayload("anything")).toBeNull();
  });
});

describe("formatCell", () => {
  // Paper has no empty-cell affordance, so a blank must look deliberate.
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

  // Export CSV formats a date column this way, and the same list must not
  // print a raw ISO string on paper while the spreadsheet shows a real date.
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
