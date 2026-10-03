import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-next-path";

describe("safeNextPath", () => {
  it("allows a same-origin path", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
  });

  it("allows an ordinary path that merely looks suspicious", () => {
    // "/evil.com" is just a page on this origin. Only the backslash and
    // double-slash forms actually leave it.
    expect(safeNextPath("/evil.com")).toBe("/evil.com");
  });

  it("keeps the query string, which the OAuth consent screen needs", () => {
    const p = "/api/mcp/oauth/authorize?client_id=x&state=y";
    expect(safeNextPath(p)).toBe(p);
  });

  it("falls back when nothing was asked for", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });

  // Each of these would turn a real sign-in into a redirect off-site, which
  // is far more convincing than an ordinary phishing page because the
  // sign-in genuinely happened.
  it.each([
    "https://evil.com/steal",
    "http://evil.com",
    "//evil.com",
    String.raw`/\evil.com`,
    String.raw`/\\evil.com`,
    "javascript:alert(1)",
    "dashboard",
    " /dashboard",
  ])("refuses %j", (raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });

  it("refuses control characters that could split a header", () => {
    expect(safeNextPath("/dashboard\nLocation: https://evil.com")).toBeNull();
    expect(safeNextPath("/dash\u0000board")).toBeNull();
  });
});
