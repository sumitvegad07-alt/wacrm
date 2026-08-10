import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./meta-api", () => ({
  debugToken: vi.fn(),
  verifyPhoneNumber: vi.fn(),
  getSubscribedApps: vi.fn(),
  subscribeWabaToApp: vi.fn(),
}));

import { checkConnectionHealth } from "./connection-health";
import {
  debugToken,
  getSubscribedApps,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from "./meta-api";

const mockDebug = vi.mocked(debugToken);
const mockPhone = vi.mocked(verifyPhoneNumber);
const mockSubs = vi.mocked(getSubscribedApps);
const mockSubscribe = vi.mocked(subscribeWabaToApp);

const DAY = 86_400_000;
const args = { phoneNumberId: "pn-1", wabaId: "waba-1", accessToken: "tok" };

function healthyToken(expiresInDays: number | null = null) {
  mockDebug.mockResolvedValue({
    isValid: true,
    expiresAt: expiresInDays === null ? null : Math.floor((Date.now() + expiresInDays * DAY) / 1000),
    type: expiresInDays === null ? "SYSTEM_USER" : "USER",
  });
}

beforeEach(() => {
  mockPhone.mockResolvedValue({ id: "pn-1", display_phone_number: "+91 98765 43210" });
  mockSubs.mockResolvedValue([{ whatsapp_business_api_data: { id: "app-1" } }]);
  mockSubscribe.mockResolvedValue(undefined);
});

describe("checkConnectionHealth — healthy", () => {
  it("reports healthy for a permanent token with everything wired up", async () => {
    healthyToken(null);
    const h = await checkConnectionHealth(args);

    expect(h.level).toBe("healthy");
    expect(h.checks.tokenIsPermanent).toBe(true);
    expect(h.checks.tokenDaysRemaining).toBeNull();
    expect(h.checks.phoneReachable).toBe(true);
    expect(h.checks.subscribedToWaba).toBe(true);
    expect(h.actions).toEqual([]);
  });

  it("does not nag about expiry when the token never expires", async () => {
    healthyToken(null);
    const h = await checkConnectionHealth(args);
    expect(h.summary).not.toMatch(/expire/i);
  });

  it("stays healthy when expiry is comfortably far off", async () => {
    healthyToken(90);
    const h = await checkConnectionHealth(args);
    expect(h.level).toBe("healthy");
  });
});

describe("checkConnectionHealth — token expiry", () => {
  it("warns a week ahead so there is time to act", async () => {
    healthyToken(5);
    const h = await checkConnectionHealth(args);
    expect(h.level).toBe("warning");
    expect(h.summary).toMatch(/expires in 5 days/i);
    expect(h.actions[0]).toMatch(/never expire/i);
  });

  it("uses singular wording for tomorrow", async () => {
    healthyToken(1.4);
    const h = await checkConnectionHealth(args);
    expect(h.summary).toMatch(/expires tomorrow/i);
  });

  it("reports a whole number of days rather than truncating to one fewer", async () => {
    // Meta reports expiry to the second, so a token exactly 5 days out arrives
    // as 4.9999 days. Truncating would say "4 days" — quietly wrong.
    healthyToken(5);
    const h = await checkConnectionHealth(args);
    expect(h.checks.tokenDaysRemaining).toBe(5);
  });

  it("escalates to broken inside the last 24 hours, however it rounds", async () => {
    // The Developer Console 24-hour token case: working right now, dead within
    // hours, and nothing in the product would otherwise say so. 20 hours rounds
    // to "1 day", but it dies today and must be treated as such.
    healthyToken(20 / 24);
    const h = await checkConnectionHealth(args);
    expect(h.level).toBe("broken");
    expect(h.summary).toMatch(/expires today/i);
  });

  it("escalates to broken when already expired", async () => {
    healthyToken(0);
    const h = await checkConnectionHealth(args);
    expect(h.level).toBe("broken");
    expect(h.summary).toMatch(/expires today/i);
  });

  it("reports broken when Meta rejects the token outright", async () => {
    mockDebug.mockResolvedValue({ isValid: false, expiresAt: null, error: "Session expired" });
    const h = await checkConnectionHealth(args);
    expect(h.level).toBe("broken");
    expect(h.summary).toMatch(/no longer accepted/i);
    expect(h.actions.join(" ")).toMatch(/System User token/i);
  });

  it("does not call Meta further once the token is known dead", async () => {
    mockDebug.mockResolvedValue({ isValid: false, expiresAt: null });
    await checkConnectionHealth(args);
    expect(mockPhone).not.toHaveBeenCalled();
    expect(mockSubs).not.toHaveBeenCalled();
  });

  it("survives debugToken throwing", async () => {
    mockDebug.mockRejectedValue(new Error("network down"));
    const h = await checkConnectionHealth(args);
    expect(h.level).toBe("broken");
  });
});

describe("checkConnectionHealth — inbound subscription", () => {
  it("self-heals a lapsed subscription without a reconnection", async () => {
    // The exact failure that looks like nothing is wrong: outbound keeps
    // working, replies silently never arrive.
    healthyToken(null);
    mockSubs.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { whatsapp_business_api_data: { id: "app-1" } },
    ]);

    const h = await checkConnectionHealth({ ...args, repair: true });

    expect(mockSubscribe).toHaveBeenCalledWith({ wabaId: "waba-1", accessToken: "tok" });
    expect(h.checks.subscriptionRepaired).toBe(true);
    expect(h.checks.subscribedToWaba).toBe(true);
    expect(h.level).toBe("healthy");
    expect(h.summary).toMatch(/restored automatically/i);
  });

  it("leaves it alone when repair is off, and reports the problem", async () => {
    healthyToken(null);
    mockSubs.mockResolvedValue([]);

    const h = await checkConnectionHealth({ ...args, repair: false });

    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(h.level).toBe("warning");
    expect(h.summary).toMatch(/incoming messages will not arrive/i);
  });

  it("reports a warning when the repair attempt itself fails", async () => {
    healthyToken(null);
    mockSubs.mockResolvedValue([]);
    mockSubscribe.mockRejectedValue(new Error("(#200) Permissions error"));

    const h = await checkConnectionHealth({ ...args, repair: true });

    expect(h.checks.subscriptionRepaired).toBe(false);
    expect(h.level).toBe("warning");
    expect(h.actions.join(" ")).toMatch(/whatsapp_business_management/i);
  });

  it("does not claim a repair when nothing needed repairing", async () => {
    healthyToken(null);
    const h = await checkConnectionHealth({ ...args, repair: true });
    expect(mockSubscribe).not.toHaveBeenCalled();
    expect(h.checks.subscriptionRepaired).toBe(false);
  });

  it("does not cry wolf when the subscription check itself fails", async () => {
    // "Could not check" is not "not subscribed". Conflating them would report a
    // working connection as broken on any network blip — the exact false signal
    // that caused a wrong diagnosis on this account.
    healthyToken(null);
    mockSubs.mockRejectedValue(new Error("ETIMEDOUT"));

    const h = await checkConnectionHealth({ ...args, repair: true });

    expect(h.checks.subscriptionState).toBe("unknown");
    expect(h.level).toBe("healthy");
    expect(h.summary).not.toMatch(/will not arrive/i);
    // And it must not fire pointless writes at Meta on an unknown.
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it("reports a definite yes distinctly from unknown", async () => {
    healthyToken(null);
    const h = await checkConnectionHealth(args);
    expect(h.checks.subscriptionState).toBe("yes");
    expect(h.checks.subscribedToWaba).toBe(true);
  });

  it("warns when no WABA id is saved at all", async () => {
    healthyToken(null);
    const h = await checkConnectionHealth({ ...args, wabaId: null });
    expect(h.level).toBe("warning");
    expect(h.summary).toMatch(/no WhatsApp Business Account ID/i);
  });
});

describe("checkConnectionHealth — phone number", () => {
  it("reports broken when the number cannot be reached", async () => {
    healthyToken(null);
    mockPhone.mockRejectedValue(new Error("(#100) Unsupported get request"));
    const h = await checkConnectionHealth(args);
    expect(h.level).toBe("broken");
    expect(h.summary).toMatch(/could not be reached/i);
    expect(h.actions.join(" ")).toMatch(/Phone Number ID/i);
  });

  it("surfaces the display number when reachable", async () => {
    healthyToken(null);
    const h = await checkConnectionHealth(args);
    expect(h.checks.phoneLabel).toBe("+91 98765 43210");
  });
});

describe("checkConnectionHealth — expiry outranks other problems", () => {
  it("prioritises an imminent expiry over a subscription warning", async () => {
    // Both are wrong, but the expiry is what stops everything.
    healthyToken(0);
    mockSubs.mockResolvedValue([]);
    const h = await checkConnectionHealth({ ...args, repair: false });
    expect(h.level).toBe("broken");
    expect(h.summary).toMatch(/expires today/i);
    expect(h.actions[0]).toMatch(/Replace the token now/i);
  });
});
