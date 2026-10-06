import { describe, it, expect } from "vitest";
import {
  CSV_HEADERS,
  DAILY_CALL_CAP,
  MONTHLY_FREE_CALLS,
  PLACES_FIELD_MASK,
  buildQueries,
  csvCell,
  dedupeRows,
  estimateCalls,
  mapPlace,
  normalisePhone,
  toCsv,
  type DiscoveryRow,
  type PlacesResult,
} from "./discovery-query";
import { listAreas, listDistricts, searchNameForDistrict } from "./discovery-geography";

const base = { industry: "seeds", category: "manufacturer", state: "Karnataka" };

describe("buildQueries", () => {
  it("writes one search per district, using Google's spelling not ours", () => {
    const specs = buildQueries({ ...base, districts: ["Dharwada", "Gadaga"] });
    expect(specs.map((s) => s.text)).toEqual([
      "seeds manufacturers in Dharwad, Karnataka",
      "seeds manufacturers in Gadag, Karnataka",
    ]);
    // The district we report back stays in seed spelling, so it matches the
    // territory tree and the CSV's City column.
    expect(specs.map((s) => s.district)).toEqual(["Dharwada", "Gadaga"]);
  });

  it("searches a district by its areas INSTEAD of as a whole, never both", () => {
    const specs = buildQueries({
      ...base,
      districts: ["Dharwada", "Gadaga"],
      areas: [
        { area: "Tarihal Industrial Area", district: "Dharwada" },
        { area: "Gokul Road Hubballi", district: "Dharwada" },
      ],
    });

    const texts = specs.map((s) => s.text);
    expect(texts).toContain("seeds manufacturers in Tarihal Industrial Area, Karnataka");
    expect(texts).toContain("seeds manufacturers in Gokul Road Hubballi, Karnataka");
    // Dharwada is covered by its two areas, so it is not searched whole…
    expect(texts).not.toContain("seeds manufacturers in Dharwad, Karnataka");
    // …but Gadaga, with no areas picked, still is.
    expect(texts).toContain("seeds manufacturers in Gadag, Karnataka");
    expect(specs).toHaveLength(3);
  });

  it("keeps the area's own district, even when the name shares no words with it", () => {
    const [spec] = buildQueries({
      ...base,
      districts: ["Haveri"],
      areas: [{ area: "Ranebennur", district: "Haveri" }],
    });
    expect(spec.district).toBe("Haveri");
    expect(spec.area).toBe("Ranebennur");
  });

  it("adds a pincode search only for a real 6-digit PIN", () => {
    const withPin = buildQueries({ ...base, districts: ["Dharwada"], pincode: "580020" });
    expect(withPin.map((s) => s.text)).toEqual([
      "seeds manufacturers in Dharwad, Karnataka",
      "seeds manufacturers near 580020, Karnataka",
    ]);

    for (const junk of ["", "  ", "58002", "5800201", "abc123"]) {
      expect(buildQueries({ ...base, districts: ["Dharwada"], pincode: junk })).toHaveLength(1);
    }
  });

  it("returns nothing for an unknown industry or category rather than guessing", () => {
    expect(buildQueries({ ...base, industry: "nope", districts: ["Dharwada"] })).toEqual([]);
    expect(buildQueries({ ...base, category: "dealer", districts: ["Dharwada"] })).toEqual([]);
  });
});

describe("estimateCalls", () => {
  it("brackets the cost of one search plan", () => {
    const est = estimateCalls(100);
    expect(est.minCalls).toBe(100);
    expect(est.expectedCalls).toBe(180);
    expect(est.maxCalls).toBe(300);
  });

  it("prices a real full-Karnataka sweep at two days of cap, and ~23 a month", () => {
    const districts = listDistricts("Karnataka").map((d) => d.value);
    const areas = listAreas("Karnataka", districts);
    const plan = buildQueries({
      ...base,
      districts,
      areas: areas.map((a) => ({ area: a.value, district: a.district })),
    });

    // Every district is covered by its areas, so the plan is exactly the areas.
    expect(plan).toHaveLength(areas.length);

    const est = estimateCalls(plan.length);
    // More than one day's cap: the harvest is designed to stop and resume, which
    // is why an already-run search is skipped for free the next day.
    expect(est.expectedCalls).toBeGreaterThan(DAILY_CALL_CAP);
    expect(est.expectedCalls).toBeLessThan(DAILY_CALL_CAP * 2);
    // Enough full sweeps per month to work through the whole industry list free.
    expect(Math.floor(MONTHLY_FREE_CALLS / est.expectedCalls)).toBeGreaterThanOrEqual(20);
  });
});

describe("the field mask", () => {
  it("asks for no Atmosphere-tier field, which would raise the price of every call", () => {
    for (const atmosphere of ["places.reviews", "places.editorialSummary", "places.priceLevel"]) {
      expect(PLACES_FIELD_MASK).not.toContain(atmosphere);
    }
    expect(PLACES_FIELD_MASK).toContain("places.nationalPhoneNumber");
    expect(PLACES_FIELD_MASK).toContain("nextPageToken");
  });
});

describe("normalisePhone", () => {
  it("renders every Indian form as 91 + number, digits only", () => {
    expect(normalisePhone("+91 80 2345 6789")).toBe("918023456789");
    expect(normalisePhone("080 2345 6789")).toBe("918023456789");
    expect(normalisePhone("098765 43210")).toBe("919876543210");
    expect(normalisePhone("+919876543210")).toBe("919876543210");
  });

  it("never leaves a leading + that a spreadsheet would read as a formula", () => {
    expect(normalisePhone("+91 80 2345 6789").startsWith("+")).toBe(false);
  });

  it("returns empty for nothing usable", () => {
    expect(normalisePhone("")).toBe("");
    expect(normalisePhone("n/a")).toBe("");
    expect(normalisePhone("0")).toBe("");
  });
});

const ctx = { industryLabel: "Seeds", state: "Karnataka", district: "Haveri", area: "Ranebennur" };

function place(over: PlacesResult = {}): PlacesResult {
  return {
    id: "ChIJ_test",
    displayName: { text: "Ranebennur Seeds Pvt Ltd" },
    formattedAddress: "PB Road, Ranebennur, Karnataka 581115, India",
    location: { latitude: 14.6167, longitude: 75.63 },
    primaryType: "corporate_office",
    businessStatus: "OPERATIONAL",
    internationalPhoneNumber: "+91 83 7322 1144",
    websiteUri: "https://example.in",
    rating: 4.3,
    userRatingCount: 27,
    ...over,
  };
}

describe("mapPlace", () => {
  it("labels city and area from what we searched, not from the address text", () => {
    const { row } = mapPlace(place(), ctx, { includeWithoutPhone: false });
    expect(row?.city).toBe("Haveri");
    expect(row?.area).toBe("Ranebennur");
    expect(row?.industry).toBe("Seeds");
    expect(row?.phone).toBe("918373221144");
  });

  it("reads the PIN from address components, and falls back to the address string", () => {
    const fromComponent = mapPlace(
      place({ addressComponents: [{ types: ["postal_code"], longText: "581115" }] }),
      ctx,
      { includeWithoutPhone: false },
    );
    expect(fromComponent.row?.pincode).toBe("581115");

    const fromText = mapPlace(place({ addressComponents: [] }), ctx, { includeWithoutPhone: false });
    expect(fromText.row?.pincode).toBe("581115");

    const none = mapPlace(place({ addressComponents: [], formattedAddress: "Ranebennur, India" }), ctx, {
      includeWithoutPhone: false,
    });
    expect(none.row?.pincode).toBe("");
  });

  it("drops shops and consumer services — this list is for SFA prospects", () => {
    expect(mapPlace(place({ primaryType: "clothing_store" }), ctx, { includeWithoutPhone: false }).skip).toBe(
      "retail",
    );
    expect(mapPlace(place({ primaryType: "restaurant" }), ctx, { includeWithoutPhone: false }).skip).toBe(
      "retail",
    );
  });

  it("keeps the generic 'store' type, which many real small manufacturers carry", () => {
    expect(mapPlace(place({ primaryType: "store" }), ctx, { includeWithoutPhone: false }).skip).toBeNull();
  });

  it("drops closed businesses and rows with no id", () => {
    expect(
      mapPlace(place({ businessStatus: "CLOSED_PERMANENTLY" }), ctx, { includeWithoutPhone: false }).skip,
    ).toBe("closed");
    expect(mapPlace(place({ id: undefined }), ctx, { includeWithoutPhone: false }).skip).toBe("no_id");
  });

  it("drops a business with no phone unless asked to keep it", () => {
    const noPhone = { internationalPhoneNumber: undefined, nationalPhoneNumber: undefined };
    expect(mapPlace(place(noPhone), ctx, { includeWithoutPhone: false }).skip).toBe("no_phone");

    const kept = mapPlace(place(noPhone), ctx, { includeWithoutPhone: true });
    expect(kept.skip).toBeNull();
    expect(kept.row?.phone).toBe("");
  });
});

function row(over: Partial<DiscoveryRow> = {}): DiscoveryRow {
  return {
    placeId: "id-1",
    name: "A",
    phone: "918373221144",
    website: "",
    address: "",
    area: "",
    city: "Haveri",
    state: "Karnataka",
    pincode: "",
    latitude: "",
    longitude: "",
    rating: "",
    reviews: "",
    primaryType: "",
    industry: "Seeds",
    ...over,
  };
}

describe("dedupeRows", () => {
  it("removes the same place found under two searches", () => {
    const result = dedupeRows([row(), row({ name: "A again" })]);
    expect(result.rows).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });

  it("removes two branches sharing one head-office number", () => {
    const result = dedupeRows([row(), row({ placeId: "id-2", name: "A Branch" })]);
    expect(result.rows).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });

  it("keeps several rows that have no phone at all", () => {
    const result = dedupeRows([
      row({ placeId: "a", phone: "" }),
      row({ placeId: "b", phone: "" }),
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.duplicates).toBe(0);
  });

  it("removes places harvested in an earlier run", () => {
    const result = dedupeRows([row({ placeId: "old" }), row({ placeId: "new" })], new Set(["old"]));
    expect(result.rows.map((r) => r.placeId)).toEqual(["new"]);
    expect(result.duplicates).toBe(1);
  });
});

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("Shah & Co, Hubballi")).toBe('"Shah & Co, Hubballi"');
    expect(csvCell('He said "yes"')).toBe('"He said ""yes"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("defuses a value a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-5 Enterprises")).toBe("'-5 Enterprises");
    expect(csvCell("@Home Furnishings")).toBe("'@Home Furnishings");
  });

  it("leaves a normalised phone number alone", () => {
    expect(csvCell("918373221144")).toBe("918373221144");
  });
});

describe("toCsv", () => {
  it("emits headers the Leads importer recognises", () => {
    // These four are what lead-import-dialog.tsx matches on; renaming one here
    // silently stops that column importing.
    for (const header of ["Name", "Contact Person", "Phone", "City"]) {
      expect(CSV_HEADERS).toContain(header);
    }
  });

  it("writes one line per row with Status and Country filled in", () => {
    const csv = toCsv([row({ name: "Ranebennur Seeds" })], "Google Maps — Karnataka");
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(CSV_HEADERS.join(","));

    const cells = lines[1].split(",");
    expect(cells[CSV_HEADERS.indexOf("Name")]).toBe("Ranebennur Seeds");
    expect(cells[CSV_HEADERS.indexOf("Status")]).toBe("New");
    expect(cells[CSV_HEADERS.indexOf("Country")]).toBe("India");
    expect(cells[CSV_HEADERS.indexOf("Source")]).toBe("Google Maps — Karnataka");
    // Google has no people and no emails; the columns exist but stay blank.
    expect(cells[CSV_HEADERS.indexOf("Contact Person")]).toBe("");
    expect(cells[CSV_HEADERS.indexOf("Email")]).toBe("");
  });
});

describe("Karnataka geography", () => {
  it("has all 31 districts from the shared India seed", () => {
    expect(listDistricts("Karnataka")).toHaveLength(31);
  });

  it("gives Google the common spelling of a district, and leaves others alone", () => {
    expect(searchNameForDistrict("Dharwada")).toBe("Dharwad");
    expect(searchNameForDistrict("Bagalakote")).toBe("Bagalkot");
    expect(searchNameForDistrict("Dakshina Kannada")).toBe("Mangaluru");
    expect(searchNameForDistrict("Belagavi")).toBe("Belagavi");
  });

  it("maps industrial areas to the district that owns them", () => {
    const areas = listAreas("Karnataka", ["Haveri"]);
    const ranebennur = areas.find((a) => a.value === "Ranebennur");
    expect(ranebennur?.district).toBe("Haveri");
  });

  it("covers every Karnataka district with at least one searchable area", () => {
    const districts = listDistricts("Karnataka").map((d) => d.value);
    const uncovered = districts.filter((d) => listAreas("Karnataka", [d]).length === 0);
    expect(uncovered).toEqual([]);
    // 163 areas is the volume lever. If this number collapses, someone has gutted
    // the list and every harvest afterwards would quietly return far less.
    expect(listAreas("Karnataka", districts)).toHaveLength(163);
  });

  it("returns no areas for a state nobody has mapped yet, instead of inventing them", () => {
    expect(listAreas("Kerala", listDistricts("Kerala").map((d) => d.value))).toEqual([]);
  });
});
