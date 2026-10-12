// ============================================================
// The realism rules. Pure functions, no DB, no randomness of their own —
// so they can be unit-tested, which matters because a wrong curve here is a
// chart that quietly lies rather than an error anyone sees.
//
// Random data reads as fake. A prospect looking at a dashboard believes it when
// the numbers grow, dip on Sundays, spike at Diwali, and rank the reps
// differently. These seven rules are what produce that.
// ============================================================

import { type IstDay, istDow, monthIndex } from "./ist";

// ── 1. Growth ───────────────────────────────────────────────

/** Compounding monthly growth, so every trend chart slopes up. */
const MONTHLY_GROWTH = 0.06; // 6% per month

/**
 * Activity multiplier for a day, relative to the first month of history.
 * Month 0 sits at ~0.56 and month 11 at ~1.0, so the series climbs across the
 * window the Monthly lens shows rather than being flat and random.
 */
export function growthFactor(firstDay: IstDay, day: IstDay, totalMonths: number): number {
  const m = monthIndex(firstDay, day);
  // Normalised so the final month is 1.0 and earlier months are proportionally
  // smaller. Without this the whole dataset would scale with totalMonths.
  return Math.pow(1 + MONTHLY_GROWTH, m - (totalMonths - 1));
}

// ── 2. Festive lift ─────────────────────────────────────────

/**
 * Seasonal multipliers by calendar month (1-based).
 * Diwali (Oct–Nov) is the big one for anything that sells through retail;
 * March lifts everything slightly as the financial year closes.
 */
const FESTIVE_SELLING: Record<number, number> = { 10: 1.35, 11: 1.3, 3: 1.15, 5: 0.9, 6: 0.85 };
const FESTIVE_SERVICE: Record<number, number> = { 4: 1.4, 5: 1.45, 6: 1.2, 3: 1.15, 12: 0.8, 1: 0.75 };

/**
 * `selling` for distribution businesses (FMCG, tiles) — Diwali-led.
 * `service` for appliance service — summer-led, because nobody services an AC
 * in January. A flat seasonal curve on an AC company is the kind of detail a
 * prospect in that trade notices.
 */
export function seasonFactor(month: number, kind: "selling" | "service"): number {
  const table = kind === "service" ? FESTIVE_SERVICE : FESTIVE_SELLING;
  return table[month] ?? 1;
}

// ── 3. Real weeks ───────────────────────────────────────────

/** Sunday is off; Saturday is a short day. */
const DOW_FACTOR: Record<number, number> = { 0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 0.6 };

/**
 * How much work happens on a day, before growth and season.
 * 0 means nothing at all: the rep did not work, so there is no punch, no trail
 * and no visits — which is what makes the attendance report look real.
 */
export function dayOfWeekFactor(day: IstDay, weeklyOffs: number[] = [0]): number {
  const dow = istDow(day);
  if (weeklyOffs.includes(dow)) return 0;
  return DOW_FACTOR[dow] ?? 1;
}

export function isWorkingDay(day: IstDay, weeklyOffs: number[], holidays: Set<string>, key: string): boolean {
  if (holidays.has(key)) return false;
  return dayOfWeekFactor(day, weeklyOffs) > 0;
}

// ── 4. Rep skill spread ─────────────────────────────────────

/**
 * Per-rep output multipliers, in rep order. One star, one laggard, three in
 * between — so "Top Salespeople" and "Top Agents" rank meaningfully and the
 * founder can demo performance management instead of five identical bars.
 */
export const REP_FACTOR = [1.35, 1.15, 1.0, 0.85, 0.7];

export function repFactor(index: number): number {
  return REP_FACTOR[index] ?? 1;
}

// ── 5. Order status mix ─────────────────────────────────────

/**
 * Must match the strings in src/lib/dashboard/sales-queries.ts exactly.
 * `orders.status` has no check constraint in the schema, so a typo here does
 * not raise — it silently drops the order out of the value tiles.
 *
 * Cancelled is last and deliberately small: it has to exist for the status
 * donut to look honest, but it never counts toward value.
 */
export const ORDER_STATUS_MIX: { status: string; weight: number }[] = [
  { status: "Closed", weight: 58 },
  { status: "Dispatched", weight: 14 },
  { status: "Approved", weight: 10 },
  { status: "Part Dispatch", weight: 9 },
  { status: "Pending", weight: 5 },
  { status: "Cancelled", weight: 4 },
];

/** Pick a status from the mix given a uniform roll in [0,1). */
export function statusFor(roll: number): string {
  const total = ORDER_STATUS_MIX.reduce((s, x) => s + x.weight, 0);
  let acc = 0;
  const target = roll * total;
  for (const x of ORDER_STATUS_MIX) {
    acc += x.weight;
    if (target < acc) return x.status;
  }
  return ORDER_STATUS_MIX[0].status;
}

/**
 * Recent orders skew unfinished, old orders are settled — a year-old order
 * still sitting at "Pending" would read as abandoned data. Orders older than
 * 45 days are forced to a terminal status.
 */
export function agedStatus(status: string, ageInDays: number): string {
  if (ageInDays <= 45) return status;
  if (status === "Pending" || status === "Approved" || status === "Part Dispatch") {
    return "Closed";
  }
  return status;
}

/**
 * Days before an approval queue item must have been dealt with.
 *
 * A year-old expense claim still sitting at "Pending" does not read as a busy
 * approver — it reads as abandoned data, and it inflates the dashboard's
 * "Awaiting Approval" tile into the dozens. Anything older than this is forced
 * to a terminal status, so the queue only ever holds genuinely recent items.
 */
export const APPROVAL_SETTLES_AFTER_DAYS = 18;

/** Resolve a Pending status that is too old to still be pending. */
export function settledIfStale(
  status: string,
  ageInDays: number,
  resolvedTo: string,
): string {
  if (status !== "Pending") return status;
  return ageInDays > APPROVAL_SETTLES_AFTER_DAYS ? resolvedTo : status;
}

// ── 6. Money that does not reconcile perfectly ──────────────

/** Fraction of a customer's closed order value that has actually been collected. */
export const COLLECTION_BAND: [number, number] = [0.7, 0.95];
/** Share of customers deliberately left badly overdue, so Ageing has a red bucket. */
export const OVERDUE_CUSTOMER_SHARE = 0.15;
/** Share of payments left awaiting approval. */
export const PAYMENT_PENDING_SHARE = 0.08;

// ── 7. Battery ──────────────────────────────────────────────

/**
 * Battery percentage across the working day, floored at 40%.
 *
 * The floor is not cosmetic. `loadWorkforceMetrics` averages each agent's
 * *latest* ping, and the daily cron writes the whole day up front — so a
 * realistic 95%→15% drain would make the dashboard read "Average Battery 15%"
 * at nine in the morning: a fleet of dying phones. 95%→40% reads as a normal
 * day's use at every hour.
 */
export function batteryAt(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return Math.round(95 - clamped * 55);
}

// ── Linkage rules ───────────────────────────────────────────

/** Share of visits that produce an order — drives the "productive visits" chart. */
export const PRODUCTIVE_VISIT_SHARE = 0.45;
/** Share of visits where the rep also collects money. */
export const COLLECTION_VISIT_SHARE = 0.3;
/** Days after an order is placed before it is dispatched. */
export const DISPATCH_LAG_DAYS: [number, number] = [2, 9];

// ── Composite ───────────────────────────────────────────────

export interface DayWeightInput {
  day: IstDay;
  firstDay: IstDay;
  totalMonths: number;
  weeklyOffs: number[];
  holidays: Set<string>;
  dayKey: string;
  seasonKind: "selling" | "service";
  repIndex: number;
}

/**
 * The single number the generators multiply a base volume by. Zero on a
 * non-working day, which is what stops a rep from logging visits on a Sunday.
 */
export function dayWeight(input: DayWeightInput): number {
  const dow = dayOfWeekFactor(input.day, input.weeklyOffs);
  if (dow === 0 || input.holidays.has(input.dayKey)) return 0;
  return (
    dow *
    growthFactor(input.firstDay, input.day, input.totalMonths) *
    seasonFactor(input.day.m, input.seasonKind) *
    repFactor(input.repIndex)
  );
}
