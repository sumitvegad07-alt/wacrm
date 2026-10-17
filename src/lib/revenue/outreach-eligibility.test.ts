import { describe, it, expect } from "vitest";
import { selectEligible, type DiscoveryLeadRow } from "./outreach-eligibility";

function lead(over: Partial<DiscoveryLeadRow> = {}): DiscoveryLeadRow {
  return {
    place_id: "p1",
    phone: "9876543210",
    name: "Shah Industries",
    city: "Hubballi",
    district: "Dharwada",
    state: "Karnataka",
    industry: "seeds",
    ...over,
  };
}

describe("selectEligible", () => {
  it("normalises the phone the same way the harvest did", () => {
    // The harvest wrote 91XXXXXXXXXX via normalisePhone. Matching on anything
    // else compares 9180… against 080… and finds nothing.
    const { recipients } = selectEligible([lead({ phone: "098765 43210" })], [], []);
    expect(recipients[0].phone).toBe("919876543210");
  });

  it("drops a row whose phone cannot be normalised", () => {
    const { recipients, funnel } = selectEligible([lead({ phone: "n/a" })], [], []);
    expect(recipients).toHaveLength(0);
    expect(funnel.unusablePhone).toBe(1);
  });

  it("keeps one row when a company lists several branches on one number", () => {
    const { recipients, funnel } = selectEligible(
      [lead({ place_id: "a" }), lead({ place_id: "b" })],
      [],
      [],
    );
    expect(recipients).toHaveLength(1);
    expect(funnel.duplicate).toBe(1);
  });

  it("never returns a number that has already been messaged", () => {
    const { recipients, funnel } = selectEligible([lead()], ["919876543210"], []);
    expect(recipients).toHaveLength(0);
    expect(funnel.alreadySent).toBe(1);
  });

  it("matches the already-sent list through normalisation too", () => {
    // The stored list is normalised, but a hand-pasted one may not be.
    const { funnel } = selectEligible([lead()], ["+91 98765 43210"], []);
    expect(funnel.alreadySent).toBe(1);
  });

  it("never returns a suppressed number", () => {
    const { recipients, funnel } = selectEligible([lead()], [], ["919876543210"]);
    expect(recipients).toHaveLength(0);
    expect(funnel.suppressed).toBe(1);
  });

  it("matches the suppression list through normalisation too", () => {
    // The stored list is normalised, but the founder pastes opt-outs in by
    // hand. If this stops matching, someone who asked to be left alone gets
    // messaged again.
    const { recipients, funnel } = selectEligible(
      [lead({ phone: "9876543210" })],
      [],
      ["+91 98765 43210"],
    );
    expect(funnel.suppressed).toBe(1);
    expect(recipients).toHaveLength(0);
  });

  it("matches a suppression pasted in national trunk-zero form", () => {
    const { recipients, funnel } = selectEligible(
      [lead({ phone: "9876543210" })],
      [],
      ["098765 43210"],
    );
    expect(funnel.suppressed).toBe(1);
    expect(recipients).toHaveLength(0);
  });

  it("counts suppression before already-sent so the funnel adds up", () => {
    const { funnel } = selectEligible([lead()], ["919876543210"], ["919876543210"]);
    expect(funnel.suppressed).toBe(1);
    expect(funnel.alreadySent).toBe(0);
    expect(funnel.matched).toBe(1);
    expect(funnel.toSend).toBe(0);
  });

  it("reports a funnel that accounts for every matched row", () => {
    const { funnel } = selectEligible(
      [
        lead({ place_id: "a", phone: "9876543210" }),
        lead({ place_id: "b", phone: "9876543210" }),
        lead({ place_id: "c", phone: "bad" }),
        lead({ place_id: "d", phone: "9123456780" }),
        lead({ place_id: "e", phone: "9123456781" }),
      ],
      ["919123456780"],
      [],
    );
    expect(funnel.matched).toBe(5);
    expect(
      funnel.unusablePhone + funnel.duplicate + funnel.alreadySent +
        funnel.suppressed + funnel.toSend,
    ).toBe(5);
    expect(funnel.toSend).toBe(2);
  });

  it("carries the snapshot fields through", () => {
    const { recipients } = selectEligible([lead()], [], []);
    expect(recipients[0]).toMatchObject({
      name: "Shah Industries",
      city: "Hubballi",
      district: "Dharwada",
      state: "Karnataka",
      industry: "seeds",
      place_id: "p1",
    });
  });
});
