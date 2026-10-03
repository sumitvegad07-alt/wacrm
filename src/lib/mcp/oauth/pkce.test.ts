import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isSupportedChallengeMethod, verifyPkce } from "./pkce";

function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("verifyPkce", () => {
  it("accepts a matching S256 verifier", () => {
    const v = randomBytes(32).toString("base64url");
    expect(verifyPkce(v, challengeFor(v), "S256")).toBe(true);
  });

  it("rejects a mismatched verifier", () => {
    const v = randomBytes(32).toString("base64url");
    expect(verifyPkce(v, challengeFor("something-else"), "S256")).toBe(false);
  });

  it("rejects the plain method — S256 only, per OAuth 2.1", () => {
    expect(verifyPkce("abc", "abc", "plain")).toBe(false);
  });

  it("rejects an empty verifier", () => {
    expect(verifyPkce("", challengeFor(""), "S256")).toBe(false);
  });

  it("rejects an empty challenge", () => {
    expect(verifyPkce("abc", "", "S256")).toBe(false);
  });

  it("rejects a challenge of the wrong length without throwing", () => {
    // timingSafeEqual throws on mismatched buffer lengths; a client sending a
    // truncated challenge must get a clean false, not a 500.
    const v = randomBytes(32).toString("base64url");
    expect(() => verifyPkce(v, challengeFor(v).slice(0, 10), "S256")).not.toThrow();
    expect(verifyPkce(v, challengeFor(v).slice(0, 10), "S256")).toBe(false);
  });

  it("rejects a base64 (non-url) encoding of the right digest", () => {
    // RFC 7636 mandates base64url. Accepting standard base64 too would mean
    // two encodings verify against one challenge.
    const v = "verifier-with-plus-and-slash-digest";
    const b64 = createHash("sha256").update(v).digest("base64");
    if (b64 === createHash("sha256").update(v).digest("base64url")) return;
    expect(verifyPkce(v, b64, "S256")).toBe(false);
  });

  it("is case-sensitive", () => {
    const v = randomBytes(32).toString("base64url");
    const c = challengeFor(v);
    const flipped = c
      .split("")
      .map((ch) => (ch >= "a" && ch <= "z" ? ch.toUpperCase() : ch))
      .join("");
    if (flipped === c) return;
    expect(verifyPkce(v, flipped, "S256")).toBe(false);
  });

  it("rejects an unknown method name", () => {
    expect(verifyPkce("abc", challengeFor("abc"), "S512")).toBe(false);
    expect(verifyPkce("abc", challengeFor("abc"), "")).toBe(false);
  });
});

describe("isSupportedChallengeMethod", () => {
  it("allows only S256", () => {
    expect(isSupportedChallengeMethod("S256")).toBe(true);
    expect(isSupportedChallengeMethod("plain")).toBe(false);
    expect(isSupportedChallengeMethod(undefined)).toBe(false);
  });

  it("does not accept a lowercase spelling", () => {
    expect(isSupportedChallengeMethod("s256")).toBe(false);
  });
});
