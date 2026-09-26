// ============================================================
// The eight proposal pages, for any plan.
//
// Structure, layout and the CSS are the original Shaahi Niti document. The
// words come from a per-plan content pack, and every repeated figure comes
// from computeTotals — so a CRM proposal cannot promise field-sales features,
// and no page can disagree with another about the price.
//
// Pages 1, 7 and 8 (cover, terms, thank-you) are structural: their wording is
// the same whatever the plan, apart from values the founder types.
// ============================================================

import { Fragment } from "react";
import type { ProposalData } from "../types";
import type { PlanContent } from "./content-types";
import type { FeatureGroup } from "../plan-features";
import { computeTotals } from "../totals";
import { formatLongDate, inr } from "../format";
import { RichText } from "./rich-text";
import "./proposal.css";

/** Fills {industry}, {rate} and {permonth} in a copy string. */
function fill(text: string, tokens: Record<string, string>): string {
  return (text ?? "").replace(/\{(\w+)\}/g, (whole, key) =>
    key in tokens ? tokens[key] : whole,
  );
}

/** Most features the two-column layout holds before it must tighten. */
const FEATURES_PER_ROOMY_PAGE = 40;

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

export function ProposalPages({
  data,
  content,
  groups,
}: {
  data: ProposalData;
  content: PlanContent;
  /** From plan-features.ts — exactly what this plan is sold. */
  groups: FeatureGroup[];
}) {
  const t = computeTotals(data.lineItems ?? [], {
    gstEnabled: !!data.gstEnabled,
    gstRate: Number(data.gstRate) || 0,
  });

  const full = data.client?.name || "—";
  const short = data.client?.shortName || data.client?.name || "—";
  const gst = !!data.gstEnabled;
  const gstRate = Number(data.gstRate) || 0;
  const prettyDate = formatLongDate(data.proposalDate);
  const featureCount = groups.reduce((n, g) => n + g.li.length, 0);

  const tokens = {
    industry: data.voice?.industryPlural ?? "",
    rate: inr(t.headlineRate),
    permonth: inr(t.perUserPerMonth),
  };
  const copy = (text: string) => fill(text, tokens);

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
            <div className="eyebrow on-ink">{content.eyebrow}</div>
            <h1>
              {content.cover.headline}
              <br />
              <span className="gb">{content.cover.headlineAccent}</span>
            </h1>
            <p className="subline">
              {content.cover.subline} A tailored proposal for{" "}
              <b style={{ color: "#fff" }}>{full}</b>.
            </p>

            <div className="hl-strip">
              {content.cover.highlights.map((h) => (
                <div className="hl" key={h.k}>
                  <div className="k">{h.k}</div>
                  <div className="v">{h.v}</div>
                </div>
              ))}
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

      {/* ══════════ PAGE 2 · INVESTMENT ══════════ */}
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
          {content.why.map((line) => (
            <div className="w" key={line}>
              <span className="ic">✓</span>
              <span>
                <RichText text={copy(line)} />
              </span>
            </div>
          ))}
        </div>

        <Pfoot client={full} label={content.footerLabel} n="02" />
      </section>

      {/* ══════════ PAGE 3 · FIVE QUESTIONS ══════════ */}
      <section className="page">
        <Minihead tag="Why OZZO" />
        <div className="section-head">
          <div className="eyebrow">{content.questions.eyebrow}</div>
          <h2>
            {content.questions.heading} <span className="gt">{content.questions.headingAccent}</span>
          </h2>
          <p className="sub">{data.voice?.built}</p>
        </div>

        <div className="qa">
          {content.questions.rows.map((row) => (
            <div className="qrow" key={row.q}>
              <div className="q">
                <span className="badge">?</span>
                <span className="t">{row.q}</span>
              </div>
              <div className="a">
                <span className="tick">✓</span>
                <span className="t">
                  <RichText text={copy(row.a)} />
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="signoff">
          <RichText text={copy(content.questions.signoff)} />
        </div>

        <Pfoot client={full} label={content.footerLabel} n="03" />
      </section>

      {/* ══════════ PAGE 4 · FEATURE TILES ══════════ */}
      <section className="page">
        <Minihead tag="What you get" />
        <div className="section-head">
          <div className="eyebrow">{content.toolkit.eyebrow}</div>
          <h2>
            {content.toolkit.heading} <span className="gt">{content.toolkit.headingAccent}</span>
          </h2>
        </div>

        <div className="cards">
          {content.toolkit.tiles.map((tile, i) => (
            <div className="mcard" key={tile.h}>
              <div className="top">
                <span className="num">{i + 1}</span>
                <h4>{tile.h}</h4>
              </div>
              <ul>
                {tile.li.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Pfoot client={full} label={content.footerLabel} n="04" />
      </section>

      {/* ══════════ PAGE 5 · THE DIFFERENCE ══════════ */}
      <section className="page">
        <Minihead tag="The difference" />
        <div className="section-head">
          <div className="eyebrow">{content.band.eyebrow}</div>
          <h2>
            {content.band.heading} <span className="gt">{content.band.headingAccent}</span>
          </h2>
        </div>

        <div className="band">
          <div className="grid-bg" />
          <div className="glow" />
          <div className="inner">
            <h3>
              {content.band.innerHeading} <span className="gb">{content.band.innerHeadingAccent}</span>
            </h3>
            <p className="sub">{copy(content.band.sub)}</p>

            <div className="stepper">
              {/* Fragment, not a wrapper div: .stepper is a flex row whose
                  direct children are the steps and the arrows between them. */}
              {content.band.stepper.map((step, i) => (
                <Fragment key={step.ev}>
                  {i > 0 && <div className="arrow">→</div>}
                  <div className="st">
                    <div className="ev">{step.ev}</div>
                    <div className="rz">
                      <RichText text={step.rz} />
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>

            <div className="two">
              {content.band.boxes.map((box) => (
                <div className="box" key={box.h}>
                  <div className="h">
                    <span className="dot" style={{ background: box.dot }} />
                    <h4>{box.h}</h4>
                  </div>
                  <p>{box.p}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="section-head" style={{ marginTop: "22px" }}>
          <div className="eyebrow">{content.band.splitEyebrow}</div>
          <h2 style={{ fontSize: "22px" }}>
            {content.band.splitHeading}{" "}
            <span className="gt">{content.band.splitHeadingAccent}</span>
          </h2>
        </div>
        <div className="split">
          {content.band.panes.map((pane) => (
            <div className="s" key={pane.cap}>
              <div className="cap">{pane.cap}</div>
              <h4>{pane.h}</h4>
              <p>{pane.p}</p>
            </div>
          ))}
        </div>

        <Pfoot client={full} label={content.footerLabel} n="05" />
      </section>

      {/* ══════════ PAGE 6 · YOUR PLAN (INCLUDED) ══════════ */}
      <section className="page">
        <Minihead tag="Your plan" />
        <div className="section-head">
          <div className="eyebrow">{content.included.eyebrow}</div>
          <h2>
            {content.included.heading} <span className="gt">{content.included.headingAccent}</span>{" "}
            {content.included.headingTail}
          </h2>
          <p className="sub">{copy(content.included.sub)}</p>
        </div>

        <div className="plan-hero">
          <div>
            <div className="tag">Your plan</div>
            <h3>{content.planName}</h3>
          </div>
          <div className="p">
            <div className="amt">
              <span className="cur">₹</span>
              {inr(t.headlineRate)}
            </div>
            <div className="u">per user / year · all features</div>
          </div>
        </div>

        {/* Measured on the real sheet: up to 38 features (SFA) fit the roomy
            two-column grid; CRM + SFA's ~46 overflow it, and the page clips
            without warning. Past the budget the grid tightens itself. */}
        <div className={`feat-grid${featureCount > FEATURES_PER_ROOMY_PAGE ? " dense" : ""}`}>
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
          ✓ <b>Everything above is included</b> in your ₹{inr(t.headlineRate)} / user / year — there
          are no per-module charges and no hidden fees.
        </div>

        <Pfoot client={full} label={content.footerLabel} n="06" />
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

        <Pfoot client={full} label={content.footerLabel} n="07" />
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
