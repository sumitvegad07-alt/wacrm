// ============================================================
// Lead Discovery — the pure logic. No network, no Supabase, no React, so all of
// it is unit-testable (see discovery-query.test.ts).
//
// Everything here exists to protect one thing: the free tier. Phone number and
// website live in Google's Enterprise SKU, which allows 7,000 calls a month in
// India. Every design choice below trades a little convenience for certainty
// that this tool stays at zero cost.
// ============================================================

import {
  RETAIL_PRIMARY_TYPES,
  findCategory,
  findIndustry,
  isNonBuyerType,
} from "./discovery-taxonomy";
import { searchNameForDistrict } from "./discovery-geography";

// ── Quota constants ──────────────────────────────────────────

/** India free allowance for the Text Search Enterprise SKU, per month. */
export const MONTHLY_FREE_CALLS = 7_000;

/**
 * Self-imposed daily ceiling. 220 × 30 = 6,600, which stays under the monthly
 * 7,000 even in a 31-day month. Mirror this number in the Google Cloud console
 * quota so there are two independent brakes, not one.
 */
export const DAILY_CALL_CAP = 220;

/** Google returns 20 results per page and refuses to paginate past 3. */
export const RESULTS_PER_PAGE = 20;
export const MAX_PAGES = 3;

/**
 * Field mask. Every field here is Essentials, Pro or Enterprise — verified
 * against Google's SKU table on 2026-10-06. `reviews`, `editorialSummary` and
 * `priceLevel`-adjacent atmosphere fields are deliberately absent: one of them
 * would promote every call to the pricier Enterprise + Atmosphere SKU, which has
 * its own much smaller free tier. Do not add a field without re-checking its tier.
 */
export const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.businessStatus",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "nextPageToken",
].join(",");

// ── Query building ───────────────────────────────────────────

export interface QuerySpec {
  /** What Google receives. */
  text: string;
  /** The district this search covers, in our own seed spelling. */
  district: string;
  /** The industrial area, when the search was area-level. */
  area: string | null;
}

export interface AreaSelection {
  area: string;
  /** The district this area belongs to, in our own seed spelling. */
  district: string;
}

export interface BuildQueriesInput {
  industry: string;
  category: string;
  state: string;
  districts: string[];
  /**
   * Industrial areas with the district each one belongs to. The pair is supplied
   * rather than derived: "Ranebennur" is in "Haveri" and shares no words with it,
   * so nothing about an area name reveals its district.
   */
  areas?: AreaSelection[];
  /** Optional single pincode, typed by hand. */
  pincode?: string | null;
}

/**
 * One search per place. A district with chosen areas is searched by area ONLY —
 * searching both the district and its areas returns largely the same businesses
 * twice and burns the quota for nothing.
 */
export function buildQueries(input: BuildQueriesInput): QuerySpec[] {
  const industry = findIndustry(input.industry);
  const category = findCategory(input.category);
  if (!industry || !category) return [];

  const phrase = `${industry.term} ${category.term}`;
  const areas = input.areas ?? [];
  const specs: QuerySpec[] = [];

  // Which districts had at least one area picked: those are covered by their
  // areas and must not also be searched whole.
  const districtsCoveredByArea = new Set(areas.map((a) => a.district));

  for (const { area, district } of areas) {
    specs.push({
      text: `${phrase} in ${area}, ${input.state}`,
      district,
      area,
    });
  }

  for (const district of input.districts) {
    if (districtsCoveredByArea.has(district)) continue;
    specs.push({
      text: `${phrase} in ${searchNameForDistrict(district)}, ${input.state}`,
      district,
      area: null,
    });
  }

  const pincode = (input.pincode ?? "").trim();
  if (/^\d{6}$/.test(pincode)) {
    specs.push({
      text: `${phrase} near ${pincode}, ${input.state}`,
      district: input.districts[0] ?? "",
      area: null,
    });
  }

  return specs;
}

export interface CallEstimate {
  queries: number;
  /** Every query costs at least its first page. */
  minCalls: number;
  /**
   * Realistic figure. Most Indian district and estate searches return under 20
   * results, so page 2 is fetched for maybe 40% of them and page 3 for fewer.
   */
  expectedCalls: number;
  /** If every single query filled all three pages. */
  maxCalls: number;
}

export function estimateCalls(queryCount: number): CallEstimate {
  return {
    queries: queryCount,
    minCalls: queryCount,
    expectedCalls: Math.ceil(queryCount * 1.8),
    maxCalls: queryCount * MAX_PAGES,
  };
}

// ── Google response → our row ────────────────────────────────

/** The subset of a Places result we ask for. */
export interface PlacesResult {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: { types?: string[]; longText?: string; shortText?: string }[];
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  businessStatus?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
}

export interface DiscoveryRow {
  placeId: string;
  name: string;
  phone: string;
  website: string;
  address: string;
  area: string;
  city: string;
  /** Real district, read from Google's address components. */
  district: string;
  state: string;
  pincode: string;
  /** Where we looked, which is not always where the business turned out to be. */
  searchedIn: string;
  /** True when Google places this business outside the district we searched. */
  outsideSearchedArea: boolean;
  latitude: string;
  longitude: string;
  rating: string;
  reviews: string;
  primaryType: string;
  industry: string;
}

export interface MapContext {
  industryLabel: string;
  state: string;
  district: string;
  area: string | null;
}

export type SkipReason = "retail" | "closed" | "no_phone" | "no_id";

export interface MappedPlace {
  row: DiscoveryRow | null;
  skip: SkipReason | null;
}

/**
 * Turns one Google result into a CSV row, or explains why it was dropped.
 *
 * City and district come from Google's address components, NOT from what we
 * searched. The first version did the opposite, reasoning that the searched
 * place was the only certain fact. The first real harvest disproved that: a text
 * search widens its net when a small town runs out of matches, so 24 of 80 rows
 * came back more than 40 km from the place searched — one of them a Bengaluru
 * company 306 km away, confidently labelled "Haveri".
 *
 * Such a row is not junk: it is a real company in the wrong place. So it is kept
 * with its TRUE location, flagged `outsideSearchedArea`, and the place we looked
 * in is preserved separately. Dropping it would be worse than mislabelling it —
 * the place ID would be recorded as seen, and the company would then never
 * surface again in a search of the district it is actually in.
 */
export function mapPlace(
  place: PlacesResult,
  ctx: MapContext,
  opts: { includeWithoutPhone: boolean },
): MappedPlace {
  const placeId = place.id?.trim();
  if (!placeId) return { row: null, skip: "no_id" };

  const displayType = place.primaryTypeDisplayName?.text ?? "";
  if (
    (place.primaryType && RETAIL_PRIMARY_TYPES.has(place.primaryType)) ||
    (displayType && isNonBuyerType(displayType))
  ) {
    return { row: null, skip: "retail" };
  }

  // A permanently closed listing is a wasted call for a telecaller.
  if (place.businessStatus && place.businessStatus !== "OPERATIONAL") {
    return { row: null, skip: "closed" };
  }

  const phone = normalisePhone(place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? "");
  if (!phone && !opts.includeWithoutPhone) {
    return { row: null, skip: "no_phone" };
  }

  const locality = componentOf(place, "locality");
  const taluk = componentOf(place, "administrative_area_level_3");
  const googleDistrict = componentOf(place, "administrative_area_level_2");
  const sublocality = componentOf(place, "sublocality_level_1") || componentOf(place, "sublocality");

  const district = googleDistrict || ctx.district;
  const searchedIn = ctx.area ?? ctx.district;

  return {
    row: {
      placeId,
      name: (place.displayName?.text ?? "").trim(),
      phone,
      website: (place.websiteUri ?? "").trim(),
      address: (place.formattedAddress ?? "").trim(),
      area: sublocality,
      city: locality || taluk || googleDistrict || ctx.district,
      district,
      searchedIn,
      // Only claim "outside" when Google actually told us a district. A missing
      // component is unknown, not a mismatch, and must not be reported as one.
      outsideSearchedArea: googleDistrict !== "" && !sameDistrict(googleDistrict, ctx.district),
      state: ctx.state,
      pincode: pincodeFrom(place),
      latitude: place.location?.latitude != null ? String(place.location.latitude) : "",
      longitude: place.location?.longitude != null ? String(place.location.longitude) : "",
      rating: place.rating != null ? String(place.rating) : "",
      reviews: place.userRatingCount != null ? String(place.userRatingCount) : "",
      primaryType: displayType || place.primaryType || "",
      industry: ctx.industryLabel,
    },
    skip: null,
  };
}

/**
 * Digits only, with India's 91 country code and no leading "+".
 *
 * Three reasons for this shape: it matches `normalizePhone()` in
 * src/lib/whatsapp/phone-utils.ts (so the leads table's unique index sees the
 * same string we deduplicated on), it is what WhatsApp expects, and a value
 * starting with "+" would be read as a formula by Excel.
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  // Indian toll-free and UAN numbers are dialled as-is. Prefixing 91 turns
  // 1800 123 2152 into 911800..., which rings nowhere.
  if (/^(1800|1860|1600)/.test(digits)) return digits;
  if (digits.startsWith("91") && digits.length >= 12) return digits;
  // National format carries a trunk "0" (e.g. 080…, 09876…). Drop it, add 91.
  const national = digits.replace(/^0+/, "");
  if (!national) return "";
  return `91${national}`;
}

function componentOf(place: PlacesResult, type: string): string {
  for (const component of place.addressComponents ?? []) {
    if (component.types?.includes(type)) {
      return (component.longText ?? component.shortText ?? "").trim();
    }
  }
  return "";
}

/**
 * Karnataka renamed most of its cities in 2014 and Google still answers with
 * either spelling depending on the listing. Without this, a Mysuru result in a
 * Mysuru search reads as "outside the area".
 */
const RENAMED_PLACES: [RegExp, string][] = [
  [/bangalore/g, "bengaluru"],
  [/mysore/g, "mysuru"],
  [/belgaum/g, "belagavi"],
  [/gulbarga/g, "kalaburagi"],
  [/bellary/g, "ballari"],
  [/bijapur/g, "vijayapura"],
  [/shimoga/g, "shivamogga"],
  [/tumkur/g, "tumakuru"],
  [/chikmagalur/g, "chikkamagaluru"],
  [/hospet/g, "hosapete"],
  [/mangalore/g, "mangaluru"],
  [/hubli/g, "hubballi"],
  [/gadag/g, "gadaga"],
  [/bagalkot/g, "bagalakote"],
  [/koppal/g, "koppala"],
  [/raichur/g, "raichuru"],
  [/dharwad/g, "dharwada"],
  [/yadgir/g, "yadgiri"],
];

/** Comparable form of a place name: lower case, letters only, modern spelling. */
function placeKey(value: string): string {
  let key = value.toLowerCase().replace(/\bdistricts?\b/g, "");
  key = key.replace(/[^a-z]/g, "");
  for (const [from, to] of RENAMED_PLACES) key = key.replace(from, to);
  return key;
}

/**
 * Whether Google's district is the one we searched. Compared against both our
 * seed spelling and the alias Google was given, since those differ on purpose —
 * we search "Mangaluru" but Google answers with the district, "Dakshina Kannada".
 */
export function sameDistrict(googleDistrict: string, searchedDistrict: string): boolean {
  const google = placeKey(googleDistrict);
  if (!google) return true;

  for (const candidate of [searchedDistrict, searchNameForDistrict(searchedDistrict)]) {
    const ours = placeKey(candidate);
    if (!ours) continue;
    if (google === ours || google.includes(ours) || ours.includes(google)) return true;
  }
  return false;
}

function pincodeFrom(place: PlacesResult): string {
  for (const component of place.addressComponents ?? []) {
    if (component.types?.includes("postal_code")) {
      const value = (component.longText ?? component.shortText ?? "").replace(/\D/g, "");
      if (/^\d{6}$/.test(value)) return value;
    }
  }
  // Fall back to the address string: Indian addresses end in a 6-digit PIN.
  const match = (place.formattedAddress ?? "").match(/\b(\d{6})\b/);
  return match ? match[1] : "";
}

// ── Deduplication ────────────────────────────────────────────

export interface DedupeResult {
  rows: DiscoveryRow[];
  duplicates: number;
}

/**
 * Removes repeats inside one harvest: the same firm found under two different
 * searches, and two listings sharing one phone number (a common pattern where a
 * company has a separate Google listing per branch, all on the head-office
 * number). `alreadySeen` carries the place IDs from every previous harvest.
 */
export function dedupeRows(rows: DiscoveryRow[], alreadySeen: Set<string> = new Set()): DedupeResult {
  const seenIds = new Set<string>();
  const seenPhones = new Set<string>();
  const out: DiscoveryRow[] = [];
  let duplicates = 0;

  for (const row of rows) {
    if (alreadySeen.has(row.placeId) || seenIds.has(row.placeId)) {
      duplicates++;
      continue;
    }
    if (row.phone && seenPhones.has(row.phone)) {
      duplicates++;
      continue;
    }
    seenIds.add(row.placeId);
    if (row.phone) seenPhones.add(row.phone);
    out.push(row);
  }

  return { rows: out, duplicates };
}

// ── CSV ──────────────────────────────────────────────────────

/**
 * Header row. The names are chosen to match what the Leads CSV importer looks
 * for (src/components/leads/lead-import-dialog.tsx) so this file imports with no
 * mapping step. Changing a header here can silently stop a column importing.
 */
export const CSV_HEADERS = [
  "Name",
  "Contact Person",
  "Phone",
  "Email",
  "Website",
  "Industry",
  "Status",
  "Source",
  "Address",
  "Area",
  "City",
  "District",
  "State",
  "Country",
  "Pincode",
  "Latitude",
  "Longitude",
  "Rating",
  "Reviews",
  "Business Type",
  "Searched In",
  "Outside Searched Area",
  "Google Place ID",
] as const;

export function toCsv(rows: DiscoveryRow[], source: string): string {
  const lines = [CSV_HEADERS.join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.name,
        "", // Contact person: Google Maps has no people, only businesses.
        row.phone,
        "", // Email: likewise absent from Places.
        row.website,
        row.industry,
        "New",
        source,
        row.address,
        row.area,
        row.city,
        row.district,
        row.state,
        "India",
        row.pincode,
        row.latitude,
        row.longitude,
        row.rating,
        row.reviews,
        row.primaryType,
        row.searchedIn,
        row.outsideSearchedArea ? "Yes" : "No",
        row.placeId,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return lines.join("\r\n");
}

/**
 * Quotes what needs quoting, and neutralises the leading characters Excel and
 * Sheets treat as the start of a formula. Phone numbers are digits-only by the
 * time they reach here, so they are untouched by the formula guard.
 */
export function csvCell(value: string): string {
  let out = value ?? "";
  if (/^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  if (/[",\r\n]/.test(out)) out = `"${out.replace(/"/g, '""')}"`;
  return out;
}
