import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "./rich-text";

const html = (text: string) => renderToStaticMarkup(<RichText text={text} />);

describe("RichText", () => {
  test("renders plain text unchanged", () => {
    expect(html("Orders never wait for a signal.")).toBe("Orders never wait for a signal.");
  });

  test("bolds a marked run", () => {
    expect(html("Works **offline** always")).toBe("Works <b>offline</b> always");
  });

  test("keeps the spaces around a bold run", () => {
    // The whole reason copy lives in strings: this space is what SWC eats when
    // the same sentence is written as JSX text containing an entity.
    expect(html("**Self-calculates** from orders & collections")).toBe(
      "<b>Self-calculates</b> from orders &amp; collections",
    );
  });

  test("handles several bold runs in one sentence", () => {
    expect(html("**a** and **b**")).toBe("<b>a</b> and <b>b</b>");
  });

  test("escapes HTML rather than injecting it", () => {
    expect(html("5 < 6 & 7 > 2")).toBe("5 &lt; 6 &amp; 7 &gt; 2");
  });

  test("leaves an unmatched marker alone", () => {
    expect(html("**not closed")).toBe("**not closed");
  });

  test("renders nothing for empty text", () => {
    expect(html("")).toBe("");
  });
});
