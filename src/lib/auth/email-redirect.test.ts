import { describe, expect, it } from "vitest";
import { emailRedirectUrl } from "./email-redirect";
import { safeNextPath } from "./safe-next-path";

describe("emailRedirectUrl", () => {
  it("sends an ordinary signup to the dashboard, via the callback", () => {
    expect(emailRedirectUrl("https://app.ozzo.co.in")).toBe(
      "https://app.ozzo.co.in/auth/callback?next=%2Fdashboard",
    );
  });

  it("sends an invited user to the invitation", () => {
    expect(emailRedirectUrl("https://app.ozzo.co.in", "abc123")).toBe(
      "https://app.ozzo.co.in/auth/callback?next=%2Fjoin%2Fabc123",
    );
  });

  it("keeps the link on the origin the user is actually browsing", () => {
    expect(emailRedirectUrl("http://localhost:3000")).toContain(
      "http://localhost:3000/auth/callback",
    );
  });

  it("does not double up the slash when the origin carries one", () => {
    expect(emailRedirectUrl("https://app.ozzo.co.in/")).toBe(
      "https://app.ozzo.co.in/auth/callback?next=%2Fdashboard",
    );
  });

  it("produces a `next` the callback will accept", () => {
    const next = new URL(emailRedirectUrl("https://app.ozzo.co.in", "tok/en"))
      .searchParams.get("next");
    expect(safeNextPath(next)).toBe("/join/tok%2Fen");
  });
});
