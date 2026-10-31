// ============================================================
// Every figure the proposal prints that is not typed by hand.
//
// The reference document repeats most of them: the term total appears in the
// price table, the savings panel, the "covers everything" heading and the terms
// page, and the per-month rate appears both on the price hero and inside a
// page-6 bullet. Calculating them in one place is the whole reason this builder
// exists — hand-editing is what leaves a proposal quoting two different prices.
//
// A line's `rate` is per user per MONTH and the amount is
// `users × rate × that line's own months`. The DEFAULT months come from the one
// pricing engine in lib/plans/pricing.ts, never from a literal here; a line may
// override it, which is how two users added mid-term are charged for the months
// that actually remain.
// ============================================================

import { TERM_MONTHS, asTerm, type BillingTerm } from "@/lib/plans/pricing";
import type { LineItem, ProposalTotals } from "./types";

/** Blank inputs arrive from the form as "" or undefined; never let that reach the page as NaN. */
function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Money is rounded to paise, so float error never surfaces as ₹359.81999. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Tax is rounded to the rupee — see the note over `gstAmount`. */
function round0(value: number): number {
  return Math.round(value);
}

/**
 * The months a single row is charged for.
 *
 * `fallback` is the document's billing term in months. A row saved before
 * per-row periods existed has no `months` key and reads as the term — which is
 * exactly what every such quotation was charged on, so nothing reprices. A row
 * explicitly set to 0 is honoured as 0 (a free line), because `??` only catches
 * the missing key, not a deliberate zero.
 */
export function lineMonths(item: Pick<LineItem, "months"> | undefined, fallback: number): number {
  // Typed as number, but this comes out of stored JSONB and out of a form
  // input, so an empty string is a real possibility the types do not show.
  const raw = item?.months as unknown;
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function computeTotals(
  lineItems: LineItem[],
  opts: { gstEnabled: boolean; gstRate: number; term?: BillingTerm },
): ProposalTotals {
  const term = asTerm(opts?.term);
  const months = TERM_MONTHS[term];

  const rows = (lineItems ?? []).map((item) => ({
    users: num(item?.users),
    rate: num(item?.rate),
    months: lineMonths(item, months),
  }));

  const lineMonthsList = rows.map((r) => r.months);
  // Rows carrying no users are ignored: an add-on priced but not taken must not
  // make a single-period quotation describe itself as a mixed one.
  const chargedMonths = rows.filter((r) => r.users > 0).map((r) => r.months);
  const mixedMonths = new Set(chargedMonths).size > 1;

  const lineAmounts = rows.map((r) => round2(r.users * r.rate * r.months));
  const usersTotal = rows.reduce((sum, r) => sum + r.users, 0);
  const subtotal = round2(lineAmounts.reduce((sum, amount) => sum + amount, 0));

  // The hero prints one rate, so a differently-priced table needs a single
  // answer: the highest rate anyone is actually being charged. Never understate
  // the price, and ignore rows carrying no users — an add-on priced but not
  // taken must not become the headline.
  const chargedRates = rows.filter((r) => r.users > 0).map((r) => r.rate);
  const headlineRate = chargedRates.length ? Math.max(...chargedRates) : 0;

  // Computed whether or not GST is charged: with GST off the document shows the
  // same figure as the saving ("you save 18%").
  //
  // Whole rupees, matching `quote()` in lib/plans/pricing.ts: the two engines
  // price the same deal, so the proposal and the founder's calculator have to
  // agree to the rupee. Its reasoning holds here too — a proposal that prints
  // "GST @ 18% ₹3,499.2" invites a conversation about twenty paise.
  const gstAmount = round0((subtotal * num(opts?.gstRate)) / 100);
  // Rounded once, on the sum, rather than independently: the page-2 money ladder
  // prints the subtotal, the GST and this, and the three have to add up.
  const grandTotal = round2(subtotal + (opts?.gstEnabled ? gstAmount : 0));

  // Twelve months at the quoted rates, summed per row. Scaling the subtotal by
  // `12 / months` stopped meaning anything once rows could cover different
  // periods; for a quotation whose rows share one period the two agree exactly,
  // which is why no stored proposal's forecast figure moves.
  const annualised = round2(
    rows.reduce((sum, r) => sum + round2(r.users * r.rate * 12), 0),
  );

  return {
    usersTotal,
    months,
    lineMonths: lineMonthsList,
    mixedMonths,
    lineAmounts,
    subtotal,
    gstAmount,
    grandTotal,
    headlineRate,
    perUserPerMonth: Math.round(headlineRate),
    annualised,
  };
}

/**
 * The Investment page is a fixed A4 sheet with `overflow:hidden`, so a long
 * price table does not paginate — it silently clips the terms and the page
 * footer out of the PDF. This is the arithmetic that warns the founder first.
 *
 * MEASURED, not estimated, in a browser at A4 (794 × 1123px) against the
 * fullest sheet the document can produce. Re-measured on 31 October 2026 three
 * times over: when rows gained their own period and a multi-line description,
 * when the terms lost their cards, and again when they became one clause per
 * line. The last change cost nothing — six stacked one-line clauses are a
 * touch SHORTER than two rows of heading-plus-paragraph cards were. Clearance
 * above the page footer, in pixels, with the bank block printing and no Offer:
 *
 *     description lines per row    1      2      3
 *     2 rows, one period        +206   +178   +150
 *     2 rows, all periods       +144   +116    +88
 *     3 rows, one period        +152   +110    +67
 *     3 rows, all periods        +90    +47     +5
 *     4 rows, one period         +98    +41    -16
 *     4 rows, all periods        +35    -21    -78
 *     5 rows, one period         +43    -28    -99
 *     5 rows, all periods        -19    -90   -161
 *
 * Then the blocks BELOW the price table, each measured by adding it to a sheet
 * and re-reading the clearance: the How-to-pay block costs 105px, the signature
 * block 99px, and the Offer box 57px for its heading and first line plus 16px a
 * line after that. None of the three moved when the terms did — they sit above
 * them, in the ladder's own column.
 *
 * Those three are the trap. They come from Invoice Settings and from the Offer
 * box, not from the price table, so a quotation that fitted yesterday clips
 * today because a signature image was uploaded — 98px is nearly two rows. The
 * estimate therefore takes them as inputs rather than assuming them away.
 *
 * The grid is linear, which is why a formula is safe here rather than a lookup
 * table: a row costs 54.5px and every description line after the first 14.2px.
 * BASE_CLEARANCE is the bare sheet — three rows, one description line each, one
 * period, and none of the blocks below — which reproduces every cell above to
 * within 1px, all the browser's own rounding leaves on the table.
 *
 * Anything added to page 2 has to be measured again, not reasoned about.
 */
const BASE_CLEARANCE = 257;
const ROW_COST = 54.5;
const DESCRIPTION_LINE_COST = 14.2;
const ALL_TERMS_COST = 62;
const BANK_BLOCK_COST = 105;
const SIGNATURE_COST = 99;
const OFFER_BOX_COST = 57;
const OFFER_LINE_COST = 16;

/** The row count the measured grid is anchored on. */
const BASE_ROWS = 3;

/**
 * Clearance below which the sheet counts as crowded, in pixels.
 *
 * Not zero. A sheet that only just fits is one font-metric away from clipping
 * on a machine that is not this one, and this page clips in silence.
 */
const SAFE_MARGIN = 8;

/** Everything on page 2 that is not a price row. */
export interface SheetContent {
  showAllTerms: boolean;
  /** Lines in the document-level Offer box. Zero when it is empty. */
  offerLines?: number;
  /** The How-to-pay block, which prints when Invoice Settings has bank details. */
  hasBankBlock?: boolean;
  /** The signature block, which prints when Invoice Settings has an image. */
  hasSignature?: boolean;
}

/**
 * Lines a row costs the sheet BEYOND its first.
 *
 * A row with no description at all is still counted as one line rather than
 * zero: it genuinely saves height, but over-reporting the space left is how a
 * proposal reaches a client with its terms cut off, so the error is taken in
 * the direction that warns too early rather than too late.
 */
export function extraDescriptionLines(lineItems: LineItem[]): number {
  return (lineItems ?? []).reduce((n, item) => {
    const lines = (item?.subLabel ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean).length;

    // A row carrying its own dates prints them as one more line beneath.
    const period = item?.periodStart || item?.periodEnd ? 1 : 0;

    return n + Math.max(0, lines - 1) + period;
  }, 0);
}

/** Pixels of clearance above the page-2 footer. Negative means it clips. */
export function priceSheetClearance(lineItems: LineItem[], content: SheetContent): number {
  const rows = (lineItems ?? []).length;
  const offerLines = Math.max(0, Math.floor(Number(content?.offerLines) || 0));

  return Math.round(
    BASE_CLEARANCE -
      ROW_COST * (rows - BASE_ROWS) -
      DESCRIPTION_LINE_COST * extraDescriptionLines(lineItems) -
      (content?.showAllTerms ? ALL_TERMS_COST : 0) -
      (content?.hasBankBlock ? BANK_BLOCK_COST : 0) -
      (content?.hasSignature ? SIGNATURE_COST : 0) -
      (offerLines > 0 ? OFFER_BOX_COST + OFFER_LINE_COST * (offerLines - 1) : 0),
  );
}

export function isPricePageCrowded(lineItems: LineItem[], content: SheetContent): boolean {
  return priceSheetClearance(lineItems, content) < SAFE_MARGIN;
}

/** The Offer box, counted the way the document prints it: blank lines dropped. */
export function offerLineCount(offer: string | undefined): number {
  return (offer ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}
