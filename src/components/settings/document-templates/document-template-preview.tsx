"use client";

import {
  MODULE_CAPABILITIES,
  MODULE_LABELS,
  TOTAL_ROWS,
  visibleItemColumns,
  type DocumentInfoRow,
  type DocumentModule,
  type DocumentTemplateConfig,
  type ItemColumn,
  type PartyBlock,
  type TotalRow,
} from "@/lib/document-templates/schema";
import type { CompanyLetterhead } from "@/lib/document-templates/company-profile";

/**
 * The document itself.
 *
 * Deliberately one component for both the editor preview and the printed page. The mockup
 * had a preview that no PDF was ever generated from, which is exactly how a preview drifts
 * away from the thing it claims to show. Callers supply already-formatted strings — this
 * file lays out, it does not calculate, so currency and date rules stay with the code that
 * owns them.
 */

export interface PartyData {
  code?: string;
  name?: string;
  companyName?: string;
  address?: string;
  area?: string;
  city?: string;
  state?: string;
  pincode?: string;
  phone?: string;
  email?: string;
  gstNumber?: string;
}

export interface ItemRowData {
  itemNo: string;
  imageUrl?: string | null;
  itemCode?: string;
  hsnCode?: string;
  category?: string;
  item?: string;
  unit?: string;
  quantity?: string;
  /** Catalogue price. Printed struck through when it differs from the price charged. */
  mrp?: string;
  price?: string;
  /** Already rendered as the customer sees it — "5%" or "₹ 5.00 / unit". */
  discount?: string;
  tax?: string;
  rateInclTax?: string;
  subAmount?: string;
  netAmount?: string;
}

export interface DocumentRenderData {
  documentTitle: string;
  documentNumber: string;
  letterhead: CompanyLetterhead;
  billTo: PartyData;
  shipTo: PartyData;
  infoRows: Partial<Record<DocumentInfoRow, string>>;
  items: ItemRowData[];
  totals: Partial<Record<TotalRow, string>>;
  /** e.g. ["Total PCS : 12 (3 items)", "Total KG : 4.500 (1 item)"] */
  quantitySummary: string[];
  customFieldValues: { label: string; value: string }[];
  /** Shown instead of an amount when the payment document has no line items. */
  headlineAmount?: { label: string; value: string } | null;
}

const SAMPLE_LETTERHEAD: CompanyLetterhead = {
  name: "Your Company Name",
  logoUrl: null,
  email: "hello@example.com",
  phone: "+91 92283 08366",
  website: "",
  gstNumber: "24AADCA0479R1ZC",
  addressLines: ["8 Archana Park, University Road", "Rajkot, Gujarat, 360001", "India"],
};

const SAMPLE_PARTY: PartyData = {
  code: "C001",
  name: "Sample Contact",
  companyName: "Balaji Supermarket",
  address: "Nr. Dholakiya School",
  area: "Kalawad Road",
  city: "Rajkot",
  state: "Gujarat",
  pincode: "360005",
  phone: "+91 92283 08366",
  gstNumber: "24AAECS1234K1Z9",
};

export function buildSampleData(module: DocumentModule): DocumentRenderData {
  const isPayment = module === "payment";
  return {
    documentTitle: MODULE_LABELS[module].toUpperCase(),
    documentNumber: isPayment ? "PAY-0007" : "ORD-0012",
    letterhead: SAMPLE_LETTERHEAD,
    billTo: SAMPLE_PARTY,
    shipTo: { ...SAMPLE_PARTY, companyName: "Balaji Supermarket — Godown", code: "C001-G" },
    infoRows: {
      documentDate: "16-08-2026",
      documentStatus: isPayment ? "Approved" : "Open",
      notes: "Urgent delivery",
      createdBy: "Sumit Vegad",
      createdByEmail: "sumit@example.com",
      createdByContact: "+91 92283 08366",
      paymentType: "Cheque",
      referenceNumber: "CHQ-884213",
    },
    items: [1, 2, 3].map((n) => ({
      itemNo: String(n),
      imageUrl: null,
      itemCode: `SKU-00${n}`,
      hsnCode: "1234",
      category: "General",
      item: `Sample Product ${n}`,
      unit: "PCS",
      quantity: "10",
      mrp: "₹ 160.00",
      price: "₹ 150.00",
      discount: "5%",
      tax: "18%",
      rateInclTax: "₹ 177.00",
      subAmount: "₹ 1,500.00",
      netAmount: "₹ 1,770.00",
    })),
    totals: {
      subTotal: "₹ 4,500.00",
      discount: "₹ 200.00",
      taxSummary: "₹ 774.00",
      total: "₹ 5,074.00",
    },
    quantitySummary: ["Total PCS : 30 (3 items)"],
    customFieldValues: [],
    headlineAmount: isPayment ? { label: "Amount Received", value: "₹ 5,074.00" } : null,
  };
}

function partyLines(block: PartyBlock, data: PartyData): { heading: string; lines: string[] } {
  const lines: string[] = [];

  const title = [block.code && data.code ? `[${data.code}]` : "", block.name ? data.companyName || data.name : ""]
    .filter(Boolean)
    .join(" ");
  if (title) lines.push(title);

  if (block.name && data.companyName && data.name && data.companyName !== data.name) {
    lines.push(data.name);
  }
  if (block.address && data.address) lines.push(data.address);

  const locality = [
    block.area ? data.area : "",
    block.city ? data.city : "",
    block.statePin ? [data.state, data.pincode].filter(Boolean).join(" ") : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (locality) lines.push(locality);

  if (block.contactDetails) {
    const contact = [data.phone, data.email].filter(Boolean).join(" | ");
    if (contact) lines.push(contact);
  }
  if (block.gstDetails && data.gstNumber) lines.push(`GST : ${data.gstNumber}`);

  return { heading: block.label, lines };
}

export function DocumentTemplatePreview({
  module,
  config,
  data,
  customFields,
}: {
  module: DocumentModule;
  config: DocumentTemplateConfig;
  /** Real document data. Falls back to representative sample data inside the editor. */
  data?: DocumentRenderData;
  /** Labels for the custom fields the template selected, used by the editor preview. */
  customFields?: { id: string; label: string }[];
}) {
  const caps = MODULE_CAPABILITIES[module];
  const d = data ?? buildSampleData(module);
  const columns = visibleItemColumns(module, config);

  const customValues =
    data?.customFieldValues ??
    (customFields ?? []).map((cf) => ({ label: cf.label, value: "Sample value" }));

  const infoRows = caps.documentInfoRows.filter(
    (row) => config.documentInfo.rows[row].enabled && d.infoRows[row]
  );

  const bill = partyLines(config.documentInfo.billTo, d.billTo);
  const ship = partyLines(config.documentInfo.shipTo, d.shipTo);
  const showBill = config.documentInfo.billTo.enabled && bill.lines.length > 0;
  const showShip = config.documentInfo.shipTo.enabled && ship.lines.length > 0;

  const totalsToShow = TOTAL_ROWS.filter(
    (row) => caps.totals.includes(row) && config.itemTable.totals[row].enabled && d.totals[row]
  );

  const cellValue = (row: ItemRowData, col: ItemColumn) => {
    if (col === "image") {
      return row.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.imageUrl} alt="" className="w-8 h-8 object-cover rounded" />
      ) : (
        <div className="w-8 h-8 bg-gray-100 rounded" />
      );
    }
    // The catalogue price is struck through, matching how the order screen shows a
    // discounted line — the customer sees what the item lists at and what they paid.
    if (col === "mrp" && row.mrp) {
      return <span className="line-through text-gray-400">{row.mrp}</span>;
    }
    return (row[col as keyof ItemRowData] as string) ?? "";
  };

  return (
    <div className="flex flex-col flex-1 text-gray-800">
      {/* HEADER */}
      <div className="flex items-start justify-between border-b pb-6">
        <div className="flex items-center gap-4">
          {config.header.orgLogo &&
            (d.letterhead.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.letterhead.logoUrl} alt="" className="w-16 h-16 object-contain" />
            ) : (
              <div className="w-16 h-16 bg-blue-500 rounded-md flex items-center justify-center text-white font-bold text-xs">
                LOGO
              </div>
            ))}
          <div>
            {config.header.orgName && (
              <h1 className="text-xl font-bold text-gray-800">{d.letterhead.name}</h1>
            )}
            {config.header.orgContact && (d.letterhead.phone || d.letterhead.email) && (
              <p className="text-sm text-gray-500">
                {[d.letterhead.phone, d.letterhead.email].filter(Boolean).join(" | ")}
              </p>
            )}
            {config.header.orgGst && d.letterhead.gstNumber && (
              <p className="text-sm text-gray-500">GST No : {d.letterhead.gstNumber}</p>
            )}
            {config.header.orgAddress && d.letterhead.addressLines.length > 0 && (
              <p className="text-sm text-gray-500 mt-1 max-w-xs">
                {d.letterhead.addressLines.join(", ")}
              </p>
            )}
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-2xl text-gray-800 tracking-wider font-semibold">
            {d.documentTitle}
            {config.documentInfo.serialNo && (
              <span className="text-blue-600"> #{d.documentNumber}</span>
            )}
          </h2>
        </div>
      </div>

      {/* DOCUMENT INFO */}
      <div className="grid grid-cols-3 gap-6 py-6 border-b text-sm">
        {showBill && (
          <div>
            <h3 className="font-semibold text-gray-600 mb-2 italic">{bill.heading}</h3>
            <div className="text-gray-800 space-y-0.5">
              {bill.lines.map((line, i) => (
                <p key={i} className={i === 0 ? "font-medium text-blue-600" : ""}>
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}
        {showShip && (
          <div>
            <h3 className="font-semibold text-gray-600 mb-2 italic">{ship.heading}</h3>
            <div className="text-gray-800 space-y-0.5">
              {ship.lines.map((line, i) => (
                <p key={i} className={i === 0 ? "font-bold" : ""}>
                  {line}
                </p>
              ))}
            </div>
          </div>
        )}
        <div className="text-right space-y-1 text-gray-700">
          {infoRows.map((row) => (
            <p key={row}>
              <span className="font-medium text-gray-500">
                {config.documentInfo.rows[row].label} :
              </span>{" "}
              {d.infoRows[row]}
            </p>
          ))}
        </div>
      </div>

      {/* CUSTOM FIELDS */}
      {customValues.length > 0 && (
        <div className="grid grid-cols-4 gap-4 py-4 border-b text-xs text-gray-700">
          {customValues.map((cf, i) => (
            <div key={i}>
              <span className="font-medium text-gray-500">{cf.label} :</span> {cf.value}
            </div>
          ))}
        </div>
      )}

      {/* PAYMENT HEADLINE — a receipt has one number, not a table */}
      {!caps.itemTable && d.headlineAmount && (
        <div className="mt-8 border rounded-lg p-6 bg-gray-50 flex items-baseline justify-between">
          <span className="text-sm font-medium text-gray-600">{d.headlineAmount.label}</span>
          <span className="text-3xl font-bold text-gray-900">{d.headlineAmount.value}</span>
        </div>
      )}

      {/* ITEM TABLE */}
      {caps.itemTable && columns.length > 0 && (
        <div className="mt-6 flex-1">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="bg-gray-50 border-y">
              <tr>
                {columns.map((col) => (
                  <th key={col} className="py-3 px-2 font-semibold text-gray-700">
                    {config.itemTable.columns[col].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {d.items.map((row, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col} className="py-3 px-2 align-top">
                      {cellValue(row, col)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 border-t pt-4 flex justify-between items-start">
            <div className="flex gap-12 text-xs text-gray-700 font-medium">
              {config.bottomSections.totalQuantity.enabled &&
                d.quantitySummary.map((s, i) => <span key={i}>{s}</span>)}
            </div>

            {totalsToShow.length > 0 && (
              <div className="w-64 space-y-2 text-sm text-gray-700">
                {totalsToShow.map((row) => (
                  <div
                    key={row}
                    className={
                      row === "total"
                        ? "flex justify-between font-bold text-gray-900 border-t pt-2 text-base"
                        : "flex justify-between"
                    }
                  >
                    <span>{config.itemTable.totals[row].label}</span>
                    <span className="font-medium">{d.totals[row]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* FOOTER & SIGNATURES */}
      <div className="mt-auto border-t pt-6 text-xs text-gray-500 flex justify-between items-end">
        <div>
          {config.bottomSections.footer.enabled && config.bottomSections.footer.text.trim() !== "" && (
            <div className="whitespace-pre-line leading-relaxed">
              <p className="font-semibold text-gray-700">Terms &amp; Conditions</p>
              {config.bottomSections.footer.text}
            </div>
          )}

          {config.bottomSections.signature.enabled && (
            <div className="mt-6">
              {config.bottomSections.signature.image &&
                config.bottomSections.signature.attachmentUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={config.bottomSections.signature.attachmentUrl}
                    alt=""
                    className="h-14 object-contain mb-1"
                  />
                )}
              <p className="text-gray-800 font-medium">{config.bottomSections.signature.label}</p>
              {config.bottomSections.signature.name && (
                <p className="text-gray-500 mt-1">{config.bottomSections.signature.name}</p>
              )}
            </div>
          )}
        </div>

        {config.bottomSections.additionalSignature.enabled && (
          <div className="text-right">
            <p className="text-gray-800 font-medium">
              {config.bottomSections.additionalSignature.label}
            </p>
            {config.bottomSections.additionalSignature.name && (
              <p className="text-gray-500 mt-1">
                {config.bottomSections.additionalSignature.name}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
