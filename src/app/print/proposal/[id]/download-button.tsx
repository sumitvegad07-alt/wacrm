"use client";

/**
 * Deliberately does NOT auto-print, unlike the order/payment print views.
 *
 * Those documents are a single page of text; this one is eight pages with a
 * full-bleed dark cover, a web font and a logo, and firing print before they
 * load produces a PDF with the cover missing. The founder also wants to read
 * the proposal over before sending it, so opening the dialog is his click.
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
        Choose “Save as PDF”. If the cover prints white, switch on “Background graphics” under More
        settings.
      </span>
    </div>
  );
}
