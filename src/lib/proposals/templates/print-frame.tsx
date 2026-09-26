// ============================================================
// The page chrome around a printable proposal.
//
// Shared so that what gets verified is what gets printed. The screen view puts
// the sheets on a grey desk with gaps between them; print has to strip that
// padding, or the gaps push the eight A4 sheets onto ten pages.
//
// `!important` is deliberate: the desk's layout is an inline style, and an
// ordinary rule would lose to it in the print stylesheet.
// ============================================================

export function ProposalPrintFrame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        body { background: #6b6979; }
        @media print {
          body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .print-hide { display: none !important; }
          .proposal-desk { padding: 0 !important; gap: 0 !important; }
        }
      `,
        }}
      />
      <div
        className="proposal-desk"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
          padding: "12px 0",
        }}
      >
        {children}
      </div>
    </>
  );
}
