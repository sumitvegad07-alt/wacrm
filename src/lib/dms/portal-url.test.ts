import { describe, expect, it } from "vitest";
import { normalizePortalUrl } from "./portal-url";

describe("the address a distributor is given", () => {
  it("falls back to the live portal when nothing is set", () => {
    expect(normalizePortalUrl(undefined)).toBe("https://dms.ozzo.co.in");
    expect(normalizePortalUrl(null)).toBe("https://dms.ozzo.co.in");
    expect(normalizePortalUrl("   ")).toBe("https://dms.ozzo.co.in");
  });

  it("drops a trailing slash", () => {
    // An admin copies this and pastes it into WhatsApp. "…co.in/" and "…co.in"
    // are the same page and two different-looking links, and the one that gets
    // shared is whichever the CRM happened to render.
    expect(normalizePortalUrl("https://dms.ozzo.co.in/")).toBe("https://dms.ozzo.co.in");
    expect(normalizePortalUrl("https://dms.ozzo.co.in///")).toBe("https://dms.ozzo.co.in");
  });

  it("adds https to a bare host", () => {
    // This is the likeliest way the env var gets mis-set, and it is not a
    // cosmetic problem: `dms.ozzo.co.in` in an href is a RELATIVE path, so the
    // admin lands on app.ozzo.co.in/dms.ozzo.co.in and reports a broken portal.
    expect(normalizePortalUrl("dms.ozzo.co.in")).toBe("https://dms.ozzo.co.in");
  });

  it("leaves a deliberate http or a port alone", () => {
    // Someone testing against a local portal must not be silently upgraded to
    // https, which would not answer.
    expect(normalizePortalUrl("http://localhost:3100")).toBe("http://localhost:3100");
    expect(normalizePortalUrl("https://dms-staging.ozzo.co.in")).toBe(
      "https://dms-staging.ozzo.co.in",
    );
  });
});
