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
 * through a field force of its own. Grouped by sector so the dropdown reads in
 * an order a salesperson thinks in, rather than alphabetically.
 *
 * The test of whether something belongs here is not "do they make things" but
 * "do they employ reps who visit customers" — which is what OZZO SFA is for.
 */
export const DISCOVERY_INDUSTRIES: DiscoveryIndustry[] = [
  // ── Agri inputs ──
  { value: "seeds", label: "Seeds", term: "seeds" },
  { value: "fertilizer", label: "Fertilizer & agrochemicals", term: "fertilizer" },
  { value: "pesticides", label: "Pesticides", term: "pesticides" },
  { value: "agri_implements", label: "Agricultural implements", term: "agricultural implements" },
  { value: "cattle_feed", label: "Cattle & poultry feed", term: "cattle feed" },
  { value: "irrigation", label: "Irrigation & drip systems", term: "drip irrigation systems" },

  // ── Food & beverage ──
  { value: "fmcg_food", label: "FMCG food products", term: "food products" },
  { value: "beverages", label: "Beverages & soft drinks", term: "beverages" },
  { value: "packaged_water", label: "Packaged drinking water", term: "packaged drinking water" },
  { value: "dairy", label: "Dairy products", term: "dairy products" },
  { value: "spices", label: "Spices & masala", term: "spices and masala" },
  { value: "edible_oil", label: "Edible oils", term: "edible oil" },
  { value: "flour_rice_mills", label: "Flour & rice mills", term: "rice and flour mill" },
  { value: "snacks", label: "Snacks & namkeen", term: "snacks and namkeen" },
  { value: "bakery", label: "Bakery & confectionery", term: "bakery and confectionery products" },
  { value: "tea_coffee", label: "Tea & coffee", term: "tea and coffee" },
  { value: "sugar_jaggery", label: "Sugar & jaggery", term: "sugar and jaggery" },
  { value: "frozen_foods", label: "Frozen & processed foods", term: "frozen food" },

  // ── Pharma & personal care ──
  { value: "pharma", label: "Pharmaceuticals", term: "pharmaceutical" },
  { value: "ayurvedic", label: "Ayurvedic & nutraceutical", term: "ayurvedic products" },
  { value: "cosmetics", label: "Cosmetics & personal care", term: "cosmetics" },
  { value: "medical_devices", label: "Medical devices & surgical", term: "surgical and medical devices" },
  { value: "veterinary", label: "Veterinary medicines", term: "veterinary medicines" },

  // ── Building & construction ──
  { value: "cement", label: "Cement & building material", term: "building material" },
  { value: "tiles", label: "Tiles & sanitaryware", term: "tiles and sanitaryware" },
  { value: "paints", label: "Paints & coatings", term: "paints" },
  { value: "pipes", label: "PVC pipes & fittings", term: "PVC pipes and fittings" },
  { value: "steel_pipes", label: "Steel pipes & tubes", term: "steel pipes and tubes" },
  { value: "plywood", label: "Plywood & laminates", term: "plywood and laminates" },
  { value: "glass", label: "Glass & glassware", term: "glass" },
  { value: "marble_granite", label: "Marble & granite", term: "marble and granite" },
  { value: "hardware", label: "Hardware & fasteners", term: "hardware and fasteners" },
  { value: "steel", label: "Steel & metal fabrication", term: "steel fabrication" },
  { value: "aac_blocks", label: "Blocks & precast concrete", term: "AAC blocks and precast concrete" },

  // ── Electrical & engineering ──
  { value: "electrical", label: "Electrical equipment", term: "electrical equipment" },
  { value: "cables", label: "Wires & cables", term: "wires and cables" },
  { value: "switchgear", label: "Switchgear & panels", term: "switchgear and control panels" },
  { value: "transformers", label: "Transformers", term: "transformers" },
  { value: "led_lighting", label: "LED & lighting", term: "LED lighting" },
  { value: "pumps", label: "Pumps & motors", term: "pumps and motors" },
  { value: "bearings", label: "Bearings & power transmission", term: "bearings" },
  { value: "hand_tools", label: "Hand & power tools", term: "hand tools" },
  { value: "machinery", label: "Industrial machinery", term: "industrial machinery" },
  { value: "batteries", label: "Batteries & inverters", term: "batteries and inverters" },
  { value: "solar", label: "Solar equipment", term: "solar panels" },
  { value: "appliances", label: "Home appliances & fans", term: "home appliances" },

  // ── Auto & mobility ──
  { value: "auto_components", label: "Auto components", term: "auto components" },
  { value: "tyres", label: "Tyres & rubber products", term: "tyres" },
  { value: "lubricants", label: "Lubricants & oils", term: "lubricants" },

  // ── Chemicals & materials ──
  { value: "chemicals", label: "Adhesives & chemicals", term: "chemicals" },
  { value: "dyes", label: "Dyes & pigments", term: "dyes and pigments" },
  { value: "plastics", label: "Plastics & packaging", term: "packaging" },
  { value: "paper", label: "Paper & corrugated boxes", term: "corrugated boxes" },
  { value: "rubber", label: "Rubber & polymer products", term: "rubber products" },
  { value: "industrial_gases", label: "Industrial gases & welding", term: "industrial gases and welding" },

  // ── Consumer & lifestyle ──
  { value: "textiles", label: "Textiles & garments", term: "textiles" },
  { value: "footwear", label: "Footwear & leather", term: "footwear" },
  { value: "furniture", label: "Furniture manufacturing", term: "furniture" },
  { value: "mattress", label: "Mattresses & foam", term: "mattress and foam" },
  { value: "kitchenware", label: "Kitchenware & utensils", term: "kitchenware and utensils" },
  { value: "stationery", label: "Stationery & paper products", term: "stationery" },
  { value: "printing", label: "Printing & labels", term: "printing and labels" },
  { value: "toys_sports", label: "Toys & sports goods", term: "toys and sports goods" },
  { value: "ceramics", label: "Ceramics & crockery", term: "ceramics" },
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

/**
 * Words in Google's *display* type that mean "this organisation does not buy
 * sales-force software".
 *
 * Needed because RETAIL_PRIMARY_TYPES matches the raw `primaryType`, and the
 * first real harvest showed that misses things: Karnataka State Seeds
 * Corporation came back as a "Government office" and National Seeds Corporation
 * as a "Non-profit organization", both past the raw filter. Matching the shown
 * label catches whatever Google actually puts in front of us.
 */
export const NON_BUYER_TYPE_WORDS: readonly string[] = [
  "government",
  "non-profit",
  "nonprofit",
  "association",
  "consultant",
  "school",
  "college",
  "university",
  "temple",
  "church",
  "mosque",
  "hospital",
  "police",
  "library",
  "museum",
  "tourist",
];

/** True when Google's own label for this place marks it as a non-buyer. */
export function isNonBuyerType(displayType: string): boolean {
  const label = displayType.toLowerCase();
  return NON_BUYER_TYPE_WORDS.some((word) => label.includes(word));
}

export function findIndustry(value: string): DiscoveryIndustry | undefined {
  return DISCOVERY_INDUSTRIES.find((i) => i.value === value);
}

export function findCategory(value: string): DiscoveryCategory | undefined {
  return DISCOVERY_CATEGORIES.find((c) => c.value === value);
}
