// ============================================================
// The two proposal pages, for any plan.
//
// Was eight pages until 5 October 2026. The founder's reading: an eight-page
// PDF is not read, it is skimmed and filed — so the document is now the two
// pages a buyer actually uses. Page 1 is what you get; page 2 is what it
// costs and on what terms.
//
// The words come from a per-plan content pack, and every repeated figure comes
// from computeTotals and compareProposalTerms — so a CRM proposal cannot
// promise field-sales features, and no two places on the sheet can disagree
// about the price.
// ============================================================

import type { ProposalData, ProposalPayee } from "../types";
import type { PlanContent } from "./content-types";
import type { FeatureGroup } from "../plan-features";
import type { PlanId } from "@/lib/plans/catalog";
import { computeTotals } from "../totals";
import { compareProposalTerms, listDiscount } from "../term-compare";
import { TERM_LABEL, asTerm, renewalDate, termRatePerMonth } from "@/lib/plans/pricing";
import { formatLongDate, inr } from "../format";
import { RichText } from "./rich-text";
import "./proposal.css";

/**
 * The noun the document uses for one billing period.
 *
 * "for the year" was hardcoded throughout when yearly was the only term. A
 * quarterly proposal that still said "for the year" would be a contract-grade
 * error, not a typo.
 */
function termNoun(months: number): string {
  if (months === 3) return "quarter";
  if (months === 6) return "half-year";
  return "year";
}

/** Fills {industry}, {rate}, {permonth}, {termrate} and {termnoun} in a copy string. */
function fill(text: string, tokens: Record<string, string>): string {
  return (text ?? "").replace(/\{(\w+)\}/g, (whole, key) =>
    key in tokens ? tokens[key] : whole,
  );
}

/**
 * The proposal's own date as a Date, built from its parts.
 *
 * Never `new Date(iso)`: that parses as UTC and can land the renewal a day
 * early for an account east of Greenwich, which is every account OZZO has.
 */
function dateFromIso(iso: string): Date {
  const [y, m, d] = (iso ?? "").split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

function shortDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A row's description, split into the lines the founder typed.
 *
 * Blank lines are dropped so a stray Enter at the end of the box cannot open a
 * gap inside a table row — the same rule the Offer box follows.
 */
function descLines(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * "1 Nov 2026 — 31 Jul 2027" for a row that carries its own dates.
 *
 * Presentation only. The row's `months` is what multiplies, never the gap
 * between these two dates, so a mistyped date can shift what the document SAYS
 * the period is but never what it CHARGES. One date alone still prints: a row
 * that only knows when it starts is worth saying.
 */
function rowPeriod(start: string | undefined, end: string | undefined): string {
  const from = start ? shortDate(dateFromIso(start)) : "";
  const to = end ? shortDate(dateFromIso(end)) : "";
  if (from && to) return `${from} — ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "";
}

function Pfoot({ client, label, n }: { client: string; label: string; n: string }) {
  return (
    <div className="pfoot">
      <span>
        <span className="b">OZZO</span> · {label}
      </span>
      <span>
        {client} · {n}
      </span>
    </div>
  );
}

function Minihead({ tag }: { tag: string }) {
  return (
    <div className="minihead">
      <div className="logo" />
      <span className="n">OZZO</span>
      <span className="tag">{tag}</span>
    </div>
  );
}

/**
 * The built-for line reads "Built for FMCG distribution — trade levels, …",
 * where the part before the dash is bold. Split so the founder can rewrite the
 * whole sentence in one field and still get the emphasis.
 */
function BuiltFor({ text }: { text: string }) {
  const [head, ...tail] = (text ?? "").split(" — ");
  if (tail.length === 0) return <span>{head}</span>;
  return (
    <span>
      <b>{head}</b> — {tail.join(" — ")}
    </span>
  );
}

/** One line of the money ladder. */
function Money({
  label,
  value,
  strong,
  note,
}: {
  label: string;
  value: string;
  strong?: boolean;
  note?: boolean;
}) {
  return (
    <div className={`lrow${strong ? " strong" : ""}${note ? " note" : ""}`}>
      <span className="l">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="tile">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="s">{sub}</div>
    </div>
  );
}

export function ProposalPages({
  data,
  content,
  groups,
  plan,
  payee,
}: {
  data: ProposalData;
  content: PlanContent;
  /** From plan-features.ts — exactly what this plan is sold. */
  groups: FeatureGroup[];
  /** Needed to re-price the deal on the other two terms. */
  plan: PlanId;
  /**
   * Bank details and signature, read live from Invoice Settings by the print
   * route. Optional so the document still renders if Invoice Settings has never
   * been filled in — each block below simply doesn't print.
   */
  payee?: ProposalPayee;
}) {
  const term = asTerm(data.billingTerm);

  const t = computeTotals(data.lineItems ?? [], {
    gstEnabled: !!data.gstEnabled,
    gstRate: Number(data.gstRate) || 0,
    term,
  });

  // Typed as free text, printed as lines. Blank lines are dropped so a stray
  // Enter at the end of the box cannot open a gap in the document.
  const offerLines = (data.offer ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const hasBank = !!(payee?.bankName || payee?.bankAccountNo || payee?.upiId);

  const full = data.client?.name || "—";
  const short = data.client?.shortName || data.client?.name || "—";
  const gst = !!data.gstEnabled;
  const gstRate = Number(data.gstRate) || 0;
  const prettyDate = formatLongDate(data.proposalDate);
  const featureCount = groups.reduce((n, g) => n + g.li.length, 0);

  const noun = termNoun(t.months);
  const ratePerUserForTerm = t.headlineRate * t.months;

  const discount = listDiscount({ plan, lineItems: data.lineItems ?? [], term });

  // What one seat lists at on the quoted term. A row priced under it prints its
  // list rate struck through beside the rate charged, so a discount is visible
  // on the row where it was actually given.
  const listRate = termRatePerMonth(plan, term);

  const allTerms = compareProposalTerms({
    plan,
    lineItems: data.lineItems ?? [],
    quotedTerm: term,
  });
  // A quotation whose rows cover different periods cannot honestly be re-priced
  // "the same deal on another term" — there is no single term to move it off.
  // So the comparison table is dropped rather than printed with a figure the
  // price table above it does not agree with.
  const showAllTerms = !!data.showAllTerms && !t.mixedMonths;

  /**
   * The quoted row, forced to agree with the price table above it.
   *
   * compareProposalTerms re-prices every row onto one period, which is the
   * right question for "the same deal on a longer term" but the WRONG answer
   * for the row describing this quotation: rows covering nine months would be
   * restated as twelve, and the sheet would print "you pay each time ₹24,480"
   * directly under a total payable of ₹22,860. Taking the quoted row's figures
   * from computeTotals makes that disagreement impossible rather than unlikely.
   */
  const termRows = (showAllTerms ? allTerms : allTerms.filter((r) => r.quoted)).map((row) =>
    row.quoted ? { ...row, subtotal: t.subtotal, annualised: t.annualised } : row,
  );

  const renews = renewalDate(dateFromIso(data.proposalDate), term);

  // Post-discount, because that is what the customer actually parts with each
  // working day — the figure the founder reads out on the phone.
  const userMonths = (data.lineItems ?? []).reduce(
    (sum, item, i) => sum + (Number(item?.users) || 0) * (t.lineMonths[i] ?? t.months),
    0,
  );
  const perUserPerDay = userMonths ? Math.round((t.subtotal / (userMonths * 30)) * 10) / 10 : 0;

  /**
   * How much room page 1 has to spare.
   *
   * CRM sells 19 features and CRM + SFA sells 46 on the same fixed sheet. One
   * size left the small plans a third empty — which reads as a thin offer —
   * and would clip the big ones. The band sets the column count and the type
   * size; the thresholds are measured, see proposal.css.
   */
  const density = featureCount > 32 ? "dense" : featureCount > 22 ? "mid" : "roomy";

  const tokens = {
    industry: data.voice?.industryPlural ?? "",
    /** Per user for one whole term — the figure the price table charges. */
    rate: inr(ratePerUserForTerm),
    permonth: inr(t.perUserPerMonth),
    termrate: inr(ratePerUserForTerm),
    termnoun: noun,
  };
  const copy = (text: string) => fill(text, tokens);

  return (
    <div className="ozzo-doc">
      {/* ══════════ PAGE 1 · WHAT YOU GET ══════════ */}
      <section className={`page sheet-${density}`}>
        <div className="sheet-head">
          <div className="logo" />
          <div className="id">
            <div className="bn">OZZO</div>
            <div className="bt">CRM · Workforce · Field Sales — in one platform</div>
          </div>
          <div className="meta">
            <div className="to">
              Proposal for <b>{full}</b>
            </div>
            <div className="sub">
              {data.ref} · {prettyDate} · valid {data.validDays} days
            </div>
          </div>
        </div>

        <div className="section-head">
          <div className="eyebrow">{content.eyebrow}</div>
          <h2>
            Everything in <span className="gt">{content.planName}</span>.
          </h2>
          <p className="sub">{content.tagline}</p>
        </div>

        <div className={`feat-grid ${density}`}>
          {groups.map((group) => (
            <div className="fgroup" key={group.h}>
              <h4>{group.h}</h4>
              {group.li.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </div>
          ))}
        </div>

        <div className="allin">
          ✓ <b>All {featureCount} features above are included</b> in your ₹{inr(t.perUserPerMonth)} /
          user / month — there are no per-module charges and no hidden fees.
        </div>

        <div className="blockhead">Why {short} chooses OZZO</div>
        <div className="why">
          <div className="w">
            <span className="ic">✓</span>
            <BuiltFor text={data.voice?.builtFor ?? ""} />
          </div>
          {content.why.map((line) => (
            <div className="w" key={line}>
              <span className="ic">✓</span>
              <span>
                <RichText text={copy(line)} />
              </span>
            </div>
          ))}
        </div>

        <Pfoot client={full} label={content.footerLabel} n="01" />
      </section>

      {/* ══════════ PAGE 2 · INVESTMENT ══════════ */}
      <section className="page">
        <Minihead tag="Investment" />
        <div className="section-head tight">
          <div className="eyebrow">
            Simple, per-user pricing · billed {TERM_LABEL[term].toLowerCase()}
          </div>
          <h2>
            One price. Every module.{" "}
            <span className="gt">{gst ? "Every user." : "No GST to add."}</span>
          </h2>
        </div>

        <table className="ptable">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Users</th>
              <th className="r">Rate / user / month</th>
              <th className="r">Months</th>
              <th className="r">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {(data.lineItems ?? []).map((item, i) => {
              const rate = Number(item.rate) || 0;
              const rowMonths = t.lineMonths[i] ?? t.months;
              const below = listRate > 0 && rate > 0 && rate < listRate;
              const span = rowPeriod(item.periodStart, item.periodEnd);

              return (
                <tr key={`${item.label}-${i}`}>
                  <td className="prod">
                    <b>{item.label}</b>
                    {/* Typed as free text, printed as lines — plan, users, the
                        period, a condition. Blank lines are dropped so a stray
                        Enter cannot open a gap in the row. */}
                    {descLines(item.subLabel).map((line, n) => (
                      <span key={n}>{line}</span>
                    ))}
                    {span ? <span className="span">{span}</span> : null}
                  </td>
                  <td className="r">{item.users}</td>
                  <td className="r">
                    {below ? <s className="was">₹{inr(listRate)}</s> : null}
                    {inr(rate)}
                  </td>
                  <td className="r">{rowMonths}</td>
                  <td className="r">{inr(t.lineAmounts[i] ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* The ladder and the chips share a band: on its own the ladder left two
            thirds of the sheet empty, which page 2 cannot afford. */}
        <div className="moneyrow">
          <div className="ladder">
            {discount.discountAmount > 0 ? (
              <>
                <Money label="At list price" value={`₹${inr(discount.listSubtotal)}`} />
                <Money
                  label={`Discount (${inr(discount.discountPct)}% off list)`}
                  value={`− ₹${inr(discount.discountAmount)}`}
                />
              </>
            ) : null}

            <Money
              label={discount.discountAmount > 0 ? "Net amount" : "Subtotal"}
              value={`₹${inr(t.subtotal)}`}
              strong
            />

            {gst ? (
              <Money label={`GST @ ${gstRate}%`} value={`₹${inr(t.gstAmount)}`} />
            ) : gstRate > 0 ? (
              <Money
                label={`GST @ ${gstRate}% — not charged`}
                value={`you save ₹${inr(t.gstAmount)}`}
                note
              />
            ) : null}

            <div className="ltotal">
              <span className="l">Total payable</span>
              <span className="v">₹{inr(t.grandTotal)}</span>
            </div>

            {/* Whatever the founder typed for this deal, printed under the
                figures and never folded into them — a stated concession must
                not be able to change the amount owed. One line per line. */}
            {offerLines.length > 0 ? (
              <div className="offerbox hl">
                <div className="offerh">Offer</div>
                {offerLines.map((line, i) => (
                  <div key={i} className="offerl">
                    {line}
                  </div>
                ))}
              </div>
            ) : null}

            {hasBank ? (
              <div className="offerbox pay">
                <div className="offerh">How to pay</div>
                {payee?.bankName ? (
                  <div className="offerl">Bank: {payee.bankName}</div>
                ) : null}
                {payee?.bankAccountNo ? (
                  <div className="offerl">A/c No: {payee.bankAccountNo}</div>
                ) : null}
                {payee?.ifsc ? <div className="offerl">IFSC: {payee.ifsc}</div> : null}
                {payee?.upiId ? <div className="offerl">UPI: {payee.upiId}</div> : null}
              </div>
            ) : null}

            {payee?.signatureUrl ? (
              <div className="signbox">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="signimg" src={payee.signatureUrl} alt="" />
                <div className="signl">
                  For {payee.firmName || "OZZO"} · {data.preparedBy?.name ?? ""}
                </div>
              </div>
            ) : null}
          </div>

          <div className="incl">
            <div className="h">Your ₹{inr(t.grandTotal)} covers everything</div>
            <div className="chips">
              {[
                "Software licence",
                "Server & hosting",
                "Maintenance & updates",
                "Implementation & data setup",
                "Team training",
                "WhatsApp & email support",
                "Free one-time setup",
              ].map((chip) => (
                <span className="c" key={chip}>
                  <span className="v">✓</span>
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="tiles">
          <Tile
            label="Effective rate"
            value={`₹${inr(t.perUserPerMonth)}`}
            sub="per user / month"
          />
          <Tile label="Per user / day" value={`₹${perUserPerDay.toFixed(1)}`} sub="every working day" />
          <Tile
            label={t.mixedMonths ? "Full year at these rates" : "Total for one year"}
            value={`₹${inr(t.annualised)}`}
            sub={t.mixedMonths ? "if every row ran a full year" : "paying this often"}
          />
          <Tile label="Next payment due" value={shortDate(renews)} sub={`in ${t.months} months`} />
        </div>

        <div className="cmp">
          <div className="blockhead">
            {showAllTerms ? `The same ${t.usersTotal} users on a longer term` : "Your billing term"}
          </div>
          <table className="ptable mini">
            <thead>
              <tr>
                <th>How often you pay</th>
                <th className="r">Price / user / month</th>
                <th className="r">You pay each time</th>
                <th className="r">{t.mixedMonths ? "Full year at these rates" : "Total for one year"}</th>
                {showAllTerms && <th className="r">You save in a year</th>}
              </tr>
            </thead>
            <tbody>
              {termRows.map((row) => (
                <tr key={row.term} className={showAllTerms && row.quoted ? "picked" : undefined}>
                  <td>
                    {TERM_LABEL[row.term]}
                    {showAllTerms && row.quoted ? " (quoted)" : ""}{" "}
                    <span className="mo">· {row.months} months</span>
                  </td>
                  <td className="r">₹{inr(row.ratePerMonth)}</td>
                  <td className="r">₹{inr(row.subtotal)}</td>
                  <td className="r">
                    <b>₹{inr(row.annualised)}</b>
                  </td>
                  {showAllTerms && (
                    <td className="r">
                      {row.savingVsQuarterly > 0 ? (
                        <b className="save">₹{inr(row.savingVsQuarterly)}</b>
                      ) : (
                        "—"
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="blockhead">Terms & conditions — nothing hidden</div>
        {/* One clause per line, numbered, stacked. Three bordered columns read
            as a feature grid; a prospect reads terms down the page. Each clause
            is its own sentence opening with what it is about, so the list can
            be skimmed without the headings that used to carry that job. */}
        <div className="terms">
          {[
            <>
              <b>Proposal validity</b> — valid for <b>{data.validDays} days</b> from the date of
              issue ({prettyDate}).
            </>,
            <>
              <b>Payment terms</b> — 100% advance; the {noun}’s subscription is payable in full
              before onboarding begins.
            </>,
            <>
              <b>Platform availability</b> — the field app is on Android and the admin dashboard
              runs in any web browser. <b>There is no iOS (iPhone) app</b> at this time.
            </>,
            <>
              <b>All-inclusive cost</b> — software, server, maintenance, implementation, and
              training & support are included; nothing on this list is billed separately.
            </>,
            gst ? (
              <>
                <b>Taxes</b> — GST at {gstRate}% is charged as shown above. Total payable ₹
                {inr(t.grandTotal)} for the {noun}, including ₹{inr(t.gstAmount)} of GST.
              </>
            ) : (
              <>
                <b>Taxes</b> — no GST is charged. The amount payable is exactly ₹
                {inr(t.grandTotal)} for the {noun}, with nothing added on top.
              </>
            ),
            <>
              <b>Customization</b> — anything beyond this quotation carries extra charges. Please
              obtain a separate quote for customization before placing your order.
            </>,
          ].map((body, i) => (
            <div className="term" key={i}>
              <span className="n">{i + 1}</span>
              <p>{body}</p>
            </div>
          ))}
        </div>

        <Pfoot client={full} label={content.footerLabel} n="02" />
      </section>
    </div>
  );
}
