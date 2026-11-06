import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the "Order not found" class of bug.
 *
 * WHAT HAPPENED (2026-11-05). Migration 20261103160000 added
 * `orders.parent_contact_id uuid REFERENCES contacts(id)` — a perfectly
 * reasonable column, and the SECOND foreign key from `orders` to `contacts`.
 *
 * From that moment PostgREST could no longer tell which relationship
 * `contacts(*)` meant and answered every such request with PGRST201,
 * "Could not embed because more than one relationship was found". The order
 * detail page reads that as `error` and shows "Order not found", so EVERY
 * order 404'd on web; the mobile Orders list embeds the same way, so it came
 * back empty. Two whole screens, dead, from one additive column — and nothing
 * in CI noticed, because neither tsc nor any test looks inside a PostgREST
 * select string.
 *
 * THE RULE. Once two tables are joined by more than one foreign key, every
 * embed between them must name which one, with `!<constraint>`:
 *
 *     .select('*, contacts(*)')                        // ambiguous -> PGRST201
 *     .select('*, contacts!orders_contact_id_fkey(*)') // explicit  -> fine
 *
 * WHEN YOU ADD A SECOND FK between two tables, add the pair below. That is
 * the one manual step, and it is what turns a silent production outage into a
 * failing test.
 *
 * NOTE ON THE MATCHING. The first version of this test scanned line by line
 * and did not catch the real bug, because `.from('orders')` and `.select(...)`
 * sit on different lines. It was only found by re-introducing the bug and
 * watching the test stay green. A guard that has never been seen to fail is
 * not a guard — so `catches a re-introduced bug` below keeps that honest.
 */

/** Table pairs joined by more than one foreign key, so embeds need a hint. */
export const AMBIGUOUS_EMBEDS: { parent: string; child: string; since: string; why: string }[] = [
  {
    parent: "orders",
    child: "contacts",
    since: "20261103160000",
    why: "orders.contact_id (who bought) and orders.parent_contact_id (who supplied them)",
  },
];

const ROOT = join(__dirname, "..", "..");
const EXT = /\.(ts|tsx)$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (EXT.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Un-hinted embeds of `child` that hang off `parent`, as "line:snippet".
 *
 * For each `child(` that is not already written `child!...(`, walk BACK to the
 * nearest `.from('<table>')` — that is the query this embed belongs to. The
 * embed is an offender when that query root is the parent, or when the text
 * between the root and the embed opens a nested `parent(` embed (the
 * `from('order_dispatches').select('*, order:orders(*, contacts(*))')` shape).
 */
export function findAmbiguousEmbeds(text: string, parent: string, child: string): number[] {
  const hits: number[] = [];
  const embed = new RegExp(`(?<![!\\w])${child}\\s*\\(`, "g");
  const from = new RegExp(`\\.from\\(\\s*["'\`](\\w+)["'\`]`, "g");

  // Every query root in the file, with its offset.
  const roots: { at: number; table: string }[] = [];
  for (let m = from.exec(text); m; m = from.exec(text)) roots.push({ at: m.index, table: m[1] });

  for (let m = embed.exec(text); m; m = embed.exec(text)) {
    const at = m.index;
    // `.from('contacts')` is a query root, not an embed.
    if (/\.from\(\s*["'`]$/.test(text.slice(Math.max(0, at - 12), at))) continue;

    let root: { at: number; table: string } | undefined;
    for (const r of roots) if (r.at < at) root = r; else break;
    if (!root) continue;

    const between = text.slice(root.at, at);
    const nested = new RegExp(`(?<![!\\w])${parent}\\s*\\(`).test(between);
    if (root.table === parent || nested) hits.push(at);
  }
  return hits;
}

describe("PostgREST embeds that need disambiguation", () => {
  const files = sourceFiles(ROOT);

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("catches a re-introduced bug", () => {
    // The exact shape that took the order screens down, including the
    // line break between .from() and .select() that defeated version one.
    const broken = `
      const { data: o } = await supabase
        .from('orders')
        .select('*, contacts(*), leads(name)')
        .eq('id', id);
    `;
    expect(findAmbiguousEmbeds(broken, "orders", "contacts")).toHaveLength(1);

    // And the nested form, embedded through another table's query.
    const nested = `.from('order_dispatches').select('*, order:orders(*, contacts(*), leads(*))')`;
    expect(findAmbiguousEmbeds(nested, "orders", "contacts")).toHaveLength(1);

    // The fixed forms must NOT register, or the guard cries wolf.
    const fixed = `.from('orders').select('*, contacts!orders_contact_id_fkey(*), leads(name)')`;
    expect(findAmbiguousEmbeds(fixed, "orders", "contacts")).toHaveLength(0);

    // An embed of contacts from an unrelated table is none of our business.
    const other = `.from('payments').select('*, contacts(*)')`;
    expect(findAmbiguousEmbeds(other, "orders", "contacts")).toHaveLength(0);
  });

  for (const { parent, child, since, why } of AMBIGUOUS_EMBEDS) {
    it(`every ${parent} -> ${child} embed names its foreign key`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        for (const at of findAmbiguousEmbeds(text, parent, child)) {
          const line = text.slice(0, at).split("\n").length;
          offenders.push(`${file.slice(ROOT.length + 1)}:${line}`);
        }
      }

      expect(
        offenders,
        `${parent} and ${child} have had two foreign keys between them since migration ${since} ` +
          `(${why}). An embed that does not say which one fails at runtime with PGRST201, and the ` +
          `screen shows "not found" or an empty list. Write ${child}!${parent}_<column>_fkey(...) ` +
          `instead.\n  ` + offenders.join("\n  "),
      ).toEqual([]);
    });
  }
});
