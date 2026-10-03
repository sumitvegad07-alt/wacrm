import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FALLBACK_BASE_URL, isLocalHost, issuerBaseUrl, originFromRequest } from "./issuer";

const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe("issuerBaseUrl", () => {
  const saved = process.env.NEXT_PUBLIC_APP_URL;
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved;
  });

  it("prefers an explicitly configured app URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.ozzo.co.in";
    expect(issuerBaseUrl(req("http://localhost:3000/x"))).toBe("https://app.ozzo.co.in");
  });

  it("strips a trailing slash from the configured URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.ozzo.co.in/";
    expect(issuerBaseUrl()).toBe("https://app.ozzo.co.in");
  });

  it("ignores a blank configured URL rather than advertising an empty issuer", () => {
    process.env.NEXT_PUBLIC_APP_URL = "   ";
    expect(issuerBaseUrl(req("https://app.ozzo.co.in/x"))).toBe("https://app.ozzo.co.in");
  });

  it("derives the origin from the proxy headers Vercel sets", () => {
    const r = req("http://10.0.0.5/x", {
      "x-forwarded-host": "app.ozzo.co.in",
      "x-forwarded-proto": "https",
    });
    expect(issuerBaseUrl(r)).toBe("https://app.ozzo.co.in");
  });

  it("takes the first proto when the proxy sends a list", () => {
    const r = req("http://10.0.0.5/x", {
      "x-forwarded-host": "app.ozzo.co.in",
      "x-forwarded-proto": "https,http",
    });
    expect(issuerBaseUrl(r)).toBe("https://app.ozzo.co.in");
  });

  it("assumes https for a public host that sends no proto", () => {
    const r = req("http://10.0.0.5/x", { host: "app.ozzo.co.in" });
    expect(issuerBaseUrl(r)).toBe("https://app.ozzo.co.in");
  });

  it("assumes http for localhost, so local development works", () => {
    const r = req("http://localhost:3000/x", { host: "localhost:3000" });
    expect(issuerBaseUrl(r)).toBe("http://localhost:3000");
  });

  it("falls back to production when there is no request at all", () => {
    expect(issuerBaseUrl()).toBe(FALLBACK_BASE_URL);
  });
});

describe("originFromRequest", () => {
  it("uses the request URL when no host header is present", () => {
    // Request() always synthesises a host header from the URL, so strip it.
    const r = new Request("https://example.com/a/b");
    expect(originFromRequest(r)).toBe("https://example.com");
  });

  it("keeps a non-default port", () => {
    const r = req("http://localhost:4000/x", { host: "localhost:4000" });
    expect(originFromRequest(r)).toBe("http://localhost:4000");
  });
});

describe("isLocalHost", () => {
  it("recognises the local development hosts", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("localhost:3000")).toBe(true);
    expect(isLocalHost("127.0.0.1:3000")).toBe(true);
    expect(isLocalHost("app.localhost:3000")).toBe(true);
  });

  it("does not treat a public host as local", () => {
    expect(isLocalHost("app.ozzo.co.in")).toBe(false);
    // A host merely containing "localhost" is not local.
    expect(isLocalHost("localhost.evil.com")).toBe(false);
  });
});
