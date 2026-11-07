// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { accountLines } from "@/lib/plans/catalog";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const seats = vi.hoisted(() => ({ used: 0 as number | null }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: async () => (seats.used === null ? { data: null, error: { message: 'x' } } : { data: seats.used, error: null }), from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
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

  it("disables the switch and says why when the account has no logins included", () => {
    auth.value = { hasDMS: true, canManageMembers: true, account: { portal_seats_limit: 0 }, accountId: "a" };
    const { container } = render(<PortalAccessBlock contactId="c1" onChanged={() => {}} />);
    expect(container.textContent).toContain("no portal logins included");
    expect(container.textContent).toContain("Contact OZZO");
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps the switch usable when logins are included", () => {
    auth.value = { hasDMS: true, canManageMembers: true, account: { portal_seats_limit: 5 }, accountId: "a" };
    const { container } = render(<PortalAccessBlock contactId="c1" onChanged={() => {}} />);
    expect(container.textContent).not.toContain("no portal logins included");
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-disabled")).not.toBe("true");
  });

  const sw = (c: HTMLElement) => c.querySelector('[role="switch"]');
  const setup = (limit: number, used: number | null, hierarchy = false) => {
    seats.used = used;
    auth.value = {
      hasDMS: true,
      canManageMembers: true,
      account: { portal_seats_limit: limit, settings: { order_settings: { hierarchy_enabled: hierarchy } } },
      accountId: "a",
    };
  };

  it("disables the switch up front when every seat is used and the customer holds none", async () => {
    setup(2, 2);
    const { container } = render(<PortalAccessBlock contactId="c1" onChanged={() => {}} />);
    await waitFor(() => expect(container.textContent).toContain("All 2 portal logins are in use. Remove access from another customer, or ask OZZO for more."));
    expect(sw(container)?.getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).not.toContain("no portal logins included");
  });

  it("blocks a REVOKED customer at a full cap (a restore takes a seat)", async () => {
    setup(1, 1);
    const { container } = render(
      <PortalAccessBlock contactId="c1" portalEmail="d@x.com" portalAccess={false} portalAccessRevokedAt="2026-11-01" onChanged={() => {}} />,
    );
    await waitFor(() => expect(container.textContent).toContain("The only portal login is in use"));
    expect(sw(container)?.getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps a customer who already holds a login interactive at a full cap", async () => {
    setup(1, 1);
    const { container } = render(<PortalAccessBlock contactId="c1" portalEmail="d@x.com" portalAccess={true} onChanged={() => {}} />);
    await waitFor(() => expect(container.textContent).toContain("1 of 1 login used"));
    expect(container.textContent).not.toContain("are in use");
    expect(sw(container)?.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("does not treat an unreadable seat count as full", async () => {
    setup(1, null);
    const { container } = render(<PortalAccessBlock contactId="c1" onChanged={() => {}} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).not.toContain("are in use");
    expect(sw(container)?.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("disables the switch when order hierarchy is on and the customer has no level", () => {
    setup(5, 0, true);
    const { container } = render(<PortalAccessBlock contactId="c1" hierarchyLevel={null} onChanged={() => {}} />);
    expect(container.textContent).toContain("Set this customer's Customer Level first.");
    expect(container.textContent).toContain("while order hierarchy is on");
    expect(sw(container)?.getAttribute("aria-disabled")).toBe("true");
  });

  it("keeps a customer with a level, or with hierarchy off, interactive", () => {
    setup(5, 0, true);
    const a = render(<PortalAccessBlock contactId="c1" hierarchyLevel={2} onChanged={() => {}} />);
    expect(sw(a.container)?.getAttribute("aria-disabled")).not.toBe("true");
    a.unmount();
    setup(5, 0, false);
    const b = render(<PortalAccessBlock contactId="c1" hierarchyLevel={null} onChanged={() => {}} />);
    expect(b.container.textContent).not.toContain("Customer Level first");
    expect(sw(b.container)?.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("keeps a login holder with no Customer Level interactive under hierarchy", () => {
    setup(5, 1, true);
    const { container } = render(<PortalAccessBlock contactId="c1" portalEmail="d@x.com" portalAccess={true} hierarchyLevel={null} onChanged={() => {}} />);
    expect(container.textContent).not.toContain("Customer Level first");
    expect(sw(container)?.getAttribute("aria-disabled")).not.toBe("true");
  });
});
