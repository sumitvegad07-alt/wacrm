import { describe, it, expect } from "vitest";
import { sanitizeRichText } from "./sanitize-html";

describe("sanitizeRichText", () => {
  it("removes <script> tags entirely", () => {
    const out = sanitizeRichText('<p>hi</p><script>alert(1)</script>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("<p>hi</p>");
  });

  it("strips inline event-handler attributes like onerror", () => {
    const out = sanitizeRichText('<img src="x" onerror="alert(document.cookie)">');
    expect(out).not.toContain("onerror");
    expect(out.toLowerCase()).not.toContain("alert(document.cookie)");
  });

  it("neutralizes javascript: URLs in links", () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">click</a>');
    expect(out.toLowerCase()).not.toContain("javascript:");
  });

  it("preserves legitimate rich-text formatting", () => {
    const input =
      '<p><strong>Bold</strong> and <em>italic</em></p>' +
      '<ul><li>one</li><li>two</li></ul>' +
      '<a href="https://ozzo.co.in">link</a>';
    const out = sanitizeRichText(input);
    expect(out).toContain("<strong>Bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain('href="https://ozzo.co.in"');
  });

  it("returns an empty string for null/undefined input", () => {
    expect(sanitizeRichText(null)).toBe("");
    expect(sanitizeRichText(undefined)).toBe("");
  });
});
