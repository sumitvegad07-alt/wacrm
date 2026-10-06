// ============================================================
// Lead Discovery — where we search.
//
// States and districts are NOT duplicated here. They come from
// src/lib/territories/seed-data.generated.ts, the same pinned India dataset the
// Territory Master "Load default India data" button uses. One source of truth.
//
// This module adds the two things that dataset cannot know:
//
//   1. SEARCH ALIASES. The seed carries the official Kannada spellings
//      (Dharwada, Gadaga, Bagalakote, Koppala). Google Maps matches far better
//      on the common spellings (Dharwad, Gadag, Bagalkot, Koppal). Sending the
//      official spelling returns fewer results and fails silently, which is the
//      worst kind of bug: you cannot tell a bad query from an empty district.
//      The founder still picks "Dharwada"; Google receives "Dharwad".
//
//   2. INDUSTRIAL AREAS. A district search caps at 60 results, so district-level
//      searching alone leaves most of a district undiscovered. Manufacturers
//      cluster in KIADB industrial estates, and each estate is its own separate
//      60-result bucket — so searching Hubballi's Tarihal and Gokul Road
//      separately finds more than searching "Dharwad" ever will. This is both
//      the volume lever and the manufacturer-vs-retailer filter.
//
// Karnataka is populated (founder starts there). Other states fall back to
// district-level search until their areas are filled in, which is a correctness-
// safe default: fewer searches, fewer results, never wrong results.
// ============================================================

import { SEED_INDIA_DISTRICTS, SEED_INDIA_STATES } from "@/lib/territories/seed-data.generated";

/** Official seed spelling → the spelling Google Maps resolves best. */
const DISTRICT_SEARCH_ALIASES: Record<string, string> = {
  Bagalakote: "Bagalkot",
  "Bengaluru Urban": "Bengaluru",
  Chamarajanagara: "Chamarajanagar",
  Chikkaballapura: "Chikkaballapur",
  "Dakshina Kannada": "Mangaluru",
  Davanagere: "Davangere",
  Dharwada: "Dharwad",
  Gadaga: "Gadag",
  Koppala: "Koppal",
  Kodagu: "Madikeri",
  Raichuru: "Raichur",
  "Uttara Kannada": "Karwar",
  Vijayanagara: "Hosapete",
  Yadgiri: "Yadgir",
};

/**
 * KIADB industrial areas and manufacturing towns, keyed by the district's
 * official seed name. Keep each entry a place Google Maps can actually resolve —
 * an estate name nobody has mapped returns zero and wastes a call.
 */
const KARNATAKA_AREAS: Record<string, string[]> = {
  "Bengaluru Urban": [
    "Peenya Industrial Area",
    "Rajajinagar Industrial Estate",
    "Bommasandra Industrial Area",
    "Jigani Industrial Area",
    "Attibele Industrial Area",
    "Electronic City",
    "Whitefield",
    "Mahadevapura",
    "Yeshwanthpur Industrial Suburb",
    "Kumbalgodu Industrial Area",
  ],
  "Bengaluru Rural": [
    "Dabaspet Industrial Area",
    "Nelamangala",
    "Hoskote Industrial Area",
    "Doddaballapur Industrial Area",
    "Devanahalli",
  ],
  Ramanagara: ["Bidadi Industrial Area", "Harohalli Industrial Area", "Kanakapura", "Channapatna"],
  Kolar: ["Narasapura Industrial Area", "Vemagal Industrial Area", "Kolar", "Bangarapet"],
  Chikkaballapura: ["Chikkaballapur Industrial Area", "Gauribidanur", "Sidlaghatta"],
  Tumakuru: [
    "Antharasanahalli Industrial Area",
    "Hirehalli Industrial Area",
    "Vasanthanarasapura Industrial Area",
    "Sira",
    "Tiptur",
  ],
  Mysuru: [
    "Hebbal Industrial Area Mysuru",
    "Metagalli Industrial Area",
    "Belagola Industrial Area",
    "Hootagalli Industrial Area",
    "Thandya Industrial Area Nanjangud",
    "Nanjangud",
  ],
  Mandya: ["Mandya Industrial Area", "Maddur", "Malavalli", "Srirangapatna", "Nagamangala"],
  Chamarajanagara: ["Badanaguppe Kellamballi Industrial Area", "Kollegal", "Gundlupet"],
  Hassan: ["Hassan Growth Centre", "Arsikere", "Channarayapatna", "Holenarsipur", "Sakleshpur"],
  "Dakshina Kannada": [
    "Baikampady Industrial Area",
    "Yeyyadi Industrial Area",
    "Thokur",
    "Puttur",
    "Bantwal",
    "Mulki",
  ],
  Udupi: ["Shivalli Industrial Area Manipal", "Nandikur", "Kundapura", "Karkala", "Padubidri"],
  "Uttara Kannada": ["Karwar", "Dandeli", "Sirsi", "Bhatkal", "Honnavar", "Haliyal"],
  Shivamogga: ["Machenahalli Industrial Area", "Bhadravathi", "Sagar", "Shikaripura", "Sorab"],
  Chikkamagaluru: ["Chikkamagaluru Industrial Area", "Kadur", "Tarikere", "Birur"],
  Chitradurga: ["Chitradurga Industrial Area", "Hiriyur", "Challakere", "Hosadurga"],
  Davanagere: ["Davangere Industrial Area", "Harihar", "Lokikere", "Channagiri"],
  Ballari: ["Ballari Industrial Area", "Sandur", "Kudligi", "Siruguppa"],
  Vijayanagara: ["Hosapete", "Toranagallu", "Kottur", "Harapanahalli", "Hagaribommanahalli"],
  Koppala: ["Koppal Industrial Area", "Ginigera", "Gangavathi", "Kukanoor", "Yelburga"],
  Raichuru: ["Raichur Growth Centre", "Shaktinagar", "Sindhanur", "Manvi", "Devadurga"],
  Yadgiri: ["Kadechur Badiyal Industrial Area", "Yadgir", "Shahapur", "Surapura"],
  Kalaburagi: [
    "Kapanoor Industrial Area",
    "Nandur Keshwar Industrial Area",
    "Wadi",
    "Sedam",
    "Aland",
    "Chittapur",
  ],
  Bidar: ["Kolhar Industrial Area", "Humnabad Industrial Area", "Bhalki", "Basavakalyan", "Aurad"],
  Vijayapura: ["Vijayapura Industrial Area", "Indi", "Sindagi", "Basavana Bagewadi", "Muddebihal"],
  Bagalakote: [
    "Bagalkot Industrial Area",
    "Mudhol",
    "Jamkhandi",
    "Mahalingapura",
    "Ilkal",
    "Rabkavi Banhatti",
  ],
  Belagavi: [
    "Udyambag Industrial Area",
    "Auto Nagar Belagavi",
    "Machhe Industrial Area",
    "Honaga Industrial Area",
    "Kanbargi",
    "Gokak",
    "Nipani",
    "Chikkodi",
    "Hukkeri",
    "Mudalagi",
    "Khanapur",
  ],
  Dharwada: [
    "Belur Industrial Area Dharwad",
    "Gokul Road Hubballi",
    "Tarihal Industrial Area",
    "Rayapur Dharwad",
    "Navanagar Hubballi",
    "Kalghatgi",
  ],
  Gadaga: ["Gadag Industrial Area", "Narayanpur Gadag", "Mundargi", "Ron", "Naragund", "Gajendragad"],
  Haveri: ["Ranebennur", "Haveri Industrial Area", "Byadgi", "Hirekerur", "Savanur", "Shiggaon", "Hangal"],
  Kodagu: ["Kushalnagar", "Madikeri", "Somwarpet", "Virajpet"],
};

/** Area lists by state's seed name. Only Karnataka is filled in so far. */
const AREAS_BY_STATE: Record<string, Record<string, string[]>> = {
  Karnataka: KARNATAKA_AREAS,
};

export interface GeoOption {
  value: string;
  label: string;
}

export interface AreaOption extends GeoOption {
  /** Seed-spelling district this area sits in. */
  district: string;
}

/** Every state in the pinned India dataset, alphabetical. */
export function listStates(): GeoOption[] {
  return SEED_INDIA_STATES.map((s) => ({ value: s.n, label: s.n })).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

/** Districts of one state, by its seed name. */
export function listDistricts(state: string): GeoOption[] {
  return SEED_INDIA_DISTRICTS.filter((d) => d.s === state)
    .map((d) => ({ value: d.n, label: d.n }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Industrial areas for the given districts. Returns [] for a state whose areas
 * have not been mapped yet, which the UI reports as "district-level only".
 */
export function listAreas(state: string, districts: string[]): AreaOption[] {
  const byDistrict = AREAS_BY_STATE[state];
  if (!byDistrict) return [];

  const out: AreaOption[] = [];
  for (const district of districts) {
    for (const area of byDistrict[district] ?? []) {
      out.push({ value: area, label: `${area} — ${district}`, district });
    }
  }
  return out;
}

/** True when this state has an industrial-area list at all. */
export function hasAreaCoverage(state: string): boolean {
  return Boolean(AREAS_BY_STATE[state]);
}

/**
 * The spelling Google should receive for a district. Falls back to the seed
 * name, which is correct for every district without a known alias.
 */
export function searchNameForDistrict(district: string): string {
  return DISTRICT_SEARCH_ALIASES[district] ?? district;
}
