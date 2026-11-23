// ============================================================
// The order people appear in on the attendance screens.
//
// 2026-11-17: the founder added an employee called Ansh and reported that his
// name did not show in Location Tracking > Attendance. It did — as the last
// row of page 2. The screen read
//
//   supabase.from('profiles').select('id, user_id, full_name, avatar_url')
//
// with no .order() and no account filter, so rows arrived in whatever order
// Postgres returned them, which is effectively insertion order. The screen
// renders a row for EVERY employee, punched in or not, and pages ten at a
// time. The account had just grown past ten people, so the newest employee was
// pushed off page one behind nine rows marked Absent.
//
// That is also why it had always looked fine: under ten employees everyone fit
// on one page and the missing ORDER BY was invisible. The screen did not break
// — it was always like this, and the account crossed the threshold that shows
// it. Team > Employees never had the problem: it has ordered by full_name
// since it was written.
//
// A SQL `.order('full_name')` is the real fix and is applied at the query. This
// function exists because a sort you can unit-test is a sort that stays fixed,
// and because the three tabs (Punch in, Users, Days/Monthly) all build from the
// same array and must not disagree about who comes first.
// ============================================================

interface RosterRow {
  full_name: string | null;
  email?: string | null;
}

/** Blank, whitespace-only and null names all render as "Unknown". */
function isNameless(name: string | null | undefined): boolean {
  return (name ?? "").trim() === "";
}

/**
 * Employees in the order the attendance tables should list them: by name,
 * case-insensitively, with nameless rows last and ties broken on email so the
 * order cannot wobble between loads.
 *
 * Nameless rows go LAST deliberately. Sorting them first would push every real
 * employee off page one — the same complaint in a different costume.
 *
 * Returns a new array; the input is not touched.
 */
export function rosterOrder<T extends RosterRow>(profiles: readonly T[]): T[] {
  return [...profiles].sort((a, b) => {
    const aBlank = isNameless(a.full_name);
    const bBlank = isNameless(b.full_name);
    if (aBlank !== bBlank) return aBlank ? 1 : -1;
    if (!aBlank) {
      const byName = (a.full_name ?? "").localeCompare(b.full_name ?? "", undefined, {
        sensitivity: "base",
      });
      if (byName !== 0) return byName;
    }
    return (a.email ?? "").localeCompare(b.email ?? "");
  });
}
