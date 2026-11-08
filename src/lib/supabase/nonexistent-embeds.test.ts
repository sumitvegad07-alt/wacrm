import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Embeds of a relationship that DOES NOT EXIST.
 *
 * Sibling of ambiguous-embeds.test.ts: same dead screen, opposite cause. That
 * one guards tables joined by TWO foreign keys, where PostgREST refuses to
 * choose (PGRST201). This one guards a join written for a foreign key that was
 * never there at all — PGRST200, "Could not find a relationship between X and Y
 * in the schema cache".
 *
 * WHAT HAPPENED (2026-11-08, found on the iPhone). The payment receipt asked for
 * `payments(*, contacts(*), leads(*), payment_types(name))`. `payments` has
 * `contact_id` and `payment_type_id` and nothing pointing at `leads` — a payment
 * is collected from a customer, and no migration has ever added
 * `payments.lead_id`. PostgREST therefore threw the whole request away, the page
 * read `payment` as null, and it printed **"Payment not found"** about a payment
 * that was open on screen a second earlier. The web print view and the mobile
 * receipt PDF had the identical line, so both were broken for every tenant.
 *
 * THE RULE. A `!<constraint>` hint cannot save this one — there is no key to
 * name — so unlike the ambiguous scanner, this counts a hinted embed as an
 * offender too. Add a pair below whenever a plausible-looking join turns out not
 * to exist in the schema.
 */

export const NO_SUCH_RELATIONSHIP: { parent: string; child: string; why: string }[] = [
  {
    parent: "payments",
    child: "leads",
    why: "payments has contact_id only (migration 20260813170000); a payment is collected from a customer, never from a lead",
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
 * Every place `text` embeds `child` inside a query rooted on `parent`, whether or
 * not a foreign key is named. Returns character offsets.
 */
export function findEmbedsOf(text: string, parent: string, child: string): number[] {
  const hits: number[] = [];
  // `leads(` and `leads!payments_lead_id_fkey(` both count.
  const embed = new RegExp(`(?<![\\w])${child}\\s*(?:![\\w]+)?\\s*\\(`, "g");
  const from = new RegExp(`\\.from\\(\\s*["'\`](\\w+)["'\`]`, "g");

  const roots: { at: number; table: string }[] = [];
  for (let m = from.exec(text); m; m = from.exec(text)) roots.push({ at: m.index, table: m[1] });

  for (let m = embed.exec(text); m; m = embed.exec(text)) {
    const at = m.index;
    // `.from('leads')` is a root, not an embed.
    if (/\.from\(\s*["'`]$/.test(text.slice(Math.max(0, at - 12), at))) continue;

    let root: { at: number; table: string } | undefined;
    for (const r of roots) if (r.at < at) root = r;
    else break;
    if (!root) continue;

    const between = text.slice(root.at, at);
    const nested = new RegExp(`(?<![!\\w])${parent}\\s*\\(`).test(between);
    if (root.table === parent || nested) hits.push(at);
  }
  return hits;
}

describe("PostgREST embeds of relationships that do not exist", () => {
  const files = sourceFiles(ROOT);

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("catches a re-introduced bug", () => {
    // The exact shape that broke the payment receipt.
    const broken = `.from('payments').select('*, contacts(*), leads(*), payment_types(name)')`;
    expect(findEmbedsOf(broken, "payments", "leads")).toHaveLength(1);

    // A named foreign key is no excuse here: the key does not exist.
    const hinted = `.from('payments').select('*, leads!payments_lead_id_fkey(name)')`;
    expect(findEmbedsOf(hinted, "payments", "leads")).toHaveLength(1);

    // Embedding payments FROM leads is a different relationship, not in scope.
    expect(findEmbedsOf(`.from('leads').select('*, payments(*)')`, "payments", "leads")).toHaveLength(0);

    const fixed = `.from('payments').select('*, contacts(*), payment_types(name)')`;
    expect(findEmbedsOf(fixed, "payments", "leads")).toHaveLength(0);
  });

  for (const { parent, child, why } of NO_SUCH_RELATIONSHIP) {
    it(`never embeds ${child} on a ${parent} query`, () => {
      const offenders: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        for (const at of findEmbedsOf(text, parent, child)) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${text.slice(0, at).split("\n").length}`);
        }
      }

      expect(
        offenders,
        `There is no foreign key between ${parent} and ${child} (${why}). PostgREST answers ` +
          `PGRST200 and rejects the WHOLE query, so the page gets null and blames the record for ` +
          `being missing. Drop the ${child} embed.\n  ` +
          offenders.join("\n  "),
      ).toEqual([]);
    });
  }
});
