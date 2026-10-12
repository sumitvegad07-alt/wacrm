// ============================================================
// Twelve months of transactional history for a demo tenant.
//
// Rows are built entirely in memory first, with client-generated UUIDs for
// every parent row, then inserted in dependency order. Generating ids locally
// means an order can point at the visit that produced it without a round trip
// per row, which is what keeps a ~25,000-row tenant to a couple of minutes.
//
// Chunk sizes are not uniform, and that is deliberate: `orders` and `payments`
// each fire outstanding-recalculation and notification triggers, so they go in
// hundreds, while pings and line items are cheap and go in bulk. One oversized
// insert on a trigger-heavy table is a single statement that times out at the
// API gateway — the same lesson the customer insert in tenant.ts already
// carries.
//
// Timestamps are built from IST wall-clock readings (see ist.ts) so a row's
// `created_at` and its `date` column always agree about which local day it
// belongs to. The dashboard filters the first and the report engine groups the
// second.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { planLines } from "../plans/catalog";
import {
  addDays,
  daysBetween,
  istDayOf,
  istInstant,
  type IstDay,
  ymd,
} from "./ist";
import {
  COLLECTION_BAND,
  COLLECTION_VISIT_SHARE,
  DISPATCH_LAG_DAYS,
  OVERDUE_CUSTOMER_SHARE,
  PAYMENT_PENDING_SHARE,
  PRODUCTIVE_VISIT_SHARE,
  agedStatus,
  settledIfStale,
  batteryAt,
  dayWeight,
  statusFor,
} from "./shape";
import { FIRM_KIND, FIRM_PREFIX, FIRM_SUFFIX, FIRST_NAMES, LAST_NAMES } from "./profiles";
import { uniqueMaker } from "./rng";
import { insertChunked, type BuiltTenant, type DemoCustomer, type Logger } from "./tenant";

type DB = SupabaseClient<any, any, any>;

const uuid = () => crypto.randomUUID();

export interface HistoryWindow {
  firstDay: IstDay;
  lastDay: IstDay;
}

export interface HistoryOptions {
  window: HistoryWindow;
  /** Raw GPS pings are written only for days within this many days of `lastDay`. */
  pingDays: number;
  /**
   * For `lastDay` only: stop generating at this many minutes past IST midnight.
   * Null writes the whole working day. The daily cron passes null (it runs once
   * and must leave the dashboard complete); `--refresh-now` passes the clock.
   */
  cutoffMinutes: number | null;
  /**
   * Treat every day in the window as a normal working day, ignoring Sunday and
   * the holiday list.
   *
   * The nightly refresh sets this. A demo tenant whose dashboard is blank
   * because the prospect meeting happens to be on a Sunday is worse than a
   * tenant whose calendar is slightly too busy — and the 12-month backfill,
   * which is what the attendance reports are read from, still honours the
   * calendar properly.
   */
  ignoreCalendar?: boolean;
  /**
   * True for the one-off 12-month backfill, false for the daily refresh.
   *
   * Leaves and tasks are not proportional to the window — a rep takes 3–7
   * leaves a *year*, not per run. Generating them on a one-day refresh would
   * add a fresh set every night on top of records the refresh does not clear,
   * so the tenant would accumulate hundreds of leave requests and thousands of
   * tasks. The refresh therefore skips leaves entirely (the pending queue is
   * kept topped up separately) and scales tasks to the days it is writing.
   */
  backfill: boolean;
  log: Logger;
}

export type Counts = Record<string, number>;

// ── Flavour text, by what kind of customer this tenant serves ──

const VISIT_NOTES: Record<string, string[]> = {
  retailer: [
    "Stock check done, reorder for fast movers",
    "Order booked for the coming week",
    "Owner asked for scheme details",
    "Counter display refreshed",
    "Slow movers discussed, replacement agreed",
    "Payment collected against last invoice",
    "Shop closed for lunch, waited and met owner",
    "New SKU introduced, sample left",
  ],
  dealer: [
    "Showroom visit, walked through the new range",
    "Sample tiles handed over for a site",
    "Discussed builder project requirement",
    "Display panel updated with new designs",
    "Outstanding followed up with the accountant",
    "Order finalised after rate negotiation",
    "Site measurement shared by the dealer",
    "Competitor pricing discussed",
  ],
  site: [
    "Housekeeping staff attendance verified",
    "Client walkthrough completed, no complaints",
    "Consumable stock replenished at the site",
    "Supervisor briefed on the new shift roster",
    "Pest control schedule confirmed with the client",
    "Washroom checklist audited",
    "Two staff absent, replacement arranged",
    "Monthly service report handed to the facility manager",
  ],
  household: [
    "AC service completed, cooling checked",
    "Customer requested an AMC quote",
    "Gas pressure low, top-up advised",
    "Indoor unit deep cleaned",
    "Filter replaced, demo given to customer",
    "Outdoor unit relocation discussed",
    "Follow-up visit for a noise complaint",
    "AMC renewal explained to the customer",
  ],
};

const FEEDBACK: [string, number][] = [
  ["Excellent", 30],
  ["Good", 45],
  ["Average", 20],
  ["Poor", 5],
];

const EXPENSE_REMARKS = [
  "Field visit expenses",
  "Market working",
  "Beat coverage",
  "Customer meeting",
  "Monthly claim",
  "Outstation travel",
];

const LEAVE_REASONS = [
  "Family function at home",
  "Not feeling well",
  "Personal work",
  "Medical check-up",
  "Attending a wedding",
  "Child's school programme",
  "Festival at native place",
];

function weighted<T>(items: [T, number][], roll: number): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  const target = roll * total;
  for (const [v, w] of items) {
    acc += w;
    if (target < acc) return v;
  }
  return items[0][0];
}

// ── The per-day plan ────────────────────────────────────────

interface PlannedVisit {
  id: string;
  customer: DemoCustomer;
  repIndex: number;
  checkIn: Date;
  checkOut: Date;
  day: IstDay;
}

interface PlannedSession {
  id: string;
  repIndex: number;
  day: IstDay;
  punchIn: Date;
  punchOut: Date;
  distanceKm: number;
}

/**
 * Build the attendance + visit skeleton for a date range. Everything else
 * (orders, payments, expenses) hangs off this, so it is computed once and
 * shared rather than re-derived per table.
 */
function planDays(
  built: BuiltTenant,
  opts: HistoryOptions,
): { sessions: PlannedSession[]; visits: PlannedVisit[]; workedDays: Map<number, IstDay[]> } {
  const { tenant, reps, customers, masters, rng } = built;
  const days = daysBetween(opts.window.firstDay, opts.window.lastDay);
  const totalMonths = Math.max(
    1,
    (opts.window.lastDay.y - opts.window.firstDay.y) * 12 +
      (opts.window.lastDay.m - opts.window.firstDay.m) +
      1,
  );
  const seasonKind = tenant.key === "wfacrm" ? "service" : "selling";
  const lastKey = ymd(opts.window.lastDay);

  const byRep = new Map<number, DemoCustomer[]>();
  for (const c of customers) {
    const list = byRep.get(c.repIndex) ?? [];
    list.push(c);
    byRep.set(c.repIndex, list);
  }

  const sessions: PlannedSession[] = [];
  const visits: PlannedVisit[] = [];
  const workedDays = new Map<number, IstDay[]>();

  for (const day of days) {
    const dayKey = ymd(day);
    const isLastDay = dayKey === lastKey;
    const cutoff = isLastDay ? opts.cutoffMinutes : null;

    for (const rep of reps) {
      const w = dayWeight({
        day,
        firstDay: opts.window.firstDay,
        totalMonths,
        weeklyOffs: opts.ignoreCalendar ? [] : masters.weeklyOffs,
        holidays: opts.ignoreCalendar ? new Set<string>() : masters.holidays,
        dayKey,
        seasonKind,
        repIndex: rep.index,
      });
      if (w === 0) continue;

      // A rep takes the odd unplanned day off. Without this every attendance
      // report is a perfect grid, which no real company has. Skipped on a
      // forced day, where all five reps should be visible on the live map.
      if (!opts.ignoreCalendar && rng.chance(0.04)) continue;

      const punchInMin = 9 * 60 + 30 + rng.between(-8, 35);
      const punchOutMin = 18 * 60 + rng.between(-20, 55);
      if (cutoff !== null && punchInMin > cutoff) continue;
      const endMin = cutoff !== null ? Math.min(punchOutMin, cutoff) : punchOutMin;
      if (endMin - punchInMin < 45) continue;

      const punchIn = istInstant(day, 0, punchInMin);
      const punchOut = istInstant(day, 0, endMin);

      const eligible = (byRep.get(rep.index) ?? []).filter(
        (c) => c.createdAt.getTime() <= punchOut.getTime(),
      );
      if (eligible.length === 0) continue;

      const sessionId = uuid();
      const base = rng.between(tenant.visitsPerDay[0], tenant.visitsPerDay[1]);
      let want = Math.max(1, Math.round(base * w));
      // A part-day (today, cut off at the clock) gets proportionally fewer.
      if (cutoff !== null) {
        const fullSpan = punchOutMin - punchInMin;
        const haveSpan = endMin - punchInMin;
        want = Math.max(1, Math.round(want * (haveSpan / Math.max(1, fullSpan))));
      }
      want = Math.min(want, eligible.length);

      // Distinct customers, so a rep does not visit the same shop twice a day.
      const chosen: DemoCustomer[] = [];
      const used = new Set<number>();
      for (let i = 0; i < want * 4 && chosen.length < want; i++) {
        const idx = rng.between(0, eligible.length - 1);
        if (used.has(idx)) continue;
        used.add(idx);
        chosen.push(eligible[idx]);
      }

      const slot = (endMin - punchInMin - 40) / Math.max(1, chosen.length);
      chosen.forEach((customer, i) => {
        const at = punchInMin + 25 + Math.round(slot * i) + rng.between(0, 8);
        const dwell = rng.between(12, 45);
        const outMin = Math.min(at + dwell, endMin - 2);
        if (outMin <= at) return;
        visits.push({
          id: uuid(),
          customer,
          repIndex: rep.index,
          checkIn: istInstant(day, 0, at),
          checkOut: istInstant(day, 0, outMin),
          day,
        });
      });

      sessions.push({
        id: sessionId,
        repIndex: rep.index,
        day,
        punchIn,
        punchOut,
        // Roughly 4 km between calls plus a commute, which lands a normal day
        // in the 30–90 km range the Distance tile should show.
        distanceKm: Number((12 + chosen.length * rng.float(3.2, 6.5, 2)).toFixed(1)),
      });

      const list = workedDays.get(rep.index) ?? [];
      list.push(day);
      workedDays.set(rep.index, list);
    }
  }

  return { sessions, visits, workedDays };
}

// ── Main ────────────────────────────────────────────────────

export async function generateHistory(
  db: DB,
  built: BuiltTenant,
  opts: HistoryOptions,
): Promise<Counts> {
  const { tenant, accountId, reps, customers, products, masters, rng } = built;
  const lines = planLines(tenant.plan);
  const log = opts.log;
  const counts: Counts = {};
  const bump = (k: string, n: number) => {
    if (n) counts[k] = (counts[k] ?? 0) + n;
  };

  const repByIndex = new Map(reps.map((r) => [r.index, r]));
  const notes = VISIT_NOTES[tenant.customerKind] ?? VISIT_NOTES.retailer;

  const { sessions, visits, workedDays } = planDays(built, opts);
  log(`    planned ${sessions.length} working days, ${visits.length} visits`);

  // ── Attendance: tracking_sessions ─────────────────────────
  const sessionRows = sessions.map((s) => {
    const rep = repByIndex.get(s.repIndex)!;
    const home = rep.city;
    return {
      id: s.id,
      account_id: accountId,
      user_id: rep.userId, // auth id
      started_at: s.punchIn.toISOString(),
      ended_at: s.punchOut.toISOString(),
      device_id: `demo-${tenant.key}-${s.repIndex + 1}`,
      // Allowed values are manual | timeout | app_killed | logout |
      // auto_midnight. Mostly a clean manual punch-out, with the occasional
      // killed app, which is what a real fleet of Android phones produces.
      end_reason: weighted(
        [
          ["manual", 88],
          ["app_killed", 7],
          ["timeout", 4],
          ["logout", 1],
        ],
        rng.next(),
      ),
      punch_in_lat: Number((home.lat + (rng.next() - 0.5) * 0.01).toFixed(6)),
      punch_in_lng: Number((home.lng + (rng.next() - 0.5) * 0.01).toFixed(6)),
      punch_in_accuracy_m: rng.between(6, 22),
      punch_in_is_mocked: false,
      punch_out_lat: Number((home.lat + (rng.next() - 0.5) * 0.02).toFixed(6)),
      punch_out_lng: Number((home.lng + (rng.next() - 0.5) * 0.02).toFixed(6)),
      punch_out_accuracy_m: rng.between(6, 25),
      punch_out_is_mocked: false,
    };
  });
  await insertChunked(db, "tracking_sessions", sessionRows, 400, "tracking_sessions");
  bump("tracking_sessions", sessionRows.length);

  // ── Daily distance summaries (all 12 months) ──────────────
  // Unique on (account_id, user_id, day), so upsert rather than insert: the
  // daily refresh re-writes today's row every run.
  const summaryRows = sessions.map((s) => {
    const rep = repByIndex.get(s.repIndex)!;
    const pings = Math.max(6, Math.round((s.punchOut.getTime() - s.punchIn.getTime()) / 600_000));
    return {
      account_id: accountId,
      user_id: rep.userId,
      day: ymd(s.day),
      distance_km: s.distanceKm,
      ping_count: pings,
      mocked_count: 0,
      first_at: s.punchIn.toISOString(),
      last_at: s.punchOut.toISOString(),
      first_lat: Number((rep.city.lat + (rng.next() - 0.5) * 0.01).toFixed(6)),
      first_lng: Number((rep.city.lng + (rng.next() - 0.5) * 0.01).toFixed(6)),
      last_lat: Number((rep.city.lat + (rng.next() - 0.5) * 0.02).toFixed(6)),
      last_lng: Number((rep.city.lng + (rng.next() - 0.5) * 0.02).toFixed(6)),
    };
  });
  for (let i = 0; i < summaryRows.length; i += 500) {
    const slice = summaryRows.slice(i, i + 500);
    const { error } = await db
      .from("location_daily_summary")
      .upsert(slice, { onConflict: "account_id,user_id,day" });
    if (error) throw new Error(`location_daily_summary upsert failed: ${error.message}`);
  }
  bump("location_daily_summary", summaryRows.length);

  // ── Raw GPS, recent days only ─────────────────────────────
  // Retention deletes pings past a year but keeps the summaries above, so a
  // full year of raw points would be rows the platform is built to discard.
  const pingCutoff = addDays(opts.window.lastDay, -(opts.pingDays - 1));
  const pingCutoffMs = istInstant(pingCutoff, 0, 0).getTime();
  const pingRows: Record<string, unknown>[] = [];

  for (const s of sessions) {
    if (s.punchIn.getTime() < pingCutoffMs) continue;
    const rep = repByIndex.get(s.repIndex)!;
    const dayVisits = visits.filter(
      (v) => v.repIndex === s.repIndex && ymd(v.day) === ymd(s.day),
    );
    const span = s.punchOut.getTime() - s.punchIn.getTime();
    const steps = Math.max(2, Math.floor(span / 600_000)); // a ping every 10 min

    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const at = new Date(s.punchIn.getTime() + progress * span);
      // Drift between the customers the rep actually visited, so the trail
      // joins up the day's stops instead of wandering at random.
      const anchor =
        dayVisits.length > 0
          ? dayVisits[Math.min(dayVisits.length - 1, Math.floor(progress * dayVisits.length))]
              .customer
          : null;
      const baseLat = anchor ? anchor.lat : rep.city.lat;
      const baseLng = anchor ? anchor.lng : rep.city.lng;
      pingRows.push({
        account_id: accountId,
        session_id: s.id,
        user_id: rep.userId,
        lat: Number((baseLat + (rng.next() - 0.5) * 0.006).toFixed(6)),
        lng: Number((baseLng + (rng.next() - 0.5) * 0.006).toFixed(6)),
        accuracy_m: rng.between(5, 24),
        speed_mps: rng.float(0, 11, 2),
        battery_pct: batteryAt(progress),
        recorded_at: at.toISOString(),
        received_at: at.toISOString(),
        is_mocked: false,
        client_ping_id: uuid(),
        // Allowed: auto | punch_in | punch_out | visit_check_in |
        // visit_check_out | trace. The first and last ping of a session are the
        // punch pair; everything between is the background trace.
        source: i === 0 ? "punch_in" : i === steps ? "punch_out" : "auto",
      });
    }
  }
  await insertChunked(db, "location_pings", pingRows, 500, "location_pings");
  bump("location_pings", pingRows.length);

  // ── Device health, recent days only (feeds the Health screen) ──
  const healthRows: Record<string, unknown>[] = [];
  for (const s of sessions) {
    if (s.punchIn.getTime() < pingCutoffMs) continue;
    const rep = repByIndex.get(s.repIndex)!;
    healthRows.push({
      account_id: accountId,
      session_id: s.id,
      user_id: rep.userId,
      recorded_at: s.punchIn.toISOString(),
      received_at: s.punchIn.toISOString(),
      client_snapshot_id: uuid(),
      reason: "punch_in",
      app_version: "1.9.4",
      os_version: rng.pick(["13", "14", "15"]),
      android_api_level: rng.pick([33, 34, 35]),
      manufacturer: rng.pick(["samsung", "xiaomi", "realme", "vivo", "oppo"]),
      model: rng.pick(["SM-A546E", "M2101K6G", "RMX3521", "V2120", "CPH2387"]),
      battery_pct: batteryAt(0),
      is_charging: false,
      low_power_mode: false,
      battery_optimization_on: rng.chance(0.15),
      location_services_on: true,
      fg_location_permission: "granted",
      bg_location_permission: rng.chance(0.9) ? "granted" : "denied",
      notification_permission: "granted",
    });
  }
  await insertChunked(db, "device_health_snapshots", healthRows, 500, "device_health_snapshots");
  bump("device_health_snapshots", healthRows.length);

  // ── Visits ────────────────────────────────────────────────
  const visitRows = visits.map((v) => {
    const rep = repByIndex.get(v.repIndex)!;
    const jitter = () => (rng.next() - 0.5) * 0.0025; // ~140 m
    return {
      id: v.id,
      account_id: accountId,
      user_id: rep.userId, // auth id
      contact_id: v.customer.id,
      target_type: "customer",
      target_id: v.customer.id,
      check_in_at: v.checkIn.toISOString(),
      check_out_at: v.checkOut.toISOString(),
      check_in_method: rng.chance(0.8) ? "manual" : "geofence_auto",
      check_in_lat: Number((v.customer.lat + jitter()).toFixed(6)),
      check_in_lng: Number((v.customer.lng + jitter()).toFixed(6)),
      check_out_lat: Number((v.customer.lat + jitter()).toFixed(6)),
      check_out_lng: Number((v.customer.lng + jitter()).toFixed(6)),
      check_in_accuracy_m: rng.between(5, 25),
      check_out_accuracy_m: rng.between(5, 25),
      check_in_distance_m: rng.between(3, 48),
      check_out_distance_m: rng.between(3, 48),
      check_in_is_mocked: false,
      check_out_is_mocked: false,
      notes: rng.pick(notes),
      feedback_type: weighted(FEEDBACK, rng.next()),
    };
  });
  await insertChunked(db, "site_visits", visitRows, 300, "site_visits");
  bump("site_visits", visitRows.length);

  // ── Orders (SFA line only) ────────────────────────────────
  const orderByCustomer = new Map<string, { total: number; at: Date }[]>();

  if (lines.sfa && products.length) {
    const orderRows: Record<string, unknown>[] = [];
    const itemRows: Record<string, unknown>[] = [];
    const dispatchRows: Record<string, unknown>[] = [];
    const todayMs = istInstant(opts.window.lastDay, 23, 59).getTime();

    for (const v of visits) {
      if (!rng.chance(PRODUCTIVE_VISIT_SHARE)) continue;
      const rep = repByIndex.get(v.repIndex)!;
      const orderId = uuid();
      const placedAt = new Date(v.checkIn.getTime() + rng.between(5, 25) * 60_000);

      const lineCount = rng.between(2, 5);
      let subTotal = 0;
      for (let i = 0; i < lineCount; i++) {
        const p = rng.pick(products);
        const qty = p.price > 2000 ? rng.between(1, 6) : rng.between(2, 40);
        // Occasional small discount off list, so margins are not uniform.
        const price = rng.chance(0.25)
          ? Number((p.price * rng.float(0.92, 0.99, 3)).toFixed(2))
          : p.price;
        const lineTotal = Number((qty * price).toFixed(2));
        subTotal += lineTotal;
        itemRows.push({
          order_id: orderId,
          product_id: p.id,
          product_name: p.name,
          unit: p.unit,
          quantity: qty,
          price,
          tax_rate: 0,
          tax_amount: 0,
          sub_total: lineTotal,
          total: lineTotal,
          position: i,
          catalogue_price: p.price,
          tax_mode: "exclusive",
          entered_unit_id: p.unitId,
          conversion_factor: 1,
          base_quantity: qty,
          base_unit_price: price,
        });
      }
      subTotal = Number(subTotal.toFixed(2));

      const ageDays = Math.round((todayMs - placedAt.getTime()) / 86_400_000);
      const status = agedStatus(statusFor(rng.next()), ageDays);

      orderRows.push({
        id: orderId,
        account_id: accountId,
        user_id: rep.userId, // auth id
        contact_id: v.customer.id,
        site_visit_id: v.id, // makes this a "productive visit"
        date: ymd(v.day),
        sub_total: subTotal,
        tax_total: 0,
        total_amount: subTotal,
        discount_total: 0,
        status,
        classification: "direct",
        pricing_status: "confirmed",
        notes: null,
        created_at: placedAt.toISOString(),
        client_created_at: placedAt.toISOString(),
      });

      // Sales value is dated by dispatch completion, not order date — so a
      // Closed order with no dispatch row never appears in the Sales series.
      if (status === "Closed" || status === "Dispatched" || status === "Part Dispatch") {
        const lag = rng.between(DISPATCH_LAG_DAYS[0], DISPATCH_LAG_DAYS[1]);
        const dispatchedDay = addDays(v.day, lag);
        if (istInstant(dispatchedDay, 12, 0).getTime() <= todayMs) {
          dispatchRows.push({
            account_id: accountId,
            order_id: orderId,
            dispatched_at: ymd(dispatchedDay),
            transport_name: rng.pick([
              "VRL Logistics",
              "Gati Express",
              "Patel Roadways",
              "Shree Anjani Courier",
              "Own Tempo",
            ]),
            tracking_number: `LR-${rng.between(100000, 999999)}`,
            invoice_no: `INV/${v.day.y}/${rng.between(1000, 9999)}`,
            invoice_date: ymd(dispatchedDay),
          });
        }
      }

      if (status !== "Cancelled") {
        const list = orderByCustomer.get(v.customer.id) ?? [];
        list.push({ total: subTotal, at: placedAt });
        orderByCustomer.set(v.customer.id, list);
      }
    }

    await insertChunked(db, "orders", orderRows, 150, "orders");
    bump("orders", orderRows.length);
    await insertChunked(db, "order_items", itemRows, 500, "order_items");
    bump("order_items", itemRows.length);
    await insertChunked(db, "order_dispatches", dispatchRows, 200, "order_dispatches");
    bump("order_dispatches", dispatchRows.length);
  }

  // ── Payments (SFA line only) ──────────────────────────────
  // Derived from each customer's order book so the Outstanding, Overdue and
  // Ageing widgets add up. The account counts orders in `Closed` and payments
  // in `Approved` (outstanding_settings), and this respects both.
  if (lines.sfa && masters.paymentTypeIds.length) {
    const paymentRows: Record<string, unknown>[] = [];
    const todayMs = istInstant(opts.window.lastDay, 20, 0).getTime();

    for (const customer of customers) {
      const orders = orderByCustomer.get(customer.id);
      if (!orders || orders.length === 0) continue;
      const rep = repByIndex.get(customer.repIndex)!;

      const billed = orders.reduce((s, o) => s + o.total, 0);
      // 15% of customers are left badly behind, so Ageing has a red bucket.
      const badPayer = rng.chance(OVERDUE_CUSTOMER_SHARE);
      const target = billed * (badPayer ? rng.float(0.25, 0.5, 3) : rng.float(COLLECTION_BAND[0], COLLECTION_BAND[1], 3));

      let collected = 0;
      const instalments = rng.between(Math.min(2, orders.length), Math.max(2, Math.ceil(orders.length * 0.7)));
      const firstOrderMs = Math.min(...orders.map((o) => o.at.getTime()));

      for (let i = 0; i < instalments && collected < target; i++) {
        const remaining = target - collected;
        const amount =
          i === instalments - 1
            ? Math.round(remaining)
            : Math.round(remaining / (instalments - i) * rng.float(0.7, 1.3, 2));
        if (amount <= 0) continue;

        // Dated after the first order, never after today — the payment trigger
        // rejects a future `payment_date` outright.
        const spread = Math.max(86_400_000, todayMs - firstOrderMs);
        const at = new Date(firstOrderMs + rng.next() * spread);
        if (at.getTime() > todayMs) continue;

        const pt = rng.pick(masters.paymentTypeIds);
        const pending = rng.chance(PAYMENT_PENDING_SHARE);
        const day = istDayOf(at);

        paymentRows.push({
          id: uuid(),
          account_id: accountId,
          user_id: rep.userId, // auth id
          contact_id: customer.id,
          amount,
          verified_amount: pending ? null : amount,
          payment_type_id: pt.id,
          payment_type: pt.name,
          payment_date: ymd(day),
          reference_number: pt.name === "Cash" ? null : `${pt.name.slice(0, 3).toUpperCase()}${rng.between(100000, 999999)}`,
          notes: null,
          source: rng.chance(COLLECTION_VISIT_SHARE) ? "visit" : "admin",
          status: pending ? "Pending" : "Approved",
          approved_by: pending ? null : built.owner.userId, // auth id
          approved_at: pending ? null : new Date(at.getTime() + 3600_000).toISOString(),
          created_at: at.toISOString(),
        });
        collected += amount;
      }
    }

    await insertChunked(db, "payments", paymentRows, 150, "payments");
    bump("payments", paymentRows.length);
  }

  // ── Expenses (WFA line) ───────────────────────────────────
  if (lines.wfa && masters.expenseTypeIds.length) {
    const expenseRows: Record<string, unknown>[] = [];

    for (const [repIndex, days] of workedDays) {
      const rep = repByIndex.get(repIndex)!;
      for (const day of days) {
        if (!rng.chance(0.55)) continue;
        const type = rng.pick(masters.expenseTypeIds);
        const travelKm = type.travelling ? rng.between(14, 95) : null;
        const ratePerKm = type.travelling ? (type.name.includes("Car") ? 9 : 4) : null;
        const amount =
          travelKm && ratePerKm ? travelKm * ratePerKm : rng.messyAmount(150, 1400);

        // Most claims are settled; a handful sit Pending so the approval tile
        // has something in it, and a few were rejected. Anything older than a
        // fortnight is forced to a decision — otherwise a year of 12% Pending
        // leaves ~100 claims in the queue, and the dashboard tile reads as a
        // backlog nobody has touched rather than as today's work.
        const roll = rng.next();
        const raw = roll < 0.82 ? "Approved" : roll < 0.94 ? "Pending" : "Rejected";
        const ageDays = Math.round(
          (istInstant(opts.window.lastDay, 23, 59).getTime() - istInstant(day, 12, 0).getTime()) /
            86_400_000,
        );
        const status = settledIfStale(raw, ageDays, rng.chance(0.9) ? "Approved" : "Rejected");

        expenseRows.push({
          account_id: accountId,
          employee_id: rep.profileId, // profiles.id — NOT the auth id
          expense_type_id: type.id,
          expense_date: ymd(day),
          amount,
          travel_km: travelKm,
          rate_per_km: ratePerKm,
          remarks: rng.pick(EXPENSE_REMARKS),
          status,
          approved_amount: status === "Approved" ? amount : null,
          approved_by: status === "Approved" ? built.owner.userId : null, // auth id
          approved_at:
            status === "Approved" ? istInstant(addDays(day, 2), 11, 30).toISOString() : null,
          rejection_reason: status === "Rejected" ? "Bill not attached" : null,
          created_at: istInstant(day, 19, rng.between(0, 50)).toISOString(),
          is_active: true,
        });
      }
    }

    await insertChunked(db, "expenses", expenseRows, 200, "expenses");
    bump("expenses", expenseRows.length);
  }

  // ── Leaves (backfill only — see HistoryOptions.backfill) ──
  if (opts.backfill && masters.leaveTypeIds.length) {
    const leaveRows: Record<string, unknown>[] = [];
    const leaveDayRows: Record<string, unknown>[] = [];
    const allDays = daysBetween(opts.window.firstDay, opts.window.lastDay);

    for (const rep of reps) {
      const howMany = rng.between(3, 7);
      // `idx_leave_days_no_overlap` forbids two leave_days rows for the same
      // employee on the same date, so a rep's leaves must not overlap. Random
      // dates across a year collide often enough that this is not optional.
      const takenDates = new Set<string>();

      for (let i = 0; i < howMany; i++) {
        // The last request per rep is a Pending one dated in the near future,
        // so the "Leave Requests Pending" tile always has something real in it.
        // Dating it in the past instead would show the approver a request for
        // leave that was already taken months ago.
        const upcoming = i === howMany - 1;
        const span = rng.chance(0.65) ? 1 : rng.between(2, 3);

        // Find a run of `span` free days for this rep, or give up on this one.
        let start: IstDay | null = null;
        for (let attempt = 0; attempt < 25; attempt++) {
          const candidate = upcoming
            ? addDays(opts.window.lastDay, rng.between(3, 25))
            : allDays[rng.between(0, allDays.length - 1)];
          let free = true;
          for (let d = 0; d < span; d++) {
            if (takenDates.has(ymd(addDays(candidate, d)))) {
              free = false;
              break;
            }
          }
          if (free) {
            start = candidate;
            break;
          }
        }
        if (!start) continue;
        for (let d = 0; d < span; d++) takenDates.add(ymd(addDays(start, d)));

        const end = addDays(start, span - 1);
        const type = rng.pick(masters.leaveTypeIds);
        const leaveId = uuid();

        const status = upcoming ? "Pending" : rng.chance(0.85) ? "Approved" : "Rejected";

        leaveRows.push({
          id: leaveId,
          account_id: accountId,
          employee_id: rep.profileId, // profiles.id
          leave_type_id: type.id,
          from_date: ymd(start),
          to_date: ymd(end),
          total_days: span,
          reason: rng.pick(LEAVE_REASONS),
          status,
          applied_by: rep.profileId, // profiles.id
          is_backdated: false,
          approved_by: status === "Approved" ? built.owner.userId : null, // auth id
          approved_at:
            status === "Approved" ? istInstant(addDays(start, -1), 17, 0).toISOString() : null,
          rejected_by: status === "Rejected" ? built.owner.userId : null,
          rejected_at:
            status === "Rejected" ? istInstant(addDays(start, -1), 17, 0).toISOString() : null,
          rejection_reason: status === "Rejected" ? "Team coverage not available" : null,
          created_at: istInstant(addDays(start, -3), 10, rng.between(0, 59)).toISOString(),
        });

        for (let d = 0; d < span; d++) {
          const day = addDays(start, d);
          leaveDayRows.push({
            leave_id: leaveId,
            account_id: accountId,
            employee_id: rep.profileId, // profiles.id
            leave_date: ymd(day),
            weightage: "full",
            day_value: 1.0,
            status,
          });
        }
      }
    }

    await insertChunked(db, "leaves", leaveRows, 150, "leaves");
    bump("leaves", leaveRows.length);
    await insertChunked(db, "leave_days", leaveDayRows, 300, "leave_days");
    bump("leave_days", leaveDayRows.length);
  }

  // ── Tasks ─────────────────────────────────────────────────
  // Spread across the window, with a handful landing today and tomorrow so the
  // "Today's Tasks" widget and the Follow-ups screen are not empty.
  {
    const taskTypes = ["Task", "Call", "Visit", "Meeting", "Follow up"];
    const titles = [
      "Collect outstanding payment",
      "Share updated rate list",
      "Follow up on pending order",
      "Deliver samples",
      "Monthly review meeting",
      "Confirm delivery schedule",
      "Resolve customer complaint",
      "Re-stock counter display",
    ];
    const allDays = daysBetween(opts.window.firstDay, opts.window.lastDay);
    const taskRows: Record<string, unknown>[] = [];
    // ~420 across a 12-month backfill, or ~3 per day on a refresh.
    const taskTarget = opts.backfill ? 420 : Math.max(2, allDays.length * 3);

    for (let i = 0; i < taskTarget; i++) {
      const customer = customers[rng.between(0, customers.length - 1)];
      const rep = repByIndex.get(customer.repIndex)!;
      // 12% land on the last two days so something is always due "now".
      const onToday = rng.chance(0.12);
      const day = onToday
        ? addDays(opts.window.lastDay, rng.between(0, 1))
        : allDays[Math.floor(Math.sqrt(rng.next()) * (allDays.length - 1))];
      const createdDay = addDays(day, -rng.between(1, 6));
      if (istInstant(createdDay, 12, 0).getTime() < customer.createdAt.getTime()) continue;

      const status = onToday
        ? rng.pick(["Pending", "In Progress"])
        : rng.chance(0.82)
          ? "Completed"
          : rng.pick(["Pending", "Cancelled"]);

      taskRows.push({
        account_id: accountId,
        user_id: built.owner.userId, // auth id — who created it
        assigned_user_id: rep.profileId, // profiles.id
        employee_id: rep.profileId, // profiles.id
        contact_id: customer.id,
        title: rng.pick(titles),
        description: null,
        activity_type: rng.pick(taskTypes),
        status,
        priority: weighted(
          [
            ["Low", 20],
            ["Medium", 50],
            ["High", 25],
            ["Urgent", 5],
          ],
          rng.next(),
        ),
        due_date: ymd(day),
        due_time: `${String(rng.between(10, 18)).padStart(2, "0")}:${rng.chance(0.5) ? "00" : "30"}:00`,
        created_at: istInstant(createdDay, rng.between(9, 18), rng.between(0, 59)).toISOString(),
        is_active: true,
      });
    }

    await insertChunked(db, "tasks", taskRows, 200, "tasks");
    bump("tasks", taskRows.length);
  }

  // ── CRM: leads, deals, quotations, conversations ──────────
  if (lines.crm) {
    const crm = await generateCrm(db, built, opts);
    for (const [k, v] of Object.entries(crm)) bump(k, v);
  }

  return counts;
}

// ── CRM generation, split out to keep the main pass readable ──

async function generateCrm(db: DB, built: BuiltTenant, opts: HistoryOptions): Promise<Counts> {
  const { tenant, accountId, reps, customers, products, masters, rng } = built;
  const counts: Counts = {};
  const allDays = daysBetween(opts.window.firstDay, opts.window.lastDay);
  const kinds = FIRM_KIND[tenant.customerKind];

  // `idx_leads_account_phone_normalized` is unique per account, so lead phones
  // must not collide with each other *or* with leads already in the tenant.
  // The counter restarts at 1 on every run, so the daily refresh would
  // otherwise immediately re-issue the backfill's first phone numbers. Load
  // what is taken and skip past it.
  const { data: takenLeadPhones } = await db
    .from("leads")
    .select("phone")
    .eq("account_id", accountId);
  const usedPhones = new Set(
    ((takenLeadPhones ?? []) as any[]).map((r) => String(r.phone ?? "")),
  );

  let leadPhoneSeq = 0;
  const nextLeadPhone = () => {
    for (let i = 0; i < 100000; i++) {
      leadPhoneSeq++;
      const candidate = `+9197${String(10000000 + leadPhoneSeq).slice(-8)}`;
      if (!usedPhones.has(candidate)) {
        usedPhones.add(candidate);
        return candidate;
      }
    }
    throw new Error("ran out of unused lead phone numbers");
  };
  const leadName = uniqueMaker(() => `${rng.pick(FIRM_PREFIX)} ${rng.pick(kinds)}${rng.pick(FIRM_SUFFIX)}`);

  // ── Leads ───────────────────────────────────────────────
  const leadRows: Record<string, unknown>[] = [];
  const leadIds: { id: string; repIndex: number; name: string; at: Date; converted: boolean }[] = [];
  // Counts below are for the 12-month backfill; a daily refresh writes a
  // day's worth instead. Without this the refresh would add another 600 leads,
  // 300 deals and 250 quotations every single night.
  const scale = opts.backfill ? 1 : Math.max(1, allDays.length) / 310;
  const target = (backfillCount: number, perDayFloor: number) =>
    opts.backfill ? backfillCount : Math.max(perDayFloor, Math.round(backfillCount * scale));
  const leadTarget = target(600, 4);

  for (let i = 0; i < leadTarget; i++) {
    const rep = reps[rng.between(0, reps.length - 1)];
    const city = rep.city;
    // Square the roll so lead flow grows through the window.
    const dayIdx = Math.floor(Math.sqrt(rng.next()) * (allDays.length - 1));
    const day = allDays[dayIdx];
    const at = istInstant(day, rng.between(9, 19), rng.between(0, 59));
    const id = uuid();
    const converted = rng.chance(0.22);
    const status = converted ? "Qualified" : rng.pick(masters.leadStatuses);
    const phone = nextLeadPhone();

    leadRows.push({
      id,
      account_id: accountId,
      user_id: rep.userId, // auth id
      owner_id: rep.userId, // auth id
      name: leadName(),
      company: null,
      contact_person: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
      phone,
      whatsapp: phone,
      email: null,
      source: rng.pick(masters.leadSources),
      status,
      industry: rng.pick(masters.leadIndustries),
      address: `${rng.pick(city.areas)}, ${city.city}`,
      area: rng.pick(city.areas),
      city: city.city,
      state: city.state,
      country: "India",
      pincode: `${city.pin}${String(rng.between(1, 99)).padStart(2, "0")}`,
      latitude: Number((city.lat + (rng.next() - 0.5) * 0.08).toFixed(6)),
      longitude: Number((city.lng + (rng.next() - 0.5) * 0.08).toFixed(6)),
      estimated_value: rng.messyAmount(15000, 450000),
      is_converted: converted,
      is_active: true,
      created_at: at.toISOString(),
    });
    leadIds.push({ id, repIndex: rep.index, name: "", at, converted });
  }
  await insertChunked(db, "leads", leadRows, 200, "leads");
  counts.leads = leadRows.length;

  // ── Deals ───────────────────────────────────────────────
  if (masters.pipelineId && masters.stages.length) {
    const dealRows: Record<string, unknown>[] = [];
    const won = masters.stages[masters.stages.length - 1];

    for (let i = 0; i < target(300, 3); i++) {
      const lead = leadIds[rng.between(0, leadIds.length - 1)];
      const rep = reps[lead.repIndex];
      const roll = rng.next();
      const status = roll < 0.42 ? "won" : roll < 0.62 ? "lost" : "open";
      const stage = status === "open" ? rng.pick(masters.stages.slice(0, -1)) : won;
      const at = new Date(lead.at.getTime() + rng.between(1, 20) * 86_400_000);
      if (at.getTime() > Date.now()) continue;

      dealRows.push({
        id: uuid(),
        account_id: accountId,
        user_id: rep.userId, // auth id
        creator_id: rep.userId, // auth id
        assigned_to: rep.profileId, // profiles.id
        pipeline_id: masters.pipelineId,
        stage_id: stage.id,
        lead_id: lead.id,
        deal_for: "lead",
        title: `${tenant.customerKind === "household" ? "AMC / Service" : "Supply"} enquiry — ${rng.pick(city0(tenant))}`,
        value: rng.messyAmount(20000, 600000),
        currency: "INR",
        status,
        expected_close_date: ymd(istDayOf(new Date(at.getTime() + rng.between(10, 60) * 86_400_000))),
        created_at: at.toISOString(),
        updated_at: new Date(at.getTime() + rng.between(1, 15) * 86_400_000).toISOString(),
        is_active: true,
      });
    }
    await insertChunked(db, "deals", dealRows, 150, "deals");
    counts.deals = dealRows.length;
  }

  // ── Quotations ──────────────────────────────────────────
  if (products.length) {
    const quoteRows: Record<string, unknown>[] = [];
    const quoteItemRows: Record<string, unknown>[] = [];

    for (let i = 0; i < target(250, 2); i++) {
      const customer = customers[rng.between(0, customers.length - 1)];
      const rep = reps[customer.repIndex];
      const dayIdx = Math.floor(Math.sqrt(rng.next()) * (allDays.length - 1));
      const day = allDays[dayIdx];
      if (istInstant(day, 12, 0).getTime() < customer.createdAt.getTime()) continue;
      const quoteId = uuid();

      let subTotal = 0;
      const lineCount = rng.between(2, 6);
      for (let j = 0; j < lineCount; j++) {
        const p = rng.pick(products);
        const qty = p.price > 2000 ? rng.between(1, 8) : rng.between(5, 60);
        const lineTotal = Number((qty * p.price).toFixed(2));
        subTotal += lineTotal;
        quoteItemRows.push({
          quotation_id: quoteId,
          product_id: p.id,
          product_name: p.name,
          unit: p.unit,
          quantity: qty,
          price: p.price,
          tax_rate: 0,
          tax_amount: 0,
          sub_total: lineTotal,
          total: lineTotal,
          position: j,
        });
      }
      subTotal = Number(subTotal.toFixed(2));

      const roll = rng.next();
      const status = roll < 0.35 ? "Accepted" : roll < 0.55 ? "Sent" : roll < 0.75 ? "Rejected" : "Draft";

      quoteRows.push({
        id: quoteId,
        account_id: accountId,
        user_id: rep.userId, // auth id
        contact_id: customer.id,
        date: ymd(day),
        valid_until: ymd(addDays(day, 15)),
        sub_total: subTotal,
        tax_total: 0,
        total_amount: subTotal,
        status,
        version: 1,
        is_latest_version: true,
        is_read: true,
        is_active: true,
        terms_conditions: "Prices valid for 15 days. Taxes extra as applicable. Delivery within 7 working days.",
        created_at: istInstant(day, rng.between(10, 18), rng.between(0, 59)).toISOString(),
      });
    }
    await insertChunked(db, "quotations", quoteRows, 150, "quotations");
    counts.quotations = quoteRows.length;
    await insertChunked(db, "quotation_items", quoteItemRows, 500, "quotation_items");
    counts.quotation_items = quoteItemRows.length;
  }

  // ── Conversations + messages (the CRM activity feed) ────
  const convRows: Record<string, unknown>[] = [];
  const msgRows: Record<string, unknown>[] = [];
  const INBOUND = [
    "Hello, is the order dispatched?",
    "Please share the latest rate list",
    "Need delivery by Saturday",
    "Can you send a quotation?",
    "Payment done, please check",
    "What is the warranty on this?",
    "Please send your executive tomorrow",
  ];
  const OUTBOUND = [
    "Thank you for reaching out. Checking and reverting shortly.",
    "Sharing the updated rate list now.",
    "Noted, we will arrange delivery by Saturday.",
    "Our executive will visit you tomorrow between 11 AM and 1 PM.",
    "Payment received, thank you.",
    "Quotation shared on WhatsApp. Please review.",
  ];

  for (let i = 0; i < target(120, 2); i++) {
    const customer = customers[rng.between(0, customers.length - 1)];
    const rep = reps[customer.repIndex];
    const convId = uuid();
    const dayIdx = Math.floor(Math.sqrt(rng.next()) * (allDays.length - 1));
    const day = allDays[dayIdx];
    const start = istInstant(day, rng.between(9, 18), rng.between(0, 59));
    if (start.getTime() < customer.createdAt.getTime()) continue;

    const turns = rng.between(3, 10);
    let last = start;
    let lastText = "";
    for (let m = 0; m < turns; m++) {
      const fromCustomer = m % 2 === 0;
      lastText = fromCustomer ? rng.pick(INBOUND) : rng.pick(OUTBOUND);
      msgRows.push({
        conversation_id: convId,
        sender_type: fromCustomer ? "customer" : "agent",
        sender_id: fromCustomer ? null : rep.userId,
        content_type: "text",
        content_text: lastText,
        status: "delivered",
        created_at: last.toISOString(),
      });
      last = new Date(last.getTime() + rng.between(2, 40) * 60_000);
    }

    convRows.push({
      id: convId,
      account_id: accountId,
      user_id: rep.userId, // auth id
      contact_id: customer.id,
      status: rng.chance(0.75) ? "closed" : "open",
      assigned_agent_id: rep.userId,
      last_message_text: lastText,
      last_message_at: last.toISOString(),
      unread_count: 0,
      created_at: start.toISOString(),
    });
  }
  await insertChunked(db, "conversations", convRows, 200, "conversations");
  counts.conversations = convRows.length;
  await insertChunked(db, "messages", msgRows, 500, "messages");
  counts.messages = msgRows.length;

  return counts;
}

/** Area names for deal titles, so they read like real enquiries. */
function city0(tenant: BuiltTenant["tenant"]): string[] {
  return tenant.cities.flatMap((c) => c.areas);
}
