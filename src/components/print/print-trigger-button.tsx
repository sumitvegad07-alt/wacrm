"use client";

/**
 * The floating "Print" button on a print page. Hidden on paper by
 * `print-hide`, which documentPrintCss switches off at print time.
 *
 * A client component of its own so the voucher around it can stay a server
 * component and do its own data fetching.
 */
export function PrintTriggerButton() {
  return (
    <div className="print-hide fixed right-4 top-4 z-10">
      <button
        onClick={() => window.print()}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-md transition-colors hover:bg-blue-700"
      >
        Print
      </button>
    </div>
  );
}
