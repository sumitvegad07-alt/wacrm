// ============================================================
// Lead Discovery — what we search for.
//
// Founder decision (2026-10-06): this tool exists to find prospects for OZZO
// SFA, so the taxonomy is deliberately limited to businesses that employ field
// sales reps — manufacturers, distributors, wholesalers, exporters. Dealers,
// retailers and showrooms are NOT offered as categories: they are FSM/CRM
// prospects, and he is not selling that from this list.
//
// Both lists are plain data. Adding an industry is one line here — no
// migration, no deploy ceremony beyond the push.
// ============================================================

export interface DiscoveryIndustry {
  /** Stable key stored on the run row, so renaming a label keeps history readable. */
  value: string;
  /** What the founder picks from the dropdown. */
  label: string;
  /**
   * The words Google actually gets. Deliberately ONE phrase per industry: every
   * extra phrase multiplies the number of searches, and the daily call cap
   * (DAILY_CALL_CAP) is what keeps this tool free.
   */
  term: string;
}

export interface DiscoveryCategory {
  value: string;
  label: string;
  /** Appended after the industry term, e.g. "seeds" + "manufacturers". */
  term: string;
}

/**
 * SFA-shaped industries: each one is a business that moves physical goods
 * through a field force. Ordered roughly by how well OZZO SFA fits.
 */
export const DISCOVERY_INDUSTRIES: DiscoveryIndustry[] = [
  { value: "seeds", label: "Seeds", term: "seeds" },
  { value: "fertilizer", label: "Fertilizer & agrochemicals", term: "fertilizer" },
  { value: "pesticides", label: "Pesticides", term: "pesticides" },
  { value: "fmcg_food", label: "FMCG food products", term: "food products" },
  { value: "dairy_beverages", label: "Dairy & beverages", term: "dairy products" },
  { value: "pharma", label: "Pharmaceuticals", term: "pharmaceutical" },
  { value: "ayurvedic", label: "Ayurvedic & nutraceutical", term: "ayurvedic products" },
  { value: "cosmetics", label: "Cosmetics & personal care", term: "cosmetics" },
  { value: "paints", label: "Paints & coatings", term: "paints" },
  { value: "chemicals", label: "Adhesives & chemicals", term: "chemicals" },
  { value: "plastics", label: "Plastics & packaging", term: "packaging" },
  { value: "cement", label: "Cement & building material", term: "building material" },
  { value: "steel", label: "Steel & metal fabrication", term: "steel fabrication" },
  { value: "electrical", label: "Electrical equipment", term: "electrical equipment" },
  { value: "cables", label: "Wires & cables", term: "wires and cables" },
  { value: "pumps", label: "Pumps & motors", term: "pumps and motors" },
  { value: "auto_components", label: "Auto components", term: "auto components" },
  { value: "agri_implements", label: "Agricultural implements", term: "agricultural implements" },
  { value: "textiles", label: "Textiles & garments", term: "textiles" },
  { value: "footwear", label: "Footwear & leather", term: "footwear" },
  { value: "plywood", label: "Plywood & laminates", term: "plywood and laminates" },
  { value: "tiles", label: "Tiles & sanitaryware", term: "tiles and sanitaryware" },
  { value: "lubricants", label: "Lubricants & oils", term: "lubricants" },
  { value: "stationery", label: "Stationery & paper", term: "stationery and paper" },
  { value: "machinery", label: "Industrial machinery", term: "industrial machinery" },
];

/**
 * Note the omissions: no "dealer", no "retailer", no "showroom". See the header.
 */
export const DISCOVERY_CATEGORIES: DiscoveryCategory[] = [
  { value: "manufacturer", label: "Manufacturer", term: "manufacturers" },
  { value: "distributor", label: "Distributor", term: "distributors" },
  { value: "wholesaler", label: "Wholesaler", term: "wholesalers" },
  { value: "exporter", label: "Exporter / Supplier", term: "exporters suppliers" },
];

/**
 * Google `primaryType` values that mean "this is a shop or a consumer service",
 * i.e. the opposite of what this tool is for. Results carrying one of these are
 * dropped before the CSV is built, and the count is reported back so a bad
 * keyword is visible rather than silent.
 *
 * The generic `store` type is deliberately NOT here: Google types plenty of
 * genuine small manufacturers as `store`, and dropping it loses real prospects.
 */
export const RETAIL_PRIMARY_TYPES: ReadonlySet<string> = new Set([
  "clothing_store",
  "shoe_store",
  "jewelry_store",
  "furniture_store",
  "home_goods_store",
  "hardware_store",
  "electronics_store",
  "cell_phone_store",
  "book_store",
  "grocery_store",
  "grocery_or_supermarket",
  "supermarket",
  "convenience_store",
  "department_store",
  "shopping_mall",
  "liquor_store",
  "pet_store",
  "sporting_goods_store",
  "bicycle_store",
  "car_dealer",
  "car_repair",
  "car_wash",
  "gas_station",
  "pharmacy",
  "drugstore",
  "restaurant",
  "cafe",
  "bakery",
  "bar",
  "meal_takeaway",
  "meal_delivery",
  "hotel",
  "lodging",
  "guest_house",
  "resort_hotel",
  "beauty_salon",
  "hair_salon",
  "spa",
  "gym",
  "fitness_center",
  "school",
  "primary_school",
  "secondary_school",
  "university",
  "hospital",
  "doctor",
  "dentist",
  "veterinary_care",
  "bank",
  "atm",
  "insurance_agency",
  "real_estate_agency",
  "travel_agency",
  "movie_theater",
  "tourist_attraction",
  "park",
  "place_of_worship",
  "hindu_temple",
  "church",
  "mosque",
  "local_government_office",
  "post_office",
  "police",
  "fire_station",
  "courthouse",
  "library",
  "museum",
  "night_club",
  "amusement_park",
]);

export function findIndustry(value: string): DiscoveryIndustry | undefined {
  return DISCOVERY_INDUSTRIES.find((i) => i.value === value);
}

export function findCategory(value: string): DiscoveryCategory | undefined {
  return DISCOVERY_CATEGORIES.find((c) => c.value === value);
}
