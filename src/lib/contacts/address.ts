/**
 * Joins the parts of a customer address without repeating itself.
 *
 * Found on the Dispatch screen, 2026-11-06, on the founder's own data:
 *
 *   Rajkot West Taluka, Rajkot, Gujarat, 360005, India, Rajkot, Gujarat, India
 *
 * Four screens built the line as
 * `[address, city, state, country].filter(Boolean).join(', ')`, which is right
 * only when `address` holds the street alone. It is a free-text field, and
 * people type the whole address into it — then the territory columns, which
 * 20260916120000 denormalizes onto every contact automatically, get appended a
 * second time. Nobody mistypes it; the app does.
 *
 * So a part is skipped when the line already has it as a comma-separated piece
 * of its own. Compared piece by piece rather than as a substring on purpose:
 * "Rajkot" appears inside "Rajkot West Taluka", and dropping the city because
 * the street is named after it would lose real information.
 */
export function formatAddress(parts: (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of parts) {
    const part = (raw ?? "").trim().replace(/[,\s]+$/, "");
    if (!part) continue;

    // A part may itself be several pieces ("Rajkot, Gujarat, India"). Keep it
    // whole in the output, but remember each piece so a later duplicate of any
    // one of them is dropped.
    const pieces = part.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (pieces.length === 0) continue;

    // Already said, in full? Skip it.
    if (pieces.every((p) => seen.has(p))) continue;

    out.push(part);
    for (const p of pieces) seen.add(p);
  }

  return out.join(", ");
}
