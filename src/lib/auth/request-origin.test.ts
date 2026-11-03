import { describe, expect, it } from "vitest";
import { requestOrigin } from "./request-origin";

function req(url: string, headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

describe("requestOrigin", () => {
  it("uses the request's own origin when nothing is proxying", () => {
    expect(requestOrigin(req("http://localhost:3000/auth/callback"))).toBe(
      "http://localhost:3000",
    );
  });

  it("prefers the host the proxy forwarded", () => {
    const origin = requestOrigin(
      req("http://10.0.0.5/auth/callback", {
        "x-forwarded-host": "app.ozzo.co.in",
        "x-forwarded-proto": "https",
      }),
    );
    expect(origin).toBe("https://app.ozzo.co.in");
  });

  it("takes the first entry when a chain of proxies appends its own", () => {
    const origin = requestOrigin(
      req("http://10.0.0.5/auth/callback", {
        "x-forwarded-host": "app.ozzo.co.in, internal.vercel.app",
        "x-forwarded-proto": "https, http",
      }),
    );
    expect(origin).toBe("https://app.ozzo.co.in");
  });

  it("falls back to the request's scheme when only the host is forwarded", () => {
    const origin = requestOrigin(
      req("http://10.0.0.5/auth/callback", {
        "x-forwarded-host": "app.ozzo.co.in",
      }),
    );
    expect(origin).toBe("http://app.ozzo.co.in");
  });
});
