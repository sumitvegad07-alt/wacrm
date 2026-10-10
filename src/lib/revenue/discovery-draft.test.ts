import { describe, it, expect } from "vitest";
import {
  EMPTY_DRAFT,
  PROGRESS_AUTO_RESUME_HOURS,
  PROGRESS_MAX_AGE_DAYS,
  canAutoResume,
  sanitizeDraft,
  sanitizeProgress,
  type DiscoveryDraft,
  type DiscoveryProgress,
} from "./discovery-draft";

const FULL: DiscoveryDraft = {
  industry: "seeds",
  category: "manufacturer",
  state: "Karnataka",
  districts: ["Dharwada", "Belagavi"],
  areas: ["Tarihal Industrial Area"],
  pincode: "580020",
  includeWithoutPhone: true,
  ignoreSeen: false,
};

describe("sanitizeDraft", () => {
  it("returns an empty draft for anything that is not an object", () => {
    for (const raw of [null, undefined, 7, "x", [], true]) {
      expect(sanitizeDraft(raw)).toEqual(EMPTY_DRAFT);
    }
  });

  it("keeps a valid draft intact", () => {
    expect(sanitizeDraft(FULL)).toEqual(FULL);
  });

  it("drops an industry that is no longer in the taxonomy", () => {
    expect(sanitizeDraft({ ...FULL, industry: "typewriters" }).industry).toBe("");
  });

  it("drops a category that is no longer offered", () => {
    // "retailer" is deliberately not a discovery category.
    expect(sanitizeDraft({ ...FULL, category: "retailer" }).category).toBe("");
  });

  it("drops a state that is not in the seed data, and its districts with it", () => {
    const out = sanitizeDraft({ ...FULL, state: "Atlantis" });
    expect(out.state).toBe("");
    expect(out.districts).toEqual([]);
    expect(out.areas).toEqual([]);
  });

  it("drops districts that do not belong to the state", () => {
    const out = sanitizeDraft({ ...FULL, districts: ["Dharwada", "Pune", "Belagavi"] });
    expect(out.districts).toEqual(["Dharwada", "Belagavi"]);
  });

  it("drops areas whose district is no longer selected", () => {
    // Tarihal Industrial Area is in Dharwada. Removing Dharwada must take Tarihal with it,
    // because the server cannot attribute an area to an unselected district.
    const out = sanitizeDraft({ ...FULL, districts: ["Belagavi"] });
    expect(out.areas).toEqual([]);
  });

  it("keeps only digits in the pincode, at most six", () => {
    expect(sanitizeDraft({ ...FULL, pincode: "58 00-20" }).pincode).toBe("580020");
    expect(sanitizeDraft({ ...FULL, pincode: "5800201234" }).pincode).toBe("580020");
    expect(sanitizeDraft({ ...FULL, pincode: 580020 }).pincode).toBe("");
  });

  it("coerces the tickboxes to real booleans", () => {
    const out = sanitizeDraft({ ...FULL, includeWithoutPhone: "yes", ignoreSeen: 1 });
    expect(out.includeWithoutPhone).toBe(false);
    expect(out.ignoreSeen).toBe(false);
  });

  it("ignores extra keys rather than passing them through", () => {
    const out = sanitizeDraft({ ...FULL, somethingElse: "x" });
    expect(Object.keys(out).sort()).toEqual(Object.keys(EMPTY_DRAFT).sort());
  });

  it("drops non-string entries from the lists", () => {
    const out = sanitizeDraft({ ...FULL, districts: ["Dharwada", 5, null], areas: [{}, "Tarihal Industrial Area"] });
    expect(out.districts).toEqual(["Dharwada"]);
    expect(out.areas).toEqual(["Tarihal Industrial Area"]);
  });

  it("de-duplicates districts and areas", () => {
    const out = sanitizeDraft({ ...FULL, districts: ["Dharwada", "Dharwada"], areas: ["Tarihal Industrial Area", "Tarihal Industrial Area"] });
    expect(out.districts).toEqual(["Dharwada"]);
    expect(out.areas).toEqual(["Tarihal Industrial Area"]);
  });
});

describe("sanitizeProgress", () => {
  const now = new Date("2026-10-10T10:00:00.000Z");
  const good = {
    runId: "6b1f1d6e-6b9f-4a6a-9f2a-3c4d5e6f7a8b",
    nextIndex: 47,
    planLength: 163,
    savedAt: "2026-10-10T08:00:00.000Z",
    stoppedByUser: false,
  };

  it("keeps a fresh, well-formed progress record", () => {
    expect(sanitizeProgress(good, now)).toEqual(good);
  });

  it("rejects anything that is not an object", () => {
    for (const raw of [null, undefined, 1, "x", []]) {
      expect(sanitizeProgress(raw, now)).toBeNull();
    }
  });

  it("rejects a missing or empty runId", () => {
    expect(sanitizeProgress({ ...good, runId: "" }, now)).toBeNull();
    expect(sanitizeProgress({ ...good, runId: 42 }, now)).toBeNull();
  });

  it("rejects a plan with nothing in it", () => {
    expect(sanitizeProgress({ ...good, planLength: 0 }, now)).toBeNull();
  });

  it("rejects an index that is not a whole number inside the plan", () => {
    expect(sanitizeProgress({ ...good, nextIndex: -1 }, now)).toBeNull();
    expect(sanitizeProgress({ ...good, nextIndex: 1.5 }, now)).toBeNull();
    expect(sanitizeProgress({ ...good, nextIndex: 164 }, now)).toBeNull();
  });

  it("accepts an index equal to the plan length — a run that finished its last search", () => {
    expect(sanitizeProgress({ ...good, nextIndex: 163 }, now)).not.toBeNull();
  });

  it("rejects a record older than the staleness window", () => {
    const old = new Date(now.getTime() - (PROGRESS_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    expect(sanitizeProgress({ ...good, savedAt: old }, now)).toBeNull();
  });

  it("rejects an unparseable or future savedAt", () => {
    expect(sanitizeProgress({ ...good, savedAt: "not a date" }, now)).toBeNull();
    expect(sanitizeProgress({ ...good, savedAt: "2026-10-11T00:00:00.000Z" }, now)).toBeNull();
  });
});

describe("canAutoResume", () => {
  const now = new Date("2026-10-10T10:00:00.000Z");
  const killed: DiscoveryProgress = {
    runId: "6b1f1d6e-6b9f-4a6a-9f2a-3c4d5e6f7a8b",
    nextIndex: 4,
    planLength: 16,
    savedAt: "2026-10-10T09:58:00.000Z",
    stoppedByUser: false,
  };

  it("carries on a harvest the browser killed moments ago", () => {
    expect(canAutoResume(killed, now)).toBe(true);
  });

  it("never carries on one that was stopped on purpose", () => {
    expect(canAutoResume({ ...killed, stoppedByUser: true }, now)).toBe(false);
  });

  it("never carries on one with nothing left to do", () => {
    expect(canAutoResume({ ...killed, nextIndex: 16 }, now)).toBe(false);
  });

  it("offers rather than resumes once the window has passed", () => {
    const old = new Date(now.getTime() - (PROGRESS_AUTO_RESUME_HOURS + 1) * 3_600_000).toISOString();
    expect(canAutoResume({ ...killed, savedAt: old }, now)).toBe(false);
  });

  it("still carries on at the edge of the window", () => {
    const edge = new Date(now.getTime() - PROGRESS_AUTO_RESUME_HOURS * 3_600_000).toISOString();
    expect(canAutoResume({ ...killed, savedAt: edge }, now)).toBe(true);
  });
});
