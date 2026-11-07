import { describe, it, expect } from "vitest";
import { friendlyAuthError, validatePortalLogin } from "./route";

describe("portal login validation", () => {
  it("requires an email-shaped address, even though it is never delivered to", () => {
    expect(validatePortalLogin("ramesh", "secret12")).toMatch(/email/i);
    expect(validatePortalLogin("xyz@abc.com", "secret12")).toBeNull();
  });

  it("requires a password of at least 8 characters", () => {
    expect(validatePortalLogin("xyz@abc.com", "short")).toMatch(/8/);
  });

  it("turns the duplicate-email error from Supabase into something an admin can act on", () => {
    expect(
      friendlyAuthError("A user with this email address has already been registered")
    ).toBe(
      "That login is already taken. Portal logins are shared across all of OZZO, so pick another address."
    );
  });

  it("passes other errors through rather than inventing a message", () => {
    expect(friendlyAuthError("Password is too weak")).toBe("Password is too weak");
    const seats = "All 1 portal logins are in use. Remove access from another customer, or buy more.";
    expect(friendlyAuthError(seats)).toBe(seats);
  });
});
