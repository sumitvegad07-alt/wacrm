// ============================================================
// The numbers behind the forecasting dashboard.
//
// Pure arithmetic over the stored proposals, so the figures the founder plans
// around are tested rather than assembled inside a chart component.
//
// Two rules worth knowing:
//   - A month is an Indian month. The server runs in UTC, so bucketing on the
//     raw timestamp would book a deal closed at 1am IST into the previous
//     month (the same class of bug as the DSR's "0 visits").
//   - A win rate from a handful of proposals is noise. Below
//     MIN_DECIDED_FOR_WIN_RATE decided proposals the rate — and anything
//     derived from it — is withheld rather than shown as false precision.
// ============================================================

import { TERM_MONTHS, asTerm } from "@/lib/plans/pricing";

/** Below this many decided proposals, a win rate means nothing. */
export const MIN_DECIDED_FOR_WIN_RATE = 5;

/** How far ahead renewals are projected, and how far back history is shown. */
const WINDOW_MONTHS = 12;

export interface ForecastRow {
  id: string;
  status: string;
  /** What ONE invoice charges, incl. GST if charged. Normalised before use. */
  grand_total: number;
  users_total: number;
  proposal_date: string;
  decided_at: string | null;
  /** Missing on proposals written before terms existed — read as yearly. */
  billing_term?: string | null;
}

/**
 * The period every money figure on the dashboard is expressed in.
 *
 * Without this, a quarterly proposal's ₹12,600 sat beside a yearly one's ₹36,000
 * as though the second were nearly three times the business. Picking a basis
 * restates every deal on the same footing, whichever way the founder wants to
 * read the book.
 */
export type ForecastBasis = "monthly" | "quarterly" | "half_yearly" | "yearly";

export const FORECAST_BASES: readonly ForecastBasis[] = [
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
] as const;

export const BASIS_MONTHS: Record<ForecastBasis, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

export const BASIS_LABEL: Record<ForecastBasis, string> = {
  monthly: "Per month",
  quarterly: "Per quarter",
  half_yearly: "Per half-year",
  yearly: "Per year",
};

/**
 * One deal's value restated in the chosen period.
 *
 * `grand_total` is what a single invoice charges, so a quarterly deal's figure
 * covers three months and a yearly deal's covers twelve. Dividing by the deal's
 * own term and multiplying by the basis is what makes the two comparable.
 *
 * Yearly basis on a yearly deal returns the stored number untouched, which is
 * what the dashboard showed before a basis existed.
 */
export function valueOn(row: ForecastRow, basis: ForecastBasis): number {
  const termMonths = TERM_MONTHS[asTerm(row.billing_term)];
  return round2((num(row.grand_total) / termMonths) * BASIS_MONTHS[basis]);
}

export interface MonthBucket {
  month: string;
  won: number;
  lost: number;
  wonCount: number;
}

export interface RenewalBucket {
  month: string;
  value: number;
  count: number;
}

export interface ForecastSummary {
  /** The period every money figure below is expressed in. */
  basis: ForecastBasis;
  wonThisMonth: { count: number; value: number };
  pipeline: { count: number; value: number };
  wonTotal: number;
  decidedCount: number;
  hasEnoughHistory: boolean;
  /** null until there is enough decided history to mean anything. */
  winRate: number | null;
  /** Pipeline value × win rate, or null for the same reason. */
  weightedPipeline: number | null;
  avgWonValue: number;
  avgWonUsers: number;
  monthly: MonthBucket[];
  renewals: RenewalBucket[];
  renewalTotal: number;
}

const MONTH_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
});

/** "2026-09" for an instant, read in Indian time. */
function monthKey(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  // en-CA yields yyyy-mm-dd; with only year+month parts it yields yyyy-mm.
  return MONTH_FMT.format(d).slice(0, 7);
}

/** Month arithmetic on "YYYY-MM" keys, with no timezone involved. */
function addMonths(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function summarise(
  rows: ForecastRow[],
  now: Date = new Date(),
  basis: ForecastBasis = "yearly",
): ForecastSummary {
  const all = rows ?? [];
  const thisMonth = monthKey(now);
  const value = (r: ForecastRow) => valueOn(r, basis);

  const won = all.filter((r) => r.status === "won");
  const lost = all.filter((r) => r.status === "lost");
  const sent = all.filter((r) => r.status === "sent");

  const wonThisMonthRows = won.filter(
    (r) => r.decided_at && monthKey(r.decided_at) === thisMonth,
  );

  const decidedCount = won.length + lost.length;
  const hasEnoughHistory = decidedCount >= MIN_DECIDED_FOR_WIN_RATE;
  const winRate = hasEnoughHistory ? won.length / decidedCount : null;

  const pipelineValue = round2(sent.reduce((sum, r) => sum + value(r), 0));

  // ── Last WINDOW_MONTHS months, oldest first, ending with the current one ──
  const monthly: MonthBucket[] = [];
  for (let i = WINDOW_MONTHS - 1; i >= 0; i--) {
    monthly.push({ month: addMonths(thisMonth, -i), won: 0, lost: 0, wonCount: 0 });
  }
  const monthIndex = new Map(monthly.map((b, i) => [b.month, i]));

  for (const r of won) {
    if (!r.decided_at) continue;
    const i = monthIndex.get(monthKey(r.decided_at));
    if (i === undefined) continue;
    monthly[i].won = round2(monthly[i].won + value(r));
    monthly[i].wonCount += 1;
  }
  for (const r of lost) {
    if (!r.decided_at) continue;
    const i = monthIndex.get(monthKey(r.decided_at));
    if (i === undefined) continue;
    monthly[i].lost = round2(monthly[i].lost + value(r));
  }

  // ── Renewals: a subscription comes round again one TERM after it was won, not
  //    always a year — a quarterly deal renews in three months. Projecting
  //    everything at twelve months (as this did before terms existed) would hide
  //    every quarterly renewal due this quarter.
  const renewals: RenewalBucket[] = [];
  for (let i = 1; i <= WINDOW_MONTHS; i++) {
    renewals.push({ month: addMonths(thisMonth, i), value: 0, count: 0 });
  }
  const renewalIndex = new Map(renewals.map((b, i) => [b.month, i]));

  for (const r of won) {
    if (!r.decided_at) continue;
    const i = renewalIndex.get(
      addMonths(monthKey(r.decided_at), TERM_MONTHS[asTerm(r.billing_term)]),
    );
    if (i === undefined) continue;
    renewals[i].value = round2(renewals[i].value + value(r));
    renewals[i].count += 1;
  }

  const wonTotal = round2(won.reduce((sum, r) => sum + value(r), 0));
  const wonUsers = won.reduce((sum, r) => sum + num(r.users_total), 0);

  return {
    basis,
    wonThisMonth: {
      count: wonThisMonthRows.length,
      value: round2(wonThisMonthRows.reduce((sum, r) => sum + value(r), 0)),
    },
    pipeline: { count: sent.length, value: pipelineValue },
    wonTotal,
    decidedCount,
    hasEnoughHistory,
    winRate,
    weightedPipeline: winRate === null ? null : round2(pipelineValue * winRate),
    avgWonValue: won.length ? round2(wonTotal / won.length) : 0,
    avgWonUsers: won.length ? Math.round(wonUsers / won.length) : 0,
    monthly,
    renewals,
    renewalTotal: round2(renewals.reduce((sum, b) => sum + b.value, 0)),
  };
}
