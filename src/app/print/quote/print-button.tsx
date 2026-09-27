"use client";

/**
 * One page of text, no cover and no web font, so unlike the proposal view this
 * one is safe to print as soon as it loads — but the founder is usually reading
 * the figures aloud before he sends it, so the dialog stays on his click.
 */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="print-hide"
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        background: "#1F3A5F",
        color: "#fff",
        border: "none",
        padding: "10px 16px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        boxShadow: "0 4px 12px rgba(0,0,0,.2)",
      }}
    >
      Download PDF
    </button>
  );
}
