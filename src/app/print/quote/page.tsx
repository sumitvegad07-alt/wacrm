// ============================================================
// The one-page printable quote. Founder-only.
//
// Built to be sent mid-call: a single A4 sheet the customer can read on a phone,
// carrying the figures the founder just read out. It holds no stored state — the
// whole quote is in the query string, so there is nothing to save, expire or
// clean up, and the same link always renders the same numbers.
//
// Styles are inline rather than Tailwind: this page is printed far more often
// than it is looked at on screen, and inline styles are the only ones guaranteed
// to survive a print dialog with background graphics switched off.
// ============================================================

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireFounder } from "@/lib/auth/superadmin";
import { isNewPlan, PLAN_LABEL, type PlanId } from "@/lib/plans/catalog";
import {
  MIN_TICKET,
  TERM_LABEL,
  asTerm,
  compareTerms,
  quote,
  renewalDate,
  type BillingTerm,
} from "@/lib/plans/pricing";
import { inr } from "@/lib/proposals/format";
import { PrintButton } from "./print-button";

interface QuoteParams {
  plan: PlanId;
  users: number;
  term: BillingTerm;
  discountPct: number;
  gstRate: number;
  customer: string;
}

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** The query string, cleaned. Anything unrecognised falls back to a safe default. */
function readParams(search: Search): QuoteParams {
  const rawPlan = one(search.plan);
  const users = Number(one(search.users));
  const discount = Number(one(search.discount));

  return {
    plan: isNewPlan(rawPlan) ? rawPlan : "SFA",
    users: Number.isFinite(users) ? users : 0,
    term: asTerm(one(search.term)),
    discountPct: Number.isFinite(discount) ? discount : 0,
    gstRate: one(search.gst) === "0" ? 0 : 18,
    customer: one(search.customer).slice(0, 120),
  };
}

export async function generateMetadata(props: {
  searchParams: Promise<Search>;
}): Promise<Metadata> {
  try {
    await requireFounder();
  } catch {
    return { title: { absolute: "Quote" } };
  }

  const { customer } = readParams(await props.searchParams);
  const slug = (customer || "Customer").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");

  // Chrome names the saved PDF after the document title, so the title IS the
  // filename the customer receives on WhatsApp.
  return { title: { absolute: `OZZO_Quote_${slug}` } };
}

const INK = "#1F3A5F";
const MUTED = "#667085";
const LINE = "#E4EAF2";

export default async function QuotePrintView(props: { searchParams: Promise<Search> }) {
  try {
    await requireFounder();
  } catch {
    // 404 rather than "forbidden": OZZO's own pricing, so nobody else learns the
    // route exists.
    notFound();
  }

  const p = readParams(await props.searchParams);
  const q = quote({
    plan: p.plan,
    users: p.users,
    term: p.term,
    discountPct: p.discountPct,
    gstRate: p.gstRate,
  });
  const rows = compareTerms({
    plan: p.plan,
    users: p.users,
    discountPct: p.discountPct,
    gstRate: p.gstRate,
  });

  const today = new Date();
  const dated = today.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const renews = renewalDate(today, p.term).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print { .print-hide { display: none !important; } }
        body { background: #fff; }
      `}</style>

      <PrintButton />

      <div
        style={{
          fontFamily: "Arial, Helvetica, sans-serif",
          color: INK,
          maxWidth: 760,
          margin: "0 auto",
          padding: "24px 20px 40px",
          background: "#fff",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            borderBottom: `2px solid ${INK}`,
            paddingBottom: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.5 }}>OZZO</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
              ozzo.co.in · sales@ozzo.co.in · +91 92271 26301
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Price Quotation</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{dated}</div>
          </div>
        </div>

        {p.customer && (
          <div style={{ marginTop: 18, fontSize: 13 }}>
            <span style={{ color: MUTED }}>Prepared for </span>
            <b style={{ fontSize: 15 }}>{p.customer}</b>
          </div>
        )}

        {/* What is being quoted */}
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: 18,
            fontSize: 12.5,
          }}
        >
          <thead>
            <tr style={{ background: "#F2F6FB" }}>
              <Th>Plan</Th>
              <Th>Billing term</Th>
              <Th align="center">Users</Th>
              <Th align="right">Rate / user / month</Th>
              <Th align="right">Per user for the term</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <b>OZZO {PLAN_LABEL[q.plan]}</b>
              </Td>
              <Td>{TERM_LABEL[q.term]} · {q.months} months</Td>
              <Td align="center">
                <b>{q.usersBilled}</b>
              </Td>
              <Td align="right">₹{inr(q.ratePerMonth)}</Td>
              <Td align="right">₹{inr(q.ratePerUser)}</Td>
              <Td align="right">
                <b>₹{inr(q.subtotal)}</b>
              </Td>
            </tr>
          </tbody>
        </table>

        {/* Money ladder */}
        <div style={{ marginTop: 16, marginLeft: "auto", width: 320, fontSize: 13 }}>
          <Row label="Subtotal" value={`₹${inr(q.subtotal)}`} />
          {q.discountPct > 0 && (
            <Row label={`Discount (${q.discountPct}%)`} value={`− ₹${inr(q.discountAmount)}`} />
          )}
          <Row label="Net amount" value={`₹${inr(q.net)}`} strong />
          {q.gstRate > 0 && (
            <Row label={`GST @ ${q.gstRate}%`} value={`₹${inr(q.gstAmount)}`} />
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              borderTop: `2px solid ${INK}`,
              marginTop: 8,
              paddingTop: 8,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase" }}>
              Total payable
            </span>
            <span style={{ fontWeight: 700, fontSize: 22 }}>₹{inr(q.total)}</span>
          </div>
        </div>

        {/* Headline figures */}
        <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
          <Tile label="Effective rate" value={`₹${inr(q.effectiveRatePerMonth)}`} sub="per user / month" />
          <Tile label="Per user / day" value={`₹${q.perUserPerDay.toFixed(1)}`} sub="every working day" />
          <Tile label="Over 12 months" value={`₹${inr(q.annualised)}`} sub="on this term" />
          <Tile label="Renews" value={renews} sub={`in ${q.months} months`} small />
        </div>

        {/* Term comparison */}
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            The same {q.usersBilled} users on a longer term
          </div>
          <table
            style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 12.5 }}
          >
            <thead>
              <tr style={{ background: "#F2F6FB" }}>
                <Th>Billing term</Th>
                <Th align="right">Rate / user / month</Th>
                <Th align="right">Per invoice</Th>
                <Th align="right">Over 12 months</Th>
                <Th align="right">You save</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.term} style={r.term === q.term ? { background: "#FFF8E1" } : undefined}>
                  <Td>
                    {TERM_LABEL[r.term]}
                    {r.term === q.term ? " (quoted)" : ""}
                  </Td>
                  <Td align="right">₹{inr(r.ratePerMonth)}</Td>
                  <Td align="right">₹{inr(r.net)}</Td>
                  <Td align="right">
                    <b>₹{inr(r.annualised)}</b>
                  </Td>
                  <Td align="right">
                    {r.savingVsQuarterly > 0 ? (
                      <b style={{ color: "#0B6B3A" }}>₹{inr(r.savingVsQuarterly)}</b>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Terms */}
        <ul
          style={{
            marginTop: 26,
            paddingLeft: 18,
            fontSize: 10.5,
            color: MUTED,
            lineHeight: 1.7,
          }}
        >
          <li>All amounts in Indian Rupees{q.gstRate > 0 ? ", GST included as shown" : ", exclusive of GST"}.</li>
          <li>
            Billing is per user. Users above the plan minimum of {q.minUsers} are charged at the
            same per-user rate — there is no slab or step.
          </li>
          <li>Payment is in advance for the full term.</li>
          <li>
            Any discount shown is specific to this quote and is not a standing price. Minimum
            purchase ₹{inr(MIN_TICKET)} per quarter.
          </li>
          <li>Quote valid for 10 days from {dated}.</li>
        </ul>
      </div>
    </>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      style={{
        textAlign: align,
        padding: "7px 8px",
        borderBottom: `1px solid ${LINE}`,
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.3,
        color: MUTED,
        fontWeight: 700,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <td style={{ textAlign: align, padding: "9px 8px", borderBottom: `1px solid ${LINE}` }}>
      {children}
    </td>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "4px 0",
        fontWeight: strong ? 700 : 400,
        borderTop: strong ? `1px solid ${LINE}` : undefined,
        marginTop: strong ? 4 : 0,
        paddingTop: strong ? 8 : 4,
      }}
    >
      <span style={{ color: strong ? INK : MUTED }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  small,
}: {
  label: string;
  value: string;
  sub: string;
  small?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        border: `1px solid ${LINE}`,
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 9.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </div>
      <div style={{ fontSize: small ? 13 : 19, fontWeight: 700, marginTop: 3 }}>{value}</div>
      <div style={{ fontSize: 9.5, color: MUTED, marginTop: 1 }}>{sub}</div>
    </div>
  );
}
