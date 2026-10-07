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
// The area lists themselves live in industrial-areas.ts — 1,626 estates across
// 33 states. A state or district with no entry falls back to district-level
// search, which is a correctness-safe default: fewer searches, fewer results,
// never wrong ones.
// ============================================================

import { SEED_INDIA_DISTRICTS, SEED_INDIA_STATES } from "@/lib/territories/seed-data.generated";
import { INDUSTRIAL_AREAS } from "./industrial-areas";

/**
 * Official seed spelling → the spelling Google Maps actually resolves.
 *
 * Three kinds of entry, all of them the same bug: a name that returns fewer
 * results, or none, while looking exactly like an empty district.
 *
 *   1. Official state spellings Google does not favour (Dharwada → Dharwad).
 *   2. Administrative names that are not place names. Nobody signs a building
 *      "Sri Potti Sriramulu Nellore" or "NTR"; the city is Nellore, Vijayawada.
 *   3. Punctuation Google chokes on — note that the seed's "Medchal–Malkajgiri"
 *      uses an EN DASH, not a hyphen.
 */
export const DISTRICT_SEARCH_ALIASES: Record<string, string> = {
  // Karnataka
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

  // Telangana — the en dash in Medchal–Malkajgiri is not a hyphen.
  "Medchal–Malkajgiri": "Medchal",
  "Kumuram Bheem Asifabad": "Asifabad",
  "Jogulamba Gadwal": "Gadwal",
  "Rajanna Sircilla": "Sircilla",
  "Jayashankar Bhupalpally": "Bhupalpally",
  "Yadadri Bhuvanagiri": "Bhongir",
  "Bhadradri Kothagudem": "Kothagudem",

  // Andhra Pradesh — several districts are named after people, not places.
  "Sri Potti Sriramulu Nellore": "Nellore",
  NTR: "Vijayawada",
  YSR: "Kadapa",
  Ananthapuramu: "Anantapur",
  "Dr. B.R. Ambedkar Konaseema": "Amalapuram",
  "Alluri Sitharama Raju": "Paderu",
  "Parvathipuram Manyam": "Parvathipuram",
  "Sri Sathya Sai": "Puttaparthi",
  "East Godavari": "Rajamahendravaram",
  "West Godavari": "Bhimavaram",

  // Punjab
  "Sahibzada Ajit Singh Nagar": "Mohali",
  "Shahid Bhagat Singh Nagar": "Nawanshahr",
  "Sri Muktsar Sahib": "Muktsar",

  // Uttar Pradesh
  "Gautam Buddha Nagar": "Noida",
  "Kanpur Nagar": "Kanpur",
  "Kanpur Dehat": "Akbarpur Kanpur Dehat",

  // Uttarakhand
  "Udham Singh Nagar": "Rudrapur",
  "Pauri Garhwal": "Pauri",
  "Tehri Garhwal": "New Tehri",

  // Maharashtra
  "Mumbai Suburban": "Mumbai",
  "Mumbai City": "Mumbai",

  // West Bengal
  Maldah: "Malda",
  "Paschim Bardhaman": "Asansol",
  "Purba Bardhaman": "Bardhaman",
  "Paschim Medinipur": "Midnapore",
  "Purba Medinipur": "Tamluk",

  // Jharkhand
  "East Singhbhum": "Jamshedpur",
  "West Singhbhum": "Chaibasa",
  "Seraikela-Kharsawan": "Seraikela",
  Hazaribag: "Hazaribagh",

  // Assam
  "Kamrup Metropolitan": "Guwahati",

  // Chhattisgarh — hyphenated amalgamations Google does not know as one place.
  "Balrampur-Ramanujganj": "Ramanujganj",
  "Gaurela-Pendra-Marwahi": "Pendra",
  "Manendragarh-Chirmiri-Bharatpur": "Chirmiri",
  "Mohla-Manpur-Ambagarh Chowki": "Mohla",
  "Khairagarh-Chhuikhadan-Gandai": "Khairagarh",
  "Sarangarh-Bilaigarh": "Sarangarh",
  "Janjgir-Champa": "Champa",

  // Elsewhere
  "Shahdara district": "Shahdara",
  "Dadra and Nagar Haveli": "Silvassa",
  "Itanagar capital complex": "Itanagar",
  "Papum Pare": "Naharlagun",
  "Mahé": "Mahe",
  "East Khasi Hills": "Shillong",
  "Ri Bhoi": "Byrnihat",
  "West Garo Hills": "Tura",
  "Imphal West": "Imphal",
  "East Sikkim": "Gangtok",
  "South Sikkim": "Namchi",
  "West Tripura": "Agartala",
  "South Tripura": "Belonia",
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
  const byDistrict = INDUSTRIAL_AREAS[state];
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
  return Boolean(INDUSTRIAL_AREAS[state]);
}

/**
 * The spelling Google should receive for a district. Falls back to the seed
 * name, which is correct for every district without a known alias.
 */
export function searchNameForDistrict(district: string): string {
  return DISTRICT_SEARCH_ALIASES[district] ?? district;
}
