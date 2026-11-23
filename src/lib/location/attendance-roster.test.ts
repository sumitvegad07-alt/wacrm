import { describe, expect, it } from "vitest";

import { rosterOrder } from "./attendance-roster";

// The bug, 2026-11-17: the founder added an employee called Ansh and said his
// name did not appear in Location Tracking > Attendance at all.
//
// It did appear — as the LAST row of page 2. The attendance screen read
//
//   supabase.from('profiles').select('id, user_id, full_name, avatar_url')
//
// with no .order(), so rows came back in whatever order Postgres handed them
// over, which is effectively insertion order. A row is rendered for every
// profile whether or not they punched in, the page shows 10 at a time, and the
// account had just crossed from 10 employees to 14. So the newest employee was
// pushed off the first page, behind nine people marked Absent.
//
// That is also why it "used to work": with ten or fewer employees everyone fit
// on page one, and insertion order was invisible.
//
// Team > Employees never had this problem — it has always ordered by full_name.

interface P {
  full_name: string | null;
  email?: string;
}

const names = (rows: P[]) => rows.map((r) => r.full_name);

describe("rosterOrder", () => {
  it("puts a newly added employee in alphabetical place, not last", () => {
    // Exactly the order the database handed back: Ansh was created today, so
    // he arrived last. Alphabetically he is first.
    const fromDb: P[] = [
      { full_name: "sumit vegad" },
      { full_name: "Dhaval Vegad" },
      { full_name: "Kranti" },
      { full_name: "Saurabh" },
      { full_name: "Ansh" },
    ];
    expect(names(rosterOrder(fromDb))[0]).toBe("Ansh");
  });

  it("sorts by name without caring about case", () => {
    const rows: P[] = [
      { full_name: "utsav" },
      { full_name: "Ansh" },
      { full_name: "suvam" },
      { full_name: "Arpit" },
    ];
    expect(names(rosterOrder(rows))).toEqual(["Ansh", "Arpit", "suvam", "utsav"]);
  });

  it("sends nameless rows to the end, never the front", () => {
    // These render as "Unknown". A handful of them sorting first would push
    // every real employee off page one — the same failure in a new costume.
    const rows: P[] = [
      { full_name: null },
      { full_name: "Zara" },
      { full_name: "   " },
      { full_name: "Ansh" },
      { full_name: "" },
    ];
    expect(names(rosterOrder(rows))).toEqual(["Ansh", "Zara", null, "   ", ""]);
  });

  it("breaks ties on email so the order cannot wobble between loads", () => {
    const rows: P[] = [
      { full_name: "Ravi", email: "ravi.b@x.com" },
      { full_name: "Ravi", email: "ravi.a@x.com" },
    ];
    expect(rosterOrder(rows).map((r) => r.email)).toEqual([
      "ravi.a@x.com",
      "ravi.b@x.com",
    ]);
  });

  it("does not mutate the array it was given", () => {
    const rows: P[] = [{ full_name: "B" }, { full_name: "A" }];
    const copy = [...rows];
    rosterOrder(rows);
    expect(rows).toEqual(copy);
  });

  it("handles an empty roster", () => {
    expect(rosterOrder([])).toEqual([]);
  });
});
