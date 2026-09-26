import { beforeEach, describe, expect, test, vi } from "vitest";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";

// The proposal store holds OZZO's own quoted prices, so the only thing these
// tests care about is that nothing reaches the service-role client until
// requireFounder() has approved the caller.
const requireFounder = vi.fn();
const serviceClient = vi.fn(() => {
  throw new Error("serviceClient must not be called before the founder check passes");
});

vi.mock("@/lib/auth/superadmin", () => ({
  requireFounder: () => requireFounder(),
  serviceClient: () => serviceClient(),
}));

describe("GET /api/admin/proposals", () => {
  beforeEach(() => {
    requireFounder.mockReset();
    serviceClient.mockClear();
  });

  test("401s when nobody is signed in", async () => {
    requireFounder.mockRejectedValue(new UnauthorizedError("Not signed in"));
    const { GET } = await import("./route");

    const res = await GET();

    expect(res.status).toBe(401);
    expect(serviceClient).not.toHaveBeenCalled();
  });

  test("403s a superadmin who is not the founder", async () => {
    requireFounder.mockRejectedValue(
      new ForbiddenError("Only the platform owner can change superadmin access"),
    );
    const { GET } = await import("./route");

    const res = await GET();

    expect(res.status).toBe(403);
    expect(serviceClient).not.toHaveBeenCalled();
  });
});
