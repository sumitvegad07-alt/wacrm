// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accountLines } from "@/lib/plans/catalog";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: async () => ({ data: 0, error: null }), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
}));

import { PortalAccessBlock } from "./portal-access-block";

describe("DMS gating", () => {
  it("hasDMS source: false without the add-on, true with it", () => {
    expect(accountLines("Basic", []).dms).toBe(false);
    expect(accountLines("Basic", undefined).dms).toBe(false);
    expect(accountLines("Basic", ["dms"]).dms).toBe(true);
  });

  it("renders nothing at all when hasDMS is false", () => {
    auth.value = { hasDMS: false, canManageMembers: true, account: { portal_seats_limit: 5 }, accountId: "a" };
    const { container } = render(<PortalAccessBlock contactId="c1" onChanged={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a non-admin even with the add-on", () => {
    auth.value = { hasDMS: true, canManageMembers: false, account: { portal_seats_limit: 5 }, accountId: "a" };
    const { container } = render(<PortalAccessBlock contactId="c1" onChanged={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the block when hasDMS is true", () => {
    auth.value = { hasDMS: true, canManageMembers: true, account: { portal_seats_limit: 5 }, accountId: "a" };
    const { container } = render(<PortalAccessBlock contactId="c1" onChanged={() => {}} />);
    expect(container.textContent).toContain("Provide DMS Access");
  });
});
