// ============================================================
// OZZO SFA proposal — the eight pages, ported from
// docs/proposals/proposal.html.
//
// The markup, copy and layout are the original document. What changed: every
// value that used to be typed into the body in two or three places now comes
// from `data` or from `computeTotals`, so the pages cannot disagree with each
// other. The figures that were quietly duplicated:
//   - the annual total   → price table, savings/GST panel, "covers everything", terms
//   - the per-user rate  → page 5 sub, plan hero, all-in line, price hero
//   - the per-month rate → price hero and a page-6 bullet
//   - the user count     → price table and "your N logins are created"
// ============================================================

import type { ProposalData } from "../../types";
import { computeTotals } from "../../totals";
import { formatLongDate, inr } from "../../format";
import "./sfa-proposal.css";

/** Page footer, identical on the seven inner pages apart from the number. */
function Pfoot({ client, n }: { client: string; n: string }) {
  return (
    <div className="pfoot">
      <span>
        <span className="b">OZZO</span> · Sales Force Automation Proposal
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

export function SfaProposalDocument({ data }: { data: ProposalData }) {
  const t = computeTotals(data.lineItems ?? [], {
    gstEnabled: !!data.gstEnabled,
    gstRate: Number(data.gstRate) || 0,
  });

  const full = data.client?.name || "—";
  const short = data.client?.shortName || data.client?.name || "—";
  const gst = !!data.gstEnabled;
  const gstRate = Number(data.gstRate) || 0;
  const prettyDate = formatLongDate(data.proposalDate);

  return (
    <div className="ozzo-doc">
      {/* ══════════ PAGE 1 · COVER ══════════ */}
      <section className="page cover">
        <div className="grid-bg" />
        <div className="glow a" />
        <div className="glow b" />
        <div className="glow c" />
        <div className="cover-inner">
          <div className="brandrow">
            <div className="logo" />
            <div>
              <div className="bn">OZZO</div>
              <div className="bt">CRM · Workforce · Field Sales — in one platform</div>
            </div>
          </div>

          <div className="hero">
            <div className="eyebrow on-ink">Sales Force Automation · Proposal</div>
            <h1>
              Put your field team
              <br />
              <span className="gb">on autopilot.</span>
            </h1>
            <p className="subline">
              Attendance, visits, orders and collections from one mobile app — while outstanding and
              stock keep themselves. A tailored proposal for{" "}
              <b style={{ color: "#fff" }}>{full}</b>.
            </p>

            <div className="hl-strip">
              <div className="hl">
                <div className="k">Field</div>
                <div className="v">Selfie + GPS attendance & live location</div>
              </div>
              <div className="hl">
                <div className="k">Sales</div>
                <div className="v">Offline order capture with branded PDF</div>
              </div>
              <div className="hl">
                <div className="k">Money</div>
                <div className="v">Self-calculating outstanding & stock</div>
              </div>
              <div className="hl">
                <div className="k">Anywhere</div>
                <div className="v">Web dashboard + Android app</div>
              </div>
            </div>
          </div>

          <div className="for">
            <div>
              <div className="lbl">Prepared for</div>
              <div className="val">{full}</div>
              <div className="val small">
                {[data.client?.industry, data.client?.website].filter(Boolean).join(" · ")}
              </div>
              <div className="val small">{data.client?.address}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="lbl">Prepared by</div>
              <div className="val">OZZO Technologies</div>
              <div className="val small">
                {[data.preparedBy?.name, data.preparedBy?.phone].filter(Boolean).join(" · ")}
              </div>
              <div className="val small">{data.preparedBy?.email} · ozzo.co.in</div>
            </div>
          </div>

          <div className="pills">
            <span className="pill hot">Proposal&nbsp;·&nbsp;{data.ref}</span>
            <span className="pill">Date&nbsp;·&nbsp;{prettyDate}</span>
            <span className="pill">Valid {data.validDays} days</span>
          </div>
        </div>
      </section>

      {/* ══════════ PAGE 2 · FIVE QUESTIONS ══════════ */}
      <section className="page">
        <Minihead tag="Why OZZO" />
        <div className="section-head">
          <div className="eyebrow">Five questions every sales owner asks</div>
          <h2>
            The questions you can&apos;t answer today — <span className="gt">answered.</span>
          </h2>
          <p className="sub">{data.voice?.built}</p>
        </div>

        <div className="qa">
          <div className="qrow">
            <div className="q">
              <span className="badge">?</span>
              <span className="t">Where is my sales team right now?</span>
            </div>
            <div className="a">
              <span className="tick">✓</span>
              <span className="t">
                Selfie + GPS attendance and <b>live location</b> for every rep, all day.
              </span>
            </div>
          </div>
          <div className="qrow">
            <div className="q">
              <span className="badge">?</span>
              <span className="t">Did they actually visit the outlet?</span>
            </div>
            <div className="a">
              <span className="tick">✓</span>
              <span className="t">
                <b>Geo-tagged, geo-fenced visits</b> — check-in only works at the shop.
              </span>
            </div>
          </div>
          <div className="qrow">
            <div className="q">
              <span className="badge">?</span>
              <span className="t">What did they book?</span>
            </div>
            <div className="a">
              <span className="tick">✓</span>
              <span className="t">
                Orders captured at the counter — <b>even offline</b> — with a branded PDF.
              </span>
            </div>
          </div>
          <div className="qrow">
            <div className="q">
              <span className="badge">?</span>
              <span className="t">How much is still outstanding?</span>
            </div>
            <div className="a">
              <span className="tick">✓</span>
              <span className="t">
                <b>Self-calculates</b> from orders & collections — plus an Ageing report.
              </span>
            </div>
          </div>
          <div className="qrow">
            <div className="q">
              <span className="badge">?</span>
              <span className="t">How much stock is really left?</span>
            </div>
            <div className="a">
              <span className="tick">✓</span>
              <span className="t">
                A <b>live stock ledger</b> derives closing stock — no godown guessing.
              </span>
            </div>
          </div>
        </div>

        <div className="signoff">
          One system, updated in real time —{" "}
          <b>no paper, no re-typing, no separate accounting software.</b> The rest of this proposal
          shows exactly what you get and what it costs.
        </div>

        <Pfoot client={full} n="02" />
      </section>

      {/* ══════════ PAGE 3 · FEATURE TILES (10) ══════════ */}
      <section className="page">
        <Minihead tag="What you get" />
        <div className="section-head">
          <div className="eyebrow">The complete SFA toolkit</div>
          <h2>
            Everything your field sales runs on — <span className="gt">in one app.</span>
          </h2>
        </div>

        <div className="cards">
          {[
            {
              n: "1",
              h: "Attendance & Live Location",
              li: [
                "Selfie + GPS check-in / check-out",
                "Present / Late / Short / Absent auto-classified",
                "Live location & day route per rep",
              ],
            },
            {
              n: "2",
              h: "Beat, Route & Territory",
              li: [
                "Monthly beat planner & assigned routes",
                "Rep sees “My Route” & outlets to visit",
                "Territory tree: state → city → area",
              ],
            },
            {
              n: "3",
              h: "Geo-tagged Visits",
              li: [
                "Every visit stamped with GPS & time",
                "Geo-fencing — check-in only at the outlet",
                "Productive visit = a visit that booked an order",
              ],
            },
            {
              n: "4",
              h: "Orders & Dispatch",
              li: [
                "Take orders at the counter — works offline",
                "Catalogue with GST / HSN & multi-unit",
                "Branded order PDF + dispatch tracking",
              ],
            },
            {
              n: "5",
              h: "Collection & Outstanding",
              li: [
                "Record collections in the field with proof",
                "Outstanding per customer, self-calculating",
                "Ageing report — who owes, how long",
              ],
            },
            {
              n: "6",
              h: "Stock in Hand",
              li: [
                "Live stock ledger per product",
                "Closing stock derived automatically",
                "No register, no separate software",
              ],
            },
            {
              n: "7",
              h: "Trade Hierarchy & Pricing",
              li: [
                "Distributor / dealer / retailer levels",
                "Customer-specific price lists",
                "Discounts controlled centrally",
              ],
            },
            {
              n: "8",
              h: "Schemes & Offers",
              li: [
                "Quantity & value based schemes",
                "Auto-applied on the order screen",
                "Season / festival offer control",
              ],
            },
            {
              n: "9",
              h: "Expenses & Travel",
              li: [
                "Submit travel & expense claims on mobile",
                "Odometer & proof attachments",
                "Manager review & approval",
              ],
            },
            {
              n: "10",
              h: "Reports & Daily Sales Report",
              li: [
                "Per-rep Daily Sales Report (DSR)",
                "Sales, Order, Payment, Visit, Ageing, Expense",
                "Leave, Holiday & Announcements built in",
              ],
            },
          ].map((card) => (
            <div className="mcard" key={card.n}>
              <div className="top">
                <span className="num">{card.n}</span>
                <h4>{card.h}</h4>
              </div>
              <ul>
                {card.li.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Pfoot client={full} n="03" />
      </section>

      {/* ══════════ PAGE 4 · NO ACCOUNTING ══════════ */}
      <section className="page">
        <Minihead tag="The difference" />
        <div className="section-head">
          <div className="eyebrow">The one that saves you money</div>
          <h2>
            No accounting software for <span className="gt">outstanding & stock.</span>
          </h2>
        </div>

        <div className="band">
          <div className="grid-bg" />
          <div className="glow" />
          <div className="inner">
            <h3>
              The numbers keep <span className="gb">themselves.</span>
            </h3>
            <p className="sub">
              Most {data.voice?.industryPlural} buy a second accounting package only to answer two
              questions. OZZO derives both — live — from the orders and payments your team already
              enters. Nothing is re-keyed.
            </p>

            <div className="stepper">
              <div className="st">
                <div className="ev">Order booked</div>
                <div className="rz">
                  <b>outstanding ↑</b> · <b>stock ↓</b>
                </div>
              </div>
              <div className="arrow">→</div>
              <div className="st">
                <div className="ev">Payment collected</div>
                <div className="rz">
                  <b>outstanding ↓</b>
                </div>
              </div>
              <div className="arrow">→</div>
              <div className="st">
                <div className="ev">Goods received</div>
                <div className="rz">
                  <b>stock ↑</b>
                </div>
              </div>
            </div>

            <div className="two">
              <div className="box">
                <div className="h">
                  <span className="dot" style={{ background: "#5ea1ff" }} />
                  <h4>Outstanding — automatic</h4>
                </div>
                <p>
                  Every order raises a party&apos;s balance; every collection lowers it. The figure
                  and the Ageing report update the instant a rep books or collects — no month-end,
                  no accountant.
                </p>
              </div>
              <div className="box">
                <div className="h">
                  <span className="dot" style={{ background: "#ec5fe6" }} />
                  <h4>Stock — automatic</h4>
                </div>
                <p>
                  A live ledger moves with every inward and dispatch. Closing stock is a running
                  balance per product, so “what&apos;s left” is always a number you can trust.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="section-head" style={{ marginTop: "22px" }}>
          <div className="eyebrow">Web + Mobile</div>
          <h2 style={{ fontSize: "22px" }}>
            You manage. They sell. <span className="gt">Same data.</span>
          </h2>
        </div>
        <div className="split">
          <div className="s">
            <div className="cap">Admin · Web dashboard</div>
            <h4>Command centre for the office</h4>
            <p>
              See live locations, approve routes & payments, manage products, prices &
              schemes, and open any report for the whole team.
            </p>
          </div>
          <div className="s">
            <div className="cap">Field · Android app</div>
            <h4>Everything a salesman needs</h4>
            <p>
              Mark attendance, follow the beat, check in at outlets, take orders offline, collect
              payments and share a branded PDF — syncing the moment the network returns.
            </p>
          </div>
        </div>

        <Pfoot client={full} n="04" />
      </section>

      {/* ══════════ PAGE 5 · YOUR PLAN (INCLUDED) ══════════ */}
      <section className="page">
        <Minihead tag="Your plan" />
        <div className="section-head">
          <div className="eyebrow">Plan & pricing — what&apos;s included</div>
          <h2>
            One plan. <span className="gt">Every feature.</span> No add-on modules.
          </h2>
          <p className="sub">
            Your price of ₹{inr(t.headlineRate)} per user, per year unlocks the entire OZZO SFA
            feature set for every login — field or admin. Nothing below is a paid extra.
          </p>
        </div>

        <div className="plan-hero">
          <div>
            <div className="tag">Your plan</div>
            <h3>OZZO SFA — Complete</h3>
          </div>
          <div className="p">
            <div className="amt">
              <span className="cur">₹</span>
              {inr(t.headlineRate)}
            </div>
            <div className="u">per user / year · all features</div>
          </div>
        </div>

        <div className="feat-grid">
          {[
            {
              h: "Field Operations",
              li: [
                "Selfie + GPS attendance",
                "Live location tracking",
                "Geo-tagged & geo-fenced visits",
                "Beat & route planner",
                "Territory management",
              ],
            },
            {
              h: "Sales & Orders",
              li: [
                "Offline order capture",
                "Product catalogue (GST / HSN)",
                "Multi-unit & branded order PDF",
                "Dispatch tracking",
                "Quotations",
              ],
            },
            {
              h: "Money & Stock",
              li: [
                "Field payment collection",
                "Self-calculating outstanding",
                "Ageing report",
                "Live stock ledger & closing stock",
                "Expense & travel claims",
              ],
            },
            {
              h: "Customers & Pricing",
              li: [
                "Distributor / dealer / retailer levels",
                "Customer-specific price lists",
                "Schemes & discounts",
                "Custom fields on every record",
                "Data import",
              ],
            },
            {
              h: "Team & Reports",
              li: [
                "Daily Sales Report (per rep)",
                "Sales · Order · Payment · Visit reports",
                "Attendance & leave classification",
                "Leave, Holiday & Announcements",
              ],
            },
            {
              h: "Platform",
              li: [
                "Web dashboard + Android app",
                "Real-time sync (web ↔ mobile)",
                "Role-based access control",
                "Onboarding, data setup & training",
                "WhatsApp & email support",
              ],
            },
          ].map((group) => (
            <div className="fgroup" key={group.h}>
              <h4>{group.h}</h4>
              {group.li.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </div>
          ))}
        </div>

        <div className="allin">
          ✓ <b>Everything above is included</b> in your ₹{inr(t.headlineRate)} / user / year — there
          are no per-module charges and no hidden fees.
        </div>

        <Pfoot client={full} n="05" />
      </section>

      {/* ══════════ PAGE 6 · INVESTMENT ══════════ */}
      <section className="page">
        <Minihead tag="Investment" />
        <div className="section-head">
          <div className="eyebrow">Simple, per-user pricing</div>
          <h2>
            One price. Every module.{" "}
            <span className="gt">{gst ? "Every user." : "No GST to add."}</span>
          </h2>
        </div>

        <div className="price-hero">
          <div className="big">
            <span className="cur">₹</span>
            {inr(t.headlineRate)}
          </div>
          <div className="per">
            per user&nbsp;/&nbsp;year
            <br />
            <span style={{ color: "var(--primary-700)", fontWeight: 600 }}>
              ≈ ₹{inr(t.perUserPerMonth)} / user / month
            </span>
          </div>
          <div className="chip">All features included</div>
        </div>

        <table className="ptable">
          <thead>
            <tr>
              <th>Item</th>
              <th className="r">Users</th>
              <th className="r">Rate / user / year</th>
              <th className="r">Amount (₹)</th>
            </tr>
          </thead>
          <tbody>
            {(data.lineItems ?? []).map((item, i) => (
              <tr key={`${item.label}-${i}`}>
                <td className="prod">
                  <b>{item.label}</b>
                  <span>{item.subLabel}</span>
                </td>
                <td className="r">{item.users}</td>
                <td className="r">{inr(Number(item.rate) || 0)}</td>
                <td className="r">{inr(t.lineAmounts[i] ?? 0)}</td>
              </tr>
            ))}

            {gst ? (
              <>
                <tr>
                  <td className="prod">
                    <b>Subtotal</b>
                  </td>
                  <td className="r">{t.usersTotal}</td>
                  <td className="r" />
                  <td className="r">{inr(t.subtotal)}</td>
                </tr>
                <tr>
                  <td className="prod">
                    <b>GST @ {gstRate}%</b>
                  </td>
                  <td className="r" />
                  <td className="r" />
                  <td className="r">{inr(t.gstAmount)}</td>
                </tr>
                <tr className="total">
                  <td>
                    Total payable / year <span className="muted">(incl. GST)</span>
                  </td>
                  <td className="r" />
                  <td className="r" />
                  <td className="r">₹ {inr(t.grandTotal)}</td>
                </tr>
              </>
            ) : (
              <tr className="total">
                <td>
                  Total payable / year <span className="muted">(all-inclusive)</span>
                </td>
                <td className="r">{t.usersTotal}</td>
                <td className="r" />
                <td className="r">₹ {inr(t.grandTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="benefit">
          <span className="ic">₹</span>
          {gst ? (
            <span className="t">
              <b>
                GST @ {gstRate}% — ₹{inr(t.gstAmount)}
              </b>{" "}
              is billed as shown above, so the total payable for the year is{" "}
              <b>₹{inr(t.grandTotal)}</b> — software, hosting, setup and support included.
            </span>
          ) : (
            <span className="t">
              <b>No GST — you save {gstRate}%.</b> OZZO is not charging GST on this proposal, so the
              amount you pay is exactly <b>₹{inr(t.grandTotal)} for the year</b> — nothing added on
              top. That&apos;s a straight ₹{inr(t.gstAmount)} saving versus a GST-billed quote.
            </span>
          )}
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

        <div className="section-head" style={{ marginTop: "18px", marginBottom: "10px" }}>
          <div className="eyebrow">Why {short} chooses OZZO</div>
        </div>
        <div className="why">
          <div className="w">
            <span className="ic">✓</span>
            <BuiltFor text={data.voice?.builtFor ?? ""} />
          </div>
          <div className="w">
            <span className="ic">✓</span>
            <span>
              <b>No second software</b> — outstanding & stock included, not extra.
            </span>
          </div>
          <div className="w">
            <span className="ic">✓</span>
            <span>
              <b>Works offline</b> — orders never wait for a signal.
            </span>
          </div>
          <div className="w">
            <span className="ic">✓</span>
            <span>
              <b>Made in India, priced for India</b> — ₹{inr(t.perUserPerMonth)}/user/month, all in.
            </span>
          </div>
          <div className="w">
            <span className="ic">✓</span>
            <span>
              <b>Live in days</b> — we set up your products & team for you.
            </span>
          </div>
          <div className="w">
            <span className="ic">✓</span>
            <span>
              <b>Real support</b> — over WhatsApp & email, from real people.
            </span>
          </div>
        </div>

        <Pfoot client={full} n="06" />
      </section>

      {/* ══════════ PAGE 7 · TERMS ══════════ */}
      <section className="page">
        <Minihead tag="Terms" />
        <div className="section-head">
          <div className="eyebrow">Clear & simple terms</div>
          <h2>
            Terms & conditions — <span className="gt">nothing hidden.</span>
          </h2>
        </div>

        <div className="terms">
          <div className="term">
            <span className="n">1</span>
            <div className="c">
              <h4>Proposal validity</h4>
              <p>
                This proposal and its pricing are <b>valid for {data.validDays} days</b> from the
                date of issue ({prettyDate}).
              </p>
            </div>
          </div>
          <div className="term">
            <span className="n">2</span>
            <div className="c">
              <h4>Payment terms</h4>
              <p>
                <b>100% advance</b> — the annual subscription is payable in full before onboarding
                begins.
              </p>
            </div>
          </div>
          <div className="term">
            <span className="n">3</span>
            <div className="c">
              <h4>Platform availability</h4>
              <p>
                The field app is available on <b>Android</b>, with the admin dashboard on any web
                browser. <b>An iOS (iPhone) app is not available</b> at this time.
              </p>
            </div>
          </div>
          <div className="term">
            <span className="n">4</span>
            <div className="c">
              <h4>All-inclusive cost</h4>
              <p>
                The quoted amount includes{" "}
                <b>software, server, maintenance, implementation, and training & support</b> —
                there are no separate charges for any of these.
              </p>
            </div>
          </div>
          <div className="term">
            <span className="n">5</span>
            <div className="c">
              <h4>Taxes</h4>
              {gst ? (
                <p>
                  <b>GST at {gstRate}% is charged as shown on the Investment page</b>. The total
                  payable is ₹{inr(t.grandTotal)} for the year, including ₹{inr(t.gstAmount)} of GST.
                </p>
              ) : (
                <p>
                  <b>No GST</b> is charged on this proposal. The amount payable is exactly ₹
                  {inr(t.grandTotal)} for the year, with nothing added on top.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="section-head" style={{ marginTop: "20px", marginBottom: "8px" }}>
          <div className="eyebrow">Getting started — live in days</div>
        </div>
        <div className="steps">
          <div className="step">
            <div className="n">1</div>
            <h4>Confirm</h4>
            <p>Approve this proposal & your {t.usersTotal} logins are created.</p>
          </div>
          <div className="step">
            <div className="n">2</div>
            <h4>Set up</h4>
            <p>We load your products, prices, outlets & team.</p>
          </div>
          <div className="step">
            <div className="n">3</div>
            <h4>Train</h4>
            <p>A short walkthrough for admin & field reps.</p>
          </div>
          <div className="step">
            <div className="n">4</div>
            <h4>Go live</h4>
            <p>Reps start selling; you watch it live.</p>
          </div>
        </div>

        <Pfoot client={full} n="07" />
      </section>

      {/* ══════════ PAGE 8 · THANK YOU ══════════ */}
      <section className="page ty">
        <div className="grid-bg" />
        <div className="glow a" />
        <div className="glow b" />
        <div className="ty-inner">
          <div className="brandmini">
            <div className="logo" />
            <div>
              <div className="bn">OZZO</div>
              <div className="bt">CRM · Workforce · Field Sales</div>
            </div>
          </div>

          <div style={{ marginTop: "auto" }}>
            <div className="eyebrow">Thank you</div>
            <h1>
              We&apos;d love to put {short}
              <br />
              <span className="gb">on OZZO.</span>
            </h1>
            <p className="thanks">
              We hope you&apos;ll find this offer in line with your requirements, and we look forward
              to working with you. Simply reply to confirm, and we&apos;ll have your team live within
              days.
            </p>

            <div className="custom-note">
              <div className="cap">A note on customization</div>
              <p>
                Please note that OZZO does not include any customizations beyond this quotation. Any
                additional customization will incur <b>extra charges</b> based on the specific
                requirements. We kindly request you to confirm and obtain a{" "}
                <b>separate quote for any customization</b> before placing your order.
              </p>
            </div>
          </div>

          <div className="sig-card">
            <div className="who">
              <div className="ta">Thank you in advance,</div>
              <div className="nm">{data.preparedBy?.name}</div>
              <div className="co">OZZO Technologies</div>
            </div>
            <div className="contact">
              <div className="l">Call / WhatsApp</div>
              <div className="v g">{data.preparedBy?.phone}</div>
              <div className="l">Email</div>
              <div className="v">{data.preparedBy?.email}</div>
              <div className="l">Web</div>
              <div className="v">ozzo.co.in</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
