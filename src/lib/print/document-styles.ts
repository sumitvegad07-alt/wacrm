import { paperMetrics, type PaperSize } from "./paper";

/**
 * A5 is exactly half an A4 sheet, which means its edges are 1/√2 of A4's.
 * Scaling the whole document by that factor puts an A4 layout on A5 at
 * precisely the right size, with nothing cropped and nothing reflowed into a
 * different shape.
 */
export const A5_SCALE = 0.7071;

/**
 * The print stylesheet for a single-record document (order, quotation,
 * dispatch, payment, invoice, expense, leave).
 *
 * Why scale rather than restyle: these documents are rendered from the
 * account's own template, which the customer edits in Settings → Document
 * Templates. Their fonts, spacing and column widths are data, not CSS this
 * code controls, so there is nothing here to step down a size the way the
 * report print does. Shrinking the finished sheet is the only approach that
 * keeps an A5 copy identical to the A4 one the customer designed.
 *
 * `zoom` rather than `transform: scale()` deliberately: zoom reflows the
 * content, so a long document still breaks cleanly across pages. A transform
 * paints the same box smaller and leaves page two sitting under page one.
 */
export function documentPrintCss(size: PaperSize): string {
  const { margin } = paperMetrics(size);
  const zoom = size === "A5" ? A5_SCALE : 1;

  return `
    @media print {
      body {
        background: white;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        margin: 0;
        ${zoom === 1 ? "" : `zoom: ${zoom};`}
      }
      @page { margin: ${margin}; size: ${size} portrait; }
      .print-hide { display: none !important; }
    }
  `;
}
