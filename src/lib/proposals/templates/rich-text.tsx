// ============================================================
// The proposal's copy lives in content packs as plain strings, with **bold**
// for emphasis. Two reasons it is data rather than JSX:
//
//   1. Five plans share one set of pages; only the words differ.
//   2. JSX text is where SWC eats the space before an HTML entity (see
//      sfa-proposal-source.test.ts). A JS string literal has no such rule, so
//      copy written this way cannot lose its spacing.
// ============================================================

import { Fragment } from "react";

/** Splits on **bold** markers and renders the marked runs in <b>. */
export function RichText({ text }: { text: string }) {
  const parts = (text ?? "").split(/\*\*([\s\S]+?)\*\*/g);

  return (
    <>
      {parts.map((part, i) =>
        // Odd indices are the captured groups, i.e. what was inside ** **.
        i % 2 === 1 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}
