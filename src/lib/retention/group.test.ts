import { describe, it, expect } from "vitest";
import { groupPingsByLocalDay } from "./group";
import type { Ping } from "./summarise";

function at(iso: string, user = "u1"): Ping & { user_id: string } {
  return { user_id: user, lat: 18.52, lng: 73.85, recorded_at: iso };
}

describe("groupPingsByLocalDay", () => {
  // The bug this exists to prevent: 20:30 UTC is 02:00 the NEXT day in India.
  // Grouping on the UTC date would file a rep's late evening under the wrong
  // day, split one shift across two summaries, and — because the raw pings are
  // deleted straight afterwards — make it permanent.
  it("files a ping by the account's local date, not the UTC date", () => {
    const groups = groupPingsByLocalDay([at("2026-09-20T20:30:00Z")], "Asia/Kolkata");
    expect([...groups.keys()]).toEqual(["u1|2026-09-21"]);
  });

  it("keeps a whole Indian working day in one group", () => {
    const groups = groupPingsByLocalDay(
      [
        at("2026-09-21T03:30:00Z"), // 09:00 IST
        at("2026-09-21T08:00:00Z"), // 13:30 IST
        at("2026-09-21T13:00:00Z"), // 18:30 IST
      ],
      "Asia/Kolkata",
    );

    expect(groups.size).toBe(1);
    expect(groups.get("u1|2026-09-21")!.length).toBe(3);
  });

  it("separates two users on the same day", () => {
    const groups = groupPingsByLocalDay(
      [at("2026-09-21T05:00:00Z", "u1"), at("2026-09-21T05:00:00Z", "u2")],
      "Asia/Kolkata",
    );
    expect(groups.size).toBe(2);
  });

  it("honours a different account timezone", () => {
    const groups = groupPingsByLocalDay([at("2026-09-20T20:30:00Z")], "UTC");
    expect([...groups.keys()]).toEqual(["u1|2026-09-20"]);
  });

  it("returns nothing for no pings", () => {
    expect(groupPingsByLocalDay([], "Asia/Kolkata").size).toBe(0);
  });
});
