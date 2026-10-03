import { describe, expect, it } from "vitest";
import {
  checkRedirectUri,
  checkRedirectUris,
  isLoopbackHost,
  isRegisteredRedirectUri,
} from "./redirect-uri";

describe("checkRedirectUri", () => {
  it("accepts an https URI", () => {
    expect(checkRedirectUri("https://claude.ai/api/mcp/auth_callback").ok).toBe(true);
  });

  it("accepts http on loopback, for native and local clients", () => {
    expect(checkRedirectUri("http://localhost:6274/oauth/callback").ok).toBe(true);
    expect(checkRedirectUri("http://127.0.0.1:1410/callback").ok).toBe(true);
  });

  it("refuses http on a public host", () => {
    const r = checkRedirectUri("http://evil.example.com/cb");
    expect(r.ok).toBe(false);
    expect(r.problem).toMatch(/https/);
  });

  it("refuses a host that merely looks local", () => {
    // localhost.evil.com resolves wherever its owner points it.
    expect(checkRedirectUri("http://localhost.evil.com/cb").ok).toBe(false);
  });

  it("refuses a fragment, per RFC 6749", () => {
    const r = checkRedirectUri("https://example.com/cb#frag");
    expect(r.ok).toBe(false);
    expect(r.problem).toMatch(/fragment/);
  });

  it("refuses embedded credentials, which disguise the real host", () => {
    const r = checkRedirectUri("https://good.example.com@evil.example.com/cb");
    expect(r.ok).toBe(false);
  });

  it("refuses a non-http scheme", () => {
    expect(checkRedirectUri("javascript:alert(1)").ok).toBe(false);
    expect(checkRedirectUri("data:text/html,x").ok).toBe(false);
    expect(checkRedirectUri("file:///etc/passwd").ok).toBe(false);
  });

  it("refuses a relative URI", () => {
    expect(checkRedirectUri("/callback").ok).toBe(false);
  });

  it("refuses a non-string or blank entry", () => {
    expect(checkRedirectUri(undefined).ok).toBe(false);
    expect(checkRedirectUri(42).ok).toBe(false);
    expect(checkRedirectUri("   ").ok).toBe(false);
  });

  it("allows a query string, which clients legitimately use", () => {
    expect(checkRedirectUri("https://example.com/cb?tool=claude").ok).toBe(true);
  });
});

describe("checkRedirectUris", () => {
  it("accepts a list of good URIs", () => {
    expect(
      checkRedirectUris(["https://a.example.com/cb", "http://localhost:3000/cb"]).ok,
    ).toBe(true);
  });

  it("refuses an empty or missing list", () => {
    expect(checkRedirectUris([]).ok).toBe(false);
    expect(checkRedirectUris(undefined).ok).toBe(false);
    expect(checkRedirectUris("https://a.example.com/cb").ok).toBe(false);
  });

  it("refuses the whole list when one entry is bad", () => {
    const r = checkRedirectUris([
      "https://good.example.com/cb",
      "http://evil.example.com/cb",
    ]);
    expect(r.ok).toBe(false);
    expect(r.problem).toMatch(/evil/);
  });

  it("caps the list length", () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://e${i}.example.com/cb`);
    expect(checkRedirectUris(many).ok).toBe(false);
  });
});

describe("isRegisteredRedirectUri", () => {
  const registered = ["https://claude.ai/api/mcp/auth_callback"];

  it("matches exactly", () => {
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback", registered)).toBe(
      true,
    );
  });

  // A prefix comparison here is the classic open-redirector bug.
  it("does not match a longer URI that starts with a registered one", () => {
    expect(
      isRegisteredRedirectUri(
        "https://claude.ai/api/mcp/auth_callback.evil.com",
        registered,
      ),
    ).toBe(false);
  });

  it("does not match a different host", () => {
    expect(
      isRegisteredRedirectUri("https://evil.com/api/mcp/auth_callback", registered),
    ).toBe(false);
  });

  it("does not match a trailing-slash variant", () => {
    expect(
      isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback/", registered),
    ).toBe(false);
  });

  it("refuses everything when nothing is registered", () => {
    expect(isRegisteredRedirectUri("https://claude.ai/cb", [])).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it("accepts only true loopback names", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("app.localhost")).toBe(false);
    expect(isLoopbackHost("127.0.0.2")).toBe(false);
  });
});
