import { describe, it, expect } from "vitest";
import {
  portalLoginsNoun,
  revokeLoginsConfirmText,
  seatsUsedLine,
  seatsFullText,
} from "./portal-login-text";

describe("portal login wording", () => {
  it("noun", () => {
    expect(portalLoginsNoun(0)).toBe("portal logins");
    expect(portalLoginsNoun(1)).toBe("portal login");
    expect(portalLoginsNoun(2)).toBe("portal logins");
  });

  it("revoke confirm", () => {
    expect(revokeLoginsConfirmText(0)).toBe(
      "This account has 0 portal logins in use. Removing the DMS will stop all of them signing in. Nothing is deleted. Continue?",
    );
    expect(revokeLoginsConfirmText(1)).toBe(
      "This account has 1 portal login in use. Removing the DMS will stop it signing in. Nothing is deleted. Continue?",
    );
    expect(revokeLoginsConfirmText(3)).toBe(
      "This account has 3 portal logins in use. Removing the DMS will stop all of them signing in. Nothing is deleted. Continue?",
    );
  });

  it("seats line", () => {
    expect(seatsUsedLine(0, 0)).toBe("No logins included");
    expect(seatsUsedLine(1, 1)).toBe("1 of 1 login used");
    expect(seatsUsedLine(2, 100)).toBe("2 of 100 logins used");
  });

  it("seats full", () => {
    expect(seatsFullText(1)).toBe(
      "The only portal login is in use. Remove access from another customer, or ask OZZO for more.",
    );
    expect(seatsFullText(2)).toBe(
      "All 2 portal logins are in use. Remove access from another customer, or ask OZZO for more.",
    );
  });
});
