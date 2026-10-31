// ============================================================
// The printable invoice. One component, two variants.
//
// Pure props in, markup out, with no hooks and no data fetching, so the
// variants are unit-testable: the GST one must print both GSTINs and the right
// pair of tax rows; the non-GST one must print no GSTIN and no tax anywhere.
//
// A4 at `size: A4; margin: 0`, like the proposal document. Every figure comes
// from the stored COLUMNS, never recomputed here: this renders the record, not
// a fresh calculation of it.
//
// Deliberately plain — black on white with grey rules — so it prints correctly
// without Chrome's "Background graphics" option, which the proposal cover needs
// and an invoice should not.
// ============================================================

import { formatCurrency } from "@/lib/currency";
import { gstStateName } from "@/lib/gst/states";
import { PLAN_LABEL, type PlanId } from "@/lib/plans/catalog";
import { TERM_LABEL } from "@/lib/plans/pricing";
import { amountInWords, lineAmount } from "../totals";
import type { InvoiceRow } from "../types";

const CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
.inv {
  width: 210mm; min-height: 297mm; padding: 14mm 14mm 12mm;
  margin: 0 auto; background: #fff; color: #111;
  font-family: ui-sans-serif, system-ui, "Segoe UI", Arial, sans-serif;
  font-size: 11px; line-height: 1.45; position: relative;
}
.inv h1 { margin: 0; font-size: 20px; letter-spacing: 0.08em; }
.inv .muted { color: #666; }
.inv .rule { border-top: 1px solid #bbb; margin: 10px 0; }
.inv .row { display: flex; justify-content: space-between; gap: 16px; }
.inv .box { border: 1px solid #bbb; padding: 8px 10px; }
.inv table { width: 100%; border-collapse: collapse; }
.inv th, .inv td { border: 1px solid #bbb; padding: 6px 8px; text-align: left; vertical-align: top; }
.inv th { background: #f3f3f3; font-weight: 600; }
.inv td.num, .inv th.num { text-align: right; white-space: nowrap; }
.inv .totals { width: 70mm; margin-left: auto; }
.inv .totals td { border: none; padding: 3px 0; }
.inv .totals td.num { border: none; }
.inv .totals tr.grand td { border-top: 1px solid #111; font-weight: 700; font-size: 12px; padding-top: 6px; }
.inv .sign { height: 54px; }
.inv .watermark {
  position: absolute; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-24deg);
  font-size: 68px; font-weight: 800; letter-spacing: 0.12em; color: rgba(0,0,0,0.08);
  pointer-events: none;
}
@media print { .print-hide { display: none !important; } }
`;

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="muted">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

/**
 * A charge's description, split into the lines that were typed.
 *
 * Blank lines are dropped so a stray Enter at the end of the box cannot open a
 * gap inside a table row — the same rule the quotation's rows follow.
 */
function descriptionLines(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function InvoiceDocument({ invoice }: { invoice: InvoiceRow }) {
  const gst = invoice.gst_enabled;
  const seller = invoice.data?.seller;
  const buyer = invoice.data?.buyer;
  const lines = invoice.data?.lines ?? [];

  // Half the rate each, matching how the stored amounts were computed.
  const half = invoice.gst_rate / 2;
  const posName = gstStateName(invoice.place_of_supply_code);

  // One conditional string, never assembled from parts: the non-GST document
  // must not contain the words "TAX INVOICE" anywhere.
  const title = gst ? "TAX INVOICE" : "INVOICE";

  // A watermark only for a document that is not a live invoice.
  const watermark =
    invoice.status === "draft" ? "DRAFT" : invoice.status === "cancelled" ? "CANCELLED" : null;

  const hasBank = !!(seller?.bankName || seller?.bankAccountNo || seller?.upiId);

  // Blank lines dropped so a stray Enter in the Offer box cannot open a gap in
  // the printed document.
  const offerLines = (invoice.data?.offer ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="inv">
      <style>{CSS}</style>

      {watermark ? <div className="watermark">{watermark}</div> : null}

      {/* ---------------- header ---------------- */}
      <div className="row">
        <div>
          {seller?.logoUrl ? (
            // A plain <img>: the URL is user-uploaded with unknown dimensions,
            // and next/image would need a loader this print route does not run.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={seller.logoUrl}
              alt=""
              style={{ height: "40px", width: "auto", marginBottom: "6px" }}
            />
          ) : null}
          <div style={{ fontSize: "14px", fontWeight: 700 }}>{seller?.firmName}</div>
          {seller?.address ? <div className="muted">{seller.address}</div> : null}
          {seller?.pincode || seller?.state ? (
            <div className="muted">
              {[seller?.state, seller?.pincode].filter(Boolean).join(" — ")}
            </div>
          ) : null}
          {seller?.phone ? <div className="muted">Phone: {seller.phone}</div> : null}
          {seller?.email ? <div className="muted">Email: {seller.email}</div> : null}
          {gst && seller?.gstin ? <Field label="GSTIN" value={seller.gstin} /> : null}
          {seller?.pan ? <Field label="PAN" value={seller.pan} /> : null}
        </div>

        <div style={{ textAlign: "right" }}>
          <h1>{title}</h1>
          <div style={{ marginTop: "6px", fontWeight: 600 }}>{invoice.invoice_no}</div>
        </div>
      </div>

      <div className="rule" />

      {/* ---------------- parties ---------------- */}
      <div className="row">
        <div className="box" style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: "3px" }}>Billed To</div>
          <div style={{ fontWeight: 600 }}>{buyer?.name}</div>
          {buyer?.address ? <div className="muted">{buyer.address}</div> : null}
          {buyer?.state || buyer?.pincode ? (
            <div className="muted">
              {[buyer?.state, buyer?.pincode].filter(Boolean).join(" — ")}
            </div>
          ) : null}
          {buyer?.contactPerson ? <Field label="Contact" value={buyer.contactPerson} /> : null}
          {buyer?.phone ? <Field label="Phone" value={buyer.phone} /> : null}
          {gst && buyer?.gstin ? <Field label="GSTIN" value={buyer.gstin} /> : null}
          {gst && posName ? (
            <Field label="Place of Supply" value={`${posName} (${invoice.place_of_supply_code})`} />
          ) : null}
        </div>

        <div className="box" style={{ flex: 1 }}>
          <Field label="Invoice Date" value={fmtDate(invoice.invoice_date)} />
          {invoice.customer_id ? <Field label="Customer ID" value={invoice.customer_id} /> : null}
          {invoice.plan ? (
            <Field label="Plan" value={PLAN_LABEL[invoice.plan as PlanId] ?? invoice.plan} />
          ) : null}
          <Field
            label="Billing Term"
            value={TERM_LABEL[invoice.billing_term] ?? invoice.billing_term}
          />
          {/* The count was only ever visible inside the plan line's own row. On
              a subscription invoice it is one of the three things being bought —
              plan, users, period — so it belongs in the header with them. */}
          {invoice.users_billed > 0 ? (
            <Field label="Users" value={String(invoice.users_billed)} />
          ) : null}
          {invoice.period_start && invoice.period_end ? (
            <Field
              label="Service Period"
              value={`${fmtDate(invoice.period_start)} to ${fmtDate(invoice.period_end)}`}
            />
          ) : null}
        </div>
      </div>

      {/* ---------------- lines ---------------- */}
      <table style={{ marginTop: "10px" }}>
        <thead>
          <tr>
            <th style={{ width: "6%" }} className="num">
              #
            </th>
            <th>Description</th>
            {gst ? <th style={{ width: "12%" }}>SAC</th> : null}
            <th style={{ width: "9%" }} className="num">
              Users
            </th>
            <th style={{ width: "9%" }} className="num">
              Months
            </th>
            <th style={{ width: "13%" }} className="num">
              Rate
            </th>
            <th style={{ width: "15%" }} className="num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="num">{i + 1}</td>
              <td>
                <div style={{ fontWeight: 600 }}>{line.label}</div>
                {descriptionLines(line.description).map((text, n) => (
                  <div key={n} className="muted">
                    {text}
                  </div>
                ))}
              </td>
              {gst ? <td>{line.sac}</td> : null}
              <td className="num">{line.users}</td>
              <td className="num">{line.months}</td>
              <td className="num">{formatCurrency(line.rate)}</td>
              <td className="num">{formatCurrency(lineAmount(line))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ---------------- totals ---------------- */}
      <table className="totals" style={{ marginTop: "10px" }}>
        <tbody>
          <tr>
            <td className="muted">Subtotal</td>
            <td className="num">{formatCurrency(invoice.subtotal)}</td>
          </tr>
          {invoice.discount_amount > 0 ? (
            <tr>
              <td className="muted">Discount</td>
              <td className="num">− {formatCurrency(invoice.discount_amount)}</td>
            </tr>
          ) : null}
          <tr>
            <td className="muted">Taxable Value</td>
            <td className="num">{formatCurrency(invoice.taxable_value)}</td>
          </tr>
          {invoice.cgst_amount > 0 ? (
            <tr>
              <td className="muted">CGST @ {half}%</td>
              <td className="num">{formatCurrency(invoice.cgst_amount)}</td>
            </tr>
          ) : null}
          {invoice.sgst_amount > 0 ? (
            <tr>
              <td className="muted">SGST @ {half}%</td>
              <td className="num">{formatCurrency(invoice.sgst_amount)}</td>
            </tr>
          ) : null}
          {invoice.igst_amount > 0 ? (
            <tr>
              <td className="muted">IGST @ {invoice.gst_rate}%</td>
              <td className="num">{formatCurrency(invoice.igst_amount)}</td>
            </tr>
          ) : null}
          <tr className="grand">
            <td>Total</td>
            <td className="num">{formatCurrency(invoice.total)}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: "8px" }}>
        <span className="muted">Amount in words: </span>
        <span style={{ fontWeight: 600 }}>{amountInWords(invoice.total)}</span>
      </div>

      {/* The offer sits here, right under the total, and not down with Notes and
          Terms: it is the one line the client is meant to read. Printed as typed,
          one line per line, and never folded into a figure above it. */}
      {offerLines.length > 0 ? (
        <div style={{ marginTop: "8px" }}>
          <div style={{ fontWeight: 600, marginBottom: "2px" }}>Offer</div>
          {offerLines.map((line, i) => (
            <div key={i} className="muted">
              {line}
            </div>
          ))}
        </div>
      ) : null}

      <div className="rule" />

      {/* ---------------- payment + declaration ---------------- */}
      <div className="row">
        <div style={{ flex: 1 }}>
          {hasBank ? (
            <div>
              <div style={{ fontWeight: 600, marginBottom: "2px" }}>Bank Details</div>
              {seller?.bankName ? <Field label="Bank" value={seller.bankName} /> : null}
              {seller?.bankAccountNo ? (
                <Field label="A/c No" value={seller.bankAccountNo} />
              ) : null}
              {seller?.ifsc ? <Field label="IFSC" value={seller.ifsc} /> : null}
              {seller?.upiId ? <Field label="UPI" value={seller.upiId} /> : null}
            </div>
          ) : null}

          {invoice.data?.notes ? (
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontWeight: 600, marginBottom: "2px" }}>Notes</div>
              <div className="muted">{invoice.data.notes}</div>
            </div>
          ) : null}

          {invoice.data?.terms ? (
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontWeight: 600, marginBottom: "2px" }}>Terms</div>
              <div className="muted">{invoice.data.terms}</div>
            </div>
          ) : null}

          {seller?.declaration ? (
            <div style={{ marginTop: "8px" }}>
              <div style={{ fontWeight: 600, marginBottom: "2px" }}>Declaration</div>
              <div className="muted">{seller.declaration}</div>
            </div>
          ) : null}
        </div>

        <div style={{ width: "60mm", textAlign: "right" }}>
          <div className="muted">For {seller?.firmName}</div>
          {seller?.signatureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={seller.signatureUrl}
              alt=""
              className="sign"
              style={{ marginTop: "4px", maxWidth: "50mm", objectFit: "contain" }}
            />
          ) : (
            <div className="sign" />
          )}
          <div style={{ borderTop: "1px solid #bbb", paddingTop: "3px" }}>
            Authorised Signatory
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A date-only column, formatted without `Date` parsing it as UTC midnight —
 * which prints as the previous day anywhere behind UTC.
 */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}
