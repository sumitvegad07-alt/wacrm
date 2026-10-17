import { describe, it, expect } from "vitest";
import { hashToken, mintToken } from "./outreach-agents";

describe("mintToken", () => {
  it("returns a token and its hash, never the same twice", () => {
    const a = mintToken();
    const b = mintToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("mints something long enough not to be guessed", () => {
    expect(mintToken().token.length).toBeGreaterThanOrEqual(32);
  });

  it("mints a token safe to paste into a header", () => {
    // base64url: no +, /, = or whitespace to mangle in transit.
    expect(mintToken().token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("hashes the token it returns", () => {
    const { token, tokenHash } = mintToken();
    expect(hashToken(token)).toBe(tokenHash);
  });
});

describe("hashToken", () => {
  it("is deterministic, so a presented token can be looked up", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("is sha256 hex", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not collide on a one-character change", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});
