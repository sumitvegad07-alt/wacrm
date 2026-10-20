"use client";

/**
 * Deliberately does NOT auto-print, unlike the order/payment print views.
 *
 * The founder wants to read an invoice over before it goes to a customer —
 * especially the first few, while the seller details are still being filled
 * in — so opening the dialog is his click. The document is plain black on
 * white, so it needs no "Background graphics" warning the way the proposal
 * cover does.
 */
export function DownloadButton() {
  return (
    <div className="fixed top-4 right-4 print-hide flex flex-col items-end gap-2">
      <button
        onClick={() => window.print()}
        className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-semibold transition-colors"
      >
        Download PDF
      </button>
      <span className="text-[11px] text-white bg-black/70 px-2 py-1 rounded max-w-[210px] text-right leading-snug">
        Choose “Save as PDF” and A4 paper. Then attach the file in WhatsApp or email.
      </span>
    </div>
  );
}
