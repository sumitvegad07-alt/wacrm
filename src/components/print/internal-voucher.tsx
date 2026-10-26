import type { CompanyLetterhead } from "@/lib/document-templates/company-profile";
import type { PaperSize } from "@/lib/print/paper";
import { documentPrintCss } from "@/lib/print/document-styles";
import { PrintTriggerButton } from "./print-trigger-button";

export interface VoucherRow {
  label: string;
  value: string;
  /** Spans the full width — for a reason or a remark that needs room. */
  wide?: boolean;
}

/**
 * The printed sheet for an internal record: an expense voucher, a leave
 * record. One employee, a handful of facts, a status and sometimes an amount.
 *
 * Deliberately NOT built on DocumentTemplatePreview. That renderer drives the
 * four customer-facing documents (order, quotation, dispatch, payment) whose
 * layout the account edits in Settings → Document Templates, and its config
 * schema has a fixed list of exactly those four modules. Adding two more means
 * extending that schema, its capability map, its editor UI and the stored
 * config rows — a change to the Document Templates product, not a print
 * feature. These two records never leave the company, so a fixed, tidy layout
 * is worth more than an editable one.
 */
export function InternalVoucher({
  paper,
  letterhead,
  title,
  number,
  employeeName,
  employeeCode,
  rows,
  amount,
  amountLabel = "Amount",
  status,
  footNote,
}: {
  paper: PaperSize;
  letterhead: CompanyLetterhead;
  title: string;
  number: string;
  employeeName: string;
  employeeCode?: string;
  rows: VoucherRow[];
  amount?: string;
  amountLabel?: string;
  status: string;
  footNote?: string;
}) {
  return (
    <div className="min-h-screen bg-white text-black font-sans print:bg-white print:p-0 p-8">
      <style dangerouslySetInnerHTML={{ __html: documentPrintCss(paper) }} />

      <div className="mx-auto max-w-[900px] border border-gray-200 bg-white p-8 shadow-sm print:max-w-none print:border-none print:p-0 print:shadow-none">
        <PrintTriggerButton />

        {/* Letterhead */}
        <div className="flex items-start justify-between gap-6 border-b-2 border-gray-800 pb-4">
          <div className="min-w-0">
            <div className="text-xl font-extrabold uppercase tracking-wide text-gray-900">
              {letterhead.name}
            </div>
            {letterhead.addressLines.map((line, i) => (
              <div key={i} className="text-[11px] leading-snug text-gray-600">
                {line}
              </div>
            ))}
            <div className="mt-1 text-[11px] text-gray-600">
              {[letterhead.phone, letterhead.email, letterhead.website]
                .filter(Boolean)
                .join("  •  ")}
            </div>
            {letterhead.gstNumber && (
              <div className="text-[11px] text-gray-600">GSTIN: {letterhead.gstNumber}</div>
            )}
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {letterhead.logoUrl && (
            <img src={letterhead.logoUrl} alt="" className="h-14 w-auto shrink-0 object-contain" />
          )}
        </div>

        {/* Title */}
        <div className="mt-5 flex items-end justify-between gap-4">
          <div className="text-lg font-bold uppercase tracking-wider text-gray-900">{title}</div>
          <div className="text-right">
            <div className="text-base font-bold text-gray-900">{number}</div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{status}</div>
          </div>
        </div>

        {/* Who it is for */}
        <div className="mt-4 rounded border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">Employee</div>
          <div className="text-sm font-semibold text-gray-900">
            {employeeName}
            {employeeCode ? <span className="font-normal text-gray-500"> ({employeeCode})</span> : null}
          </div>
        </div>

        {/* The facts */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
          {rows.map((r) => (
            <div key={r.label} className={r.wide ? "col-span-2" : undefined}>
              <div className="text-[10px] uppercase tracking-wide text-gray-500">{r.label}</div>
              <div className="whitespace-pre-wrap text-sm text-gray-900">{r.value || "—"}</div>
            </div>
          ))}
        </div>

        {amount && (
          <div className="mt-5 flex items-center justify-end gap-6 border-t-2 border-gray-800 pt-3">
            <div className="text-sm font-semibold uppercase tracking-wide text-gray-600">
              {amountLabel}
            </div>
            <div className="text-xl font-extrabold text-gray-900">{amount}</div>
          </div>
        )}

        {footNote && <div className="mt-3 text-[11px] text-gray-500">{footNote}</div>}

        {/* Signatures. A voucher that cannot be signed is not a voucher. */}
        <div className="mt-12 grid grid-cols-3 gap-8">
          {["Prepared by", "Approved by", "Received by"].map((l) => (
            <div key={l}>
              <div className="h-10 border-b border-gray-400" />
              <div className="mt-1 text-[10px] uppercase tracking-wide text-gray-500">{l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
