import { describe, expect, it } from "vitest";
import { shareMessage } from "./share-message";

const BASE = {
  url: "https://dms.ozzo.co.in",
  loginEmail: "amrit@mahajan.com",
  companyName: "Sumit Traders",
};

describe("the message an admin sends a distributor", () => {
  it("carries the address and the login", () => {
    const text = shareMessage(BASE);
    expect(text).toContain("https://dms.ozzo.co.in");
    expect(text).toContain("amrit@mahajan.com");
    expect(text).toContain("Sumit Traders");
  });

  it("never carries a password, and says one is coming separately", () => {
    // The rule this file exists for. An admin has just typed a password into
    // the form beside this button; a message that included it would leave a
    // working credential in a WhatsApp history on two phones for good.
    const text = shareMessage({ ...BASE, loginEmail: "a@b.co" });
    // No "Password: <anything>" line — the shape a credential would take if
    // somebody later added one "to save the admin a step".
    expect(text).not.toMatch(/password\s*:/i);
    expect(text).toContain("sent to you separately");
    // And the whole message is only ever these three facts.
    expect(text).toBe(
      [
        "You can now see your orders, your customers and your account from Sumit Traders online.",
        "",
        "Website: https://dms.ozzo.co.in",
        "Your login: a@b.co",
        "",
        "Your password is being sent to you separately.",
      ].join("\n"),
    );
  });

  it("reads properly when the company name is missing", () => {
    // A tenant with no name set would otherwise get "your account from  online".
    const text = shareMessage({ ...BASE, companyName: null });
    expect(text).toContain("your account online.");
    expect(text).not.toContain("  ");
  });

  it("uses no markdown, because this is pasted into WhatsApp", () => {
    // Asterisks are formatting there and backticks are shown literally.
    expect(shareMessage(BASE)).not.toMatch(/[*_`]/);
  });
});
