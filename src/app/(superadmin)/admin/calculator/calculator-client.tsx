"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  FileText,
  Loader2,
  Printer,
  Table2,
} from "lucide-react";
import { inr } from "@/lib/proposals/format";
import { PLAN_IDS, PLAN_LABEL, type PlanId } from "@/lib/plans/catalog";
import {
  BILLING_TERMS,
  MIN_TICKET,
  MIN_USERS,
  TERM_LABEL,
  TERM_MONTHS,
  compareTerms,
  entryTicket,
  quote,
  renewalDate,
  termRatePerMonth,
  type BillingTerm,
} from "@/lib/plans/pricing";
import { getTemplate } from "@/lib/proposals/registry";
import { todayInIndia } from "@/lib/proposals/today";

const DISCOUNT_CHIPS = [0, 5, 10, 15, 20];
type Tab = "table" | "quote";

function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={className}>₹{inr(value)}</span>;
}

/** "27 Dec 2026" — short enough for a tile, unambiguous on a call. */
function shortDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function CalculatorClient() {
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("table");
  const [plan, setPlan] = useState<PlanId>("SFA");
  const [users, setUsers] = useState(10);
  const [term, setTerm] = useState<BillingTerm>("quarterly");
  const [discountPct, setDiscountPct] = useState(0);
  const [gstEnabled, setGstEnabled] = useState(true);
  const [customer, setCustomer] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const gstRate = gstEnabled ? 18 : 0;

  const q = useMemo(
    () => quote({ plan, users, term, discountPct, gstRate }),
    [plan, users, term, discountPct, gstRate],
  );
  const rows = useMemo(
    () => compareTerms({ plan, users, discountPct, gstRate }),
    [plan, users, discountPct, gstRate],
  );

  /** Every plan × every term, for the table view. */
  const grid = useMemo(
    () =>
      PLAN_IDS.map((p) => ({
        plan: p,
        quotes: BILLING_TERMS.map((t) => quote({ plan: p, users, term: t, discountPct, gstRate })),
      })),
    [users, discountPct, gstRate],
  );

  const renews = useMemo(() => renewalDate(new Date(), term), [term]);

  async function createProposal() {
    setCreating(true);
    setErr(null);

    const template = getTemplate(plan);
    if (!template) {
      setErr(`No proposal template for ${plan}`);
      setCreating(false);
      return;
    }

    const data = template.defaults(todayInIndia());
    const discountedRate = Math.round(q.ratePerMonth * (1 - q.discountPct / 100));

    data.billingTerm = term;
    data.gstEnabled = gstEnabled;
    data.gstRate = 18;
    data.lineItems = data.lineItems.map((item, i) => ({
      ...item,
      users: i === 0 ? q.usersBilled : 0,
      rate: discountedRate,
    }));
    if (customer.trim()) {
      data.client = { ...data.client, name: customer.trim(), shortName: customer.trim() };
    }

    const res = await fetch("/api/admin/proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, data }),
    });
    const payload = await res.json().catch(() => ({}));

    if (!res.ok || !payload?.id) {
      setErr(payload?.error || "Could not create the proposal");
      setCreating(false);
      return;
    }
    router.push(`/admin/proposals/${payload.id}/edit`);
  }

  function openQuotePdf() {
    const params = new URLSearchParams({
      plan,
      users: String(q.usersBilled),
      term,
      discount: String(discountPct),
      gst: gstEnabled ? "1" : "0",
    });
    if (customer.trim()) params.set("customer", customer.trim());
    window.open(`/print/quote?${params.toString()}`, "_blank");
  }

  /** Users / discount / GST — the inputs both tabs share. */
  const dealInputs = (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
          Users
        </label>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setUsers((n) => Math.max(1, n - 1))}
            className="h-10 w-9 rounded-lg border border-border bg-background hover:bg-muted text-lg font-semibold"
          >
            −
          </button>
          <input
            type="number"
            min={1}
            value={users}
            onChange={(e) => setUsers(Math.max(0, Number(e.target.value) || 0))}
            className="w-20 h-10 px-2 rounded-lg border border-border bg-background text-foreground text-center text-lg font-bold"
          />
          <button
            onClick={() => setUsers((n) => n + 1)}
            className="h-10 w-9 rounded-lg border border-border bg-background hover:bg-muted text-lg font-semibold"
          >
            +
          </button>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
          Discount
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            value={discountPct}
            onChange={(e) =>
              setDiscountPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))
            }
            className="w-16 h-10 px-2 rounded-lg border border-border bg-background text-foreground text-center font-bold"
          />
          <span className="text-sm text-muted-foreground">%</span>
          <div className="flex gap-1">
            {DISCOUNT_CHIPS.map((d) => (
              <button
                key={d}
                onClick={() => setDiscountPct(d)}
                className={`px-2 py-1 text-xs rounded border ${
                  discountPct === d
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {d}%
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
          GST
        </label>
        <button
          onClick={() => setGstEnabled((v) => !v)}
          className={`h-10 px-3 rounded-lg border text-sm font-semibold ${
            gstEnabled
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background border-border text-muted-foreground"
          }`}
        >
          {gstEnabled ? "18% charged" : "Not charged"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-5">
      <div>
        <button
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={() => router.push("/admin/proposals")}
        >
          <ArrowLeft className="h-4 w-4" />
          Sales Proposals
        </button>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2 mt-2">
          <Calculator className="h-5 w-5" />
          Price Calculator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Live pricing for a call. Nothing is saved until you create a proposal.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === "table"} onClick={() => setTab("table")} icon={<Table2 className="h-4 w-4" />}>
          Price table
        </TabButton>
        <TabButton active={tab === "quote"} onClick={() => setTab("quote")} icon={<FileText className="h-4 w-4" />}>
          Build a quote
        </TabButton>
      </div>

      {tab === "table" ? (
        /* ══════════ TAB 1 · the whole price list, priced for this deal ══════════ */
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-5">{dealInputs}</div>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h2 className="text-sm font-semibold text-foreground">
                Every plan, every term — {users} {users === 1 ? "user" : "users"}
                {discountPct > 0 ? `, ${discountPct}% off` : ""}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Rate is per user per month. Amount is one invoice{" "}
                {gstEnabled ? "including GST" : "with no GST"}. Click a row to build a quote on it.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium" rowSpan={2}>
                      Plan
                    </th>
                    <th className="px-3 py-2 text-center font-medium" rowSpan={2}>
                      Recommended
                      <br />
                      min users
                    </th>
                    {BILLING_TERMS.map((t) => (
                      <th
                        key={t}
                        className="px-3 py-2 text-center font-medium border-l border-border"
                        colSpan={2}
                      >
                        {TERM_LABEL[t]}
                        <span className="font-normal"> · {TERM_MONTHS[t]} mo</span>
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-muted/40 text-muted-foreground text-xs">
                    {BILLING_TERMS.map((t) => (
                      <Fragment key={t}>
                        <th className="px-3 pb-2 text-right font-medium border-l border-border">
                          Rate
                        </th>
                        <th className="px-3 pb-2 text-right font-medium">Amount</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {grid.map(({ plan: p, quotes }) => (
                    <tr
                      key={p}
                      onClick={() => {
                        setPlan(p);
                        setTab("quote");
                      }}
                      className="hover:bg-muted/40 cursor-pointer"
                    >
                      <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">
                        {PLAN_LABEL[p]}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={
                            users > 0 && users < MIN_USERS[p]
                              ? "inline-block px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold"
                              : "text-muted-foreground"
                          }
                        >
                          {MIN_USERS[p]}
                        </span>
                      </td>
                      {quotes.map((qq) => (
                        <Fragment key={`${p}-${qq.term}`}>
                          <td className="px-3 py-2.5 text-right text-muted-foreground border-l border-border whitespace-nowrap">
                            <Money value={qq.ratePerMonth} />
                          </td>
                          <td className="px-3 py-2.5 text-right font-semibold text-foreground whitespace-nowrap">
                            <Money value={gstEnabled ? qq.total : qq.net} />
                          </td>
                        </Fragment>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-3 border-t border-border bg-muted/20 text-xs text-muted-foreground space-y-1">
              <p>
                <b className="text-foreground">Entry ticket at the recommended minimum</b> —{" "}
                {BILLING_TERMS.map((t, i) => (
                  <span key={t}>
                    {i > 0 ? " · " : ""}
                    {TERM_LABEL[t]} <Money value={entryTicket("SFA", t)} />
                  </span>
                ))}
                . The same on every plan, which is what makes one “from ₹5,000” line true for all
                five.
              </p>
              <p>
                The minimum is a <b className="text-foreground">recommendation, not a block</b> —
                every figure above is priced for exactly the users you entered.
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* ══════════ TAB 2 · one deal, quotation style ══════════ */
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5 space-y-5 h-fit">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Plan
              </label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {PLAN_IDS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setPlan(p)}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                      plan === p
                        ? "bg-primary text-primary-foreground border-primary font-semibold"
                        : "bg-background border-border text-foreground hover:bg-muted"
                    }`}
                  >
                    {PLAN_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Billing term
              </label>
              <div className="flex gap-2 mt-2">
                {BILLING_TERMS.map((t) => (
                  <button
                    key={t}
                    onClick={() => setTerm(t)}
                    className={`flex-1 px-2 py-2 text-sm rounded-lg border transition-colors ${
                      term === t
                        ? "bg-primary text-primary-foreground border-primary font-semibold"
                        : "bg-background border-border text-foreground hover:bg-muted"
                    }`}
                  >
                    {TERM_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>

            {dealInputs}

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Customer name <span className="normal-case font-normal">(optional)</span>
              </label>
              <input
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="Shree Enterprises"
                className="w-full h-10 px-3 mt-2 rounded-lg border border-border bg-background text-foreground"
              />
            </div>
          </div>

          <div className="lg:col-span-3 space-y-4">
            {/* The recommendation. Loud, and never in the way — the founder's
                ruling is that a deal below it must still price out. */}
            {q.belowRecommended && (
              <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/10 px-5 py-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-lg font-bold text-amber-700 dark:text-amber-300 leading-snug">
                      RECOMMENDED: {q.minUsers} USERS ON {PLAN_LABEL[plan].toUpperCase()}
                    </p>
                    <p className="text-sm text-amber-700/90 dark:text-amber-300/90 mt-1">
                      You are quoting {q.usersBilled}. {q.usersToRecommended} more would reach the{" "}
                      <Money value={entryTicket(plan, term)} /> entry ticket this plan is priced
                      around. Quoting below it is your call — the figures below are for{" "}
                      {q.usersBilled} {q.usersBilled === 1 ? "user" : "users"}, as entered.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  {PLAN_LABEL[plan]} · {TERM_LABEL[term]} · {q.usersBilled} users
                </span>
                <span className="text-sm text-muted-foreground">
                  <Money value={q.ratePerMonth} />/user/month
                </span>
              </div>

              <div className="p-5 space-y-2">
                <Line label={`Subtotal (${q.usersBilled} × ₹${inr(q.ratePerUser)})`}>
                  <Money value={q.subtotal} />
                </Line>
                {q.discountPct > 0 && (
                  <Line label={`Discount (${q.discountPct}%)`}>
                    <span className="text-amber-600 dark:text-amber-400">
                      −<Money value={q.discountAmount} />
                    </span>
                  </Line>
                )}
                <Line label="Net amount" strong>
                  <Money value={q.net} />
                </Line>
                {gstEnabled && (
                  <Line label="GST @ 18%">
                    <Money value={q.gstAmount} />
                  </Line>
                )}
                <div className="flex items-baseline justify-between pt-3 mt-2 border-t border-border">
                  <span className="text-sm font-bold text-foreground uppercase tracking-wide">
                    Total payable
                  </span>
                  <Money value={q.total} className="text-3xl font-bold text-foreground" />
                </div>
              </div>

              {q.belowMinTicket && q.net > 0 && (
                <div className="px-5 pb-4">
                  <div className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      Net is below the advertised <Money value={MIN_TICKET} /> minimum. Your call —
                      just not by accident.
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="Effective rate" sub="per user / month">
                <Money value={q.effectiveRatePerMonth} />
              </Tile>
              <Tile label="Per user / day" sub="the chai line">
                ₹{q.perUserPerDay.toFixed(1)}
              </Tile>
              <Tile label="Over 12 months" sub="on this term">
                <Money value={q.annualised} />
              </Tile>
              <Tile label="Renews" sub={`in ${q.months} months`}>
                <span className="text-base">{shortDate(renews)}</span>
              </Tile>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={createProposal}
                disabled={creating}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Create proposal from this
              </button>
              <button
                onClick={openQuotePdf}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm font-semibold hover:bg-muted"
              >
                <Printer className="h-4 w-4" />
                Open quote PDF
              </button>
            </div>
            {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">
                  The same deal on each billing term
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {q.usersBilled} users, same {q.discountPct}% discount. Only the commitment
                  changes.
                </p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">Term</th>
                    <th className="px-3 py-2 text-right font-medium">Rate</th>
                    <th className="px-3 py-2 text-right font-medium">Per invoice</th>
                    <th className="px-3 py-2 text-right font-medium">Over 12 mo</th>
                    <th className="px-5 py-2 text-right font-medium">They save</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr
                      key={r.term}
                      className={r.term === term ? "bg-primary/5 font-medium" : undefined}
                    >
                      <td className="px-5 py-2.5 text-foreground">{TERM_LABEL[r.term]}</td>
                      <td className="px-3 py-2.5 text-right text-foreground">
                        <Money value={r.ratePerMonth} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-foreground">
                        <Money value={r.net} />
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-foreground">
                        <Money value={r.annualised} />
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {r.savingVsQuarterly > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                            <Money value={r.savingVsQuarterly} />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Line({
  label,
  strong,
  children,
}: {
  label: string;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span
        className={`text-sm ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}
      >
        {label}
      </span>
      <span className={strong ? "font-semibold text-foreground" : "text-foreground"}>
        {children}
      </span>
    </div>
  );
}

function Tile({
  label,
  sub,
  children,
}: {
  label: string;
  sub: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground mt-1">{children}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}
