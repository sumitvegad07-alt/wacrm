// ============================================================
// The four demo tenants — one per sellable plan.
//
// Everything that makes a tenant look like a particular kind of company lives
// here: its plan, its territory, its catalogue, and the shape of its customer
// names. The generators in tenant.ts / history.ts read this and contain no
// business-specific strings of their own, so adding a fifth demo tenant is a
// new entry in DEMO_TENANTS and nothing else.
//
// Plans come from ../plans/catalog.ts; the lines a plan grants decide which
// kinds of data a tenant gets at all (a WFA tenant has no orders, because
// Orders is gated on the SFA line in the sidebar).
// ============================================================

import { type PlanId, planLines } from "../plans/catalog";

export interface DemoCity {
  city: string;
  state: string;
  lat: number;
  lng: number;
  /** First four digits of the PIN; the generator appends two more. */
  pin: string;
  areas: string[];
}

export interface DemoCategory {
  name: string;
  /** [product name, list price in INR, unit] */
  products: [string, number, string][];
}

export type CustomerKind = "site" | "retailer" | "household" | "dealer";

export interface DemoTenant {
  /** Short key: the CLI's --only value and the email suffix. */
  key: "wfa" | "sfa" | "wfacrm" | "sfacrm";
  company: string;
  industry: string;
  plan: PlanId;
  adminEmail: string;
  adminName: string;
  /** One city per rep, in rep order. Exactly REP_NAMES.length entries. */
  cities: DemoCity[];
  catalogue: DemoCategory[];
  customerKind: CustomerKind;
  /** How many customers per rep, inclusive range. */
  customersPerRep: [number, number];
  /** Visits a rep logs on a normal working day, inclusive range. */
  visitsPerDay: [number, number];
  /**
   * Modules switched on beyond `defaultModuleSettings(plan)`. Beat Planning
   * (route) ships off by default but is a strong demo, so the two SFA tenants
   * get it. scheme / stock / reporting_hierarchy stay off.
   */
  extraModules: string[];
}

export const PASSWORD = "123456";
export const EXPIRES_AT = "2027-12-31T00:00:00+00:00";
/** 6 logins per tenant (1 admin + 5 reps) plus headroom. */
export const USER_SEATS = 10;

/** The same five people in every tenant, so there are five names to remember. */
export const REP_NAMES = [
  { first: "rahul", full: "Rahul Mehta" },
  { first: "priya", full: "Priya Sharma" },
  { first: "amit", full: "Amit Patel" },
  { first: "sneha", full: "Sneha Deshmukh" },
  { first: "vikram", full: "Vikram Singh" },
] as const;

export const REP_COUNT = REP_NAMES.length;

/** `rahul.sfa@gmail.com` — matches the admin pattern the founder chose. */
export function repEmail(firstName: string, key: string): string {
  return `${firstName}.${key}@gmail.com`;
}

// ── Territories ─────────────────────────────────────────────

const AHMEDABAD_BELT: DemoCity[] = [
  { city: "Ahmedabad", state: "Gujarat", lat: 23.0225, lng: 72.5714, pin: "3800", areas: ["Satellite", "Navrangpura", "Maninagar", "Bopal", "Vastrapur"] },
  { city: "Gandhinagar", state: "Gujarat", lat: 23.2156, lng: 72.6369, pin: "3820", areas: ["Sector 21", "Infocity", "Kudasan", "Sargasan", "Sector 7"] },
  { city: "Nadiad", state: "Gujarat", lat: 22.6916, lng: 72.8634, pin: "3873", areas: ["Station Road", "College Road", "Pij Road", "Mission Road", "Santram Road"] },
  { city: "Anand", state: "Gujarat", lat: 22.5645, lng: 72.9289, pin: "3880", areas: ["Vallabh Vidyanagar", "Mota Bazaar", "Amul Dairy Road", "Gamdi", "Lambhvel Road"] },
  { city: "Mehsana", state: "Gujarat", lat: 23.588, lng: 72.3693, pin: "3840", areas: ["Radhanpur Road", "Highway Road", "Modhera Road", "Nagalpur", "Rajmahal Road"] },
];

const SURAT_BELT: DemoCity[] = [
  { city: "Surat", state: "Gujarat", lat: 21.1702, lng: 72.8311, pin: "3950", areas: ["Adajan", "Varachha", "Katargam", "Athwa", "Udhna"] },
  { city: "Navsari", state: "Gujarat", lat: 20.9467, lng: 72.952, pin: "3964", areas: ["Lunsikui", "Vijalpore", "Dudhia Talav", "Sandhkuva", "Station Road"] },
  { city: "Vapi", state: "Gujarat", lat: 20.3893, lng: 72.9106, pin: "3961", areas: ["GIDC", "Chala", "Gunjan", "Chanod", "Imran Nagar"] },
  { city: "Bharuch", state: "Gujarat", lat: 21.7051, lng: 72.9959, pin: "3920", areas: ["Zadeshwar", "Panchbatti", "Shaktinath", "Link Road", "Station Road"] },
  { city: "Valsad", state: "Gujarat", lat: 20.5992, lng: 72.9342, pin: "3960", areas: ["Tithal Road", "Halar Road", "Abrama", "Dharampur Road", "Mota Bazaar"] },
];

const PUNE_BELT: DemoCity[] = [
  { city: "Pune", state: "Maharashtra", lat: 18.5204, lng: 73.8567, pin: "4110", areas: ["Kothrud", "Hadapsar", "Shivajinagar", "Wakad", "Kondhwa"] },
  { city: "Pimpri-Chinchwad", state: "Maharashtra", lat: 18.6279, lng: 73.8009, pin: "4110", areas: ["Pimpri", "Chinchwad", "Nigdi", "Akurdi", "Bhosari"] },
  { city: "Nashik", state: "Maharashtra", lat: 19.9975, lng: 73.7898, pin: "4220", areas: ["Panchavati", "Satpur", "Indira Nagar", "Gangapur Road", "Nashik Road"] },
  { city: "Ahmednagar", state: "Maharashtra", lat: 19.0948, lng: 74.748, pin: "4140", areas: ["Savedi", "Kedgaon", "MIDC", "Market Yard", "Station Road"] },
  { city: "Satara", state: "Maharashtra", lat: 17.6805, lng: 74.0183, pin: "4150", areas: ["Powai Naka", "Sadar Bazaar", "Godoli", "Karanje", "Shahupuri"] },
];

const SAURASHTRA_BELT: DemoCity[] = [
  { city: "Rajkot", state: "Gujarat", lat: 22.3039, lng: 70.8022, pin: "3600", areas: ["Kalawad Road", "Gondal Road", "University Road", "Mavdi", "Raiya Road"] },
  { city: "Morbi", state: "Gujarat", lat: 22.8173, lng: 70.8378, pin: "3636", areas: ["Ravapar Road", "Sanala Road", "Lalpar", "Shanala", "Nagar Chakla"] },
  { city: "Jamnagar", state: "Gujarat", lat: 22.4707, lng: 70.0577, pin: "3610", areas: ["Indira Marg", "Patel Colony", "Gulabnagar", "Park Colony", "Bedi Road"] },
  { city: "Gondal", state: "Gujarat", lat: 21.9611, lng: 70.8028, pin: "3603", areas: ["Station Plot", "Kolki Road", "Dhoraji Road", "Sanala Road", "Bus Stand Road"] },
  { city: "Junagadh", state: "Gujarat", lat: 21.5222, lng: 70.4579, pin: "3620", areas: ["Talav Gate", "Joshipura", "Zanzarda Road", "Motibaug", "Dhal Road"] },
];

// ── Catalogues ──────────────────────────────────────────────

const FMCG: DemoCategory[] = [
  { name: "Beverages", products: [["Mango Fruit Drink 200ml", 10, "Pieces"], ["Orange Fruit Drink 200ml", 10, "Pieces"], ["Lemon Soda 300ml", 20, "Pieces"], ["Packaged Drinking Water 1L", 20, "Pieces"], ["Cola Soft Drink 750ml", 40, "Pieces"], ["Apple Nectar 1L", 95, "Pieces"]] },
  { name: "Snacks & Namkeen", products: [["Masala Potato Chips 50g", 20, "Pieces"], ["Salted Potato Chips 50g", 20, "Pieces"], ["Aloo Bhujia 200g", 55, "Pieces"], ["Mixture Namkeen 400g", 95, "Pieces"], ["Roasted Peanuts 150g", 45, "Pieces"], ["Khakhra Methi 200g", 60, "Pieces"]] },
  { name: "Biscuits & Bakery", products: [["Glucose Biscuits 100g", 10, "Pieces"], ["Marie Biscuits 200g", 35, "Pieces"], ["Cream Sandwich Biscuits 120g", 25, "Pieces"], ["Salted Crackers 150g", 30, "Pieces"], ["Rusk Toast 300g", 50, "Pieces"], ["Cookies Butter 250g", 85, "Pieces"]] },
  { name: "Personal Care", products: [["Herbal Shampoo 180ml", 110, "Pieces"], ["Sandal Bath Soap 100g", 40, "Pieces"], ["Toothpaste 100g", 60, "Pieces"], ["Coconut Hair Oil 200ml", 85, "Pieces"], ["Body Lotion 100ml", 95, "Pieces"], ["Shaving Cream 70g", 55, "Pieces"]] },
  { name: "Home Care", products: [["Detergent Powder 1kg", 120, "Pieces"], ["Dishwash Bar 150g", 20, "Pieces"], ["Floor Cleaner 500ml", 90, "Pieces"], ["Toilet Cleaner 500ml", 85, "Pieces"], ["Phenyl 1L", 70, "Pieces"], ["Detergent Cake 250g", 25, "Pieces"]] },
];

const TILES: DemoCategory[] = [
  { name: "Floor Tiles", products: [["Vitrified Tile 600x600 Ivory", 545, "Box"], ["Vitrified Tile 600x600 Statuario", 685, "Box"], ["Double Charge Tile 800x800", 1180, "Box"], ["Glazed Vitrified 600x1200 Marble", 1450, "Box"], ["Anti-Skid Parking Tile 400x400", 385, "Box"], ["Wooden Finish Plank 200x1200", 1260, "Box"]] },
  { name: "Wall Tiles", products: [["Ceramic Wall Tile 300x450 Glossy", 265, "Box"], ["Ceramic Wall Tile 300x600 Satin", 340, "Box"], ["Highlighter Wall Tile 300x450", 420, "Box"], ["Subway Tile 75x300 White", 510, "Box"], ["Elevation Tile 300x450 Stone", 395, "Box"], ["Kitchen Backsplash 250x400", 240, "Box"]] },
  { name: "Sanitaryware", products: [["Wall Hung EWC with Seat", 6450, "Pieces"], ["One Piece Closet Syphonic", 9800, "Pieces"], ["Table Top Wash Basin 500mm", 2350, "Pieces"], ["Pedestal Wash Basin Set", 3150, "Pieces"], ["Concealed Cistern 8L", 4700, "Pieces"], ["Urinal Wall Mounted", 3900, "Pieces"]] },
  { name: "CP Fittings", products: [["Single Lever Basin Mixer", 3250, "Pieces"], ["Wall Mixer with Bend Pipe", 2850, "Pieces"], ["Overhead Shower 150mm ABS", 1150, "Pieces"], ["Health Faucet with Hose", 890, "Pieces"], ["Angle Valve Brass", 640, "Pieces"], ["Bib Cock Long Body", 720, "Pieces"]] },
  { name: "Adhesives & Grout", products: [["Tile Adhesive Grey 20kg", 420, "Pieces"], ["Tile Adhesive White 20kg", 560, "Pieces"], ["Epoxy Grout 1kg", 680, "Pieces"], ["Cement Grout 1kg", 145, "Pieces"], ["Tile Spacer 2mm Pack", 95, "Pieces"], ["Waterproofing Compound 5L", 1340, "Pieces"]] },
];

const HOME_SERVICES: DemoCategory[] = [
  { name: "AC Services", products: [["Split AC Jet Service", 649, "Pieces"], ["Window AC Jet Service", 549, "Pieces"], ["Split AC Deep Clean (Foam)", 999, "Pieces"], ["AC Gas Top-Up R32", 2450, "Pieces"], ["AC Gas Charging Full R410", 3850, "Pieces"], ["Cassette AC Service", 1450, "Pieces"]] },
  { name: "Installation", products: [["Split AC Installation", 1599, "Pieces"], ["Split AC Uninstallation", 799, "Pieces"], ["Window AC Installation", 899, "Pieces"], ["Copper Piping per Metre", 480, "Pieces"], ["Stabilizer Installation", 349, "Pieces"], ["Outdoor Unit Stand Fitting", 650, "Pieces"]] },
  { name: "Repairs", products: [["PCB Repair Split AC", 2250, "Pieces"], ["Compressor Replacement 1.5T", 11500, "Pieces"], ["Fan Motor Replacement", 2850, "Pieces"], ["Cooling Coil Repair", 3400, "Pieces"], ["Drain Line Unclogging", 499, "Pieces"], ["Remote Sensor Replacement", 850, "Pieces"]] },
  { name: "Spares", products: [["Air Filter Split AC", 450, "Pieces"], ["Capacitor 35uF", 620, "Pieces"], ["Blower Wheel", 1250, "Pieces"], ["Copper Pipe Insulation 5m", 540, "Pieces"], ["Outdoor Unit Cover", 390, "Pieces"], ["Universal AC Remote", 540, "Pieces"]] },
  { name: "AMC Plans", products: [["AMC Basic 2 Services (1 AC)", 1899, "Pieces"], ["AMC Standard 3 Services (1 AC)", 2699, "Pieces"], ["AMC Premium 4 Services (1 AC)", 3499, "Pieces"], ["AMC Basic 2 Services (3 AC)", 4999, "Pieces"], ["AMC Standard 3 Services (3 AC)", 7299, "Pieces"], ["AMC Corporate 10 Units", 24500, "Pieces"]] },
];

const FACILITY_CONSUMABLES: DemoCategory[] = [
  { name: "Housekeeping Consumables", products: [["Floor Cleaner Concentrate 5L", 640, "Pieces"], ["Glass Cleaner 500ml", 145, "Pieces"], ["Toilet Cleaner 5L", 580, "Pieces"], ["Hand Wash Refill 5L", 495, "Pieces"], ["Room Freshener 300ml", 210, "Pieces"], ["Phenyl Concentrate 5L", 420, "Pieces"]] },
  { name: "Housekeeping Tools", products: [["Microfibre Mop Set", 850, "Pieces"], ["Wringer Trolley Double Bucket", 3650, "Pieces"], ["Floor Wiper 24 inch", 540, "Pieces"], ["Dustbin 60L Pedal", 1450, "Pieces"], ["Caution Wet Floor Sign", 390, "Pieces"], ["Scrubbing Pad Pack of 10", 230, "Pieces"]] },
  { name: "Safety & PPE", products: [["Nitrile Hand Gloves Pair", 85, "Pieces"], ["Safety Shoes Steel Toe", 1250, "Pieces"], ["Reflective Jacket", 320, "Pieces"], ["Face Mask 3 Ply Box", 180, "Pieces"], ["Safety Goggles", 240, "Pieces"], ["First Aid Kit Wall Mount", 1150, "Pieces"]] },
  { name: "Pest Control", products: [["Cockroach Gel Treatment", 890, "Pieces"], ["Termite Pre-Construction", 2450, "Pieces"], ["Rodent Bait Station", 640, "Pieces"], ["Mosquito Fogging per Visit", 1250, "Pieces"], ["General Disinfection per 1000 sqft", 1850, "Pieces"], ["Bed Bug Treatment per Room", 1450, "Pieces"]] },
  { name: "Uniforms", products: [["Housekeeping Uniform Set", 780, "Pieces"], ["Security Guard Uniform Set", 1150, "Pieces"], ["Apron Cotton", 260, "Pieces"], ["Cap with Logo", 140, "Pieces"], ["ID Card with Lanyard", 95, "Pieces"], ["Winter Jacket", 1340, "Pieces"]] },
];

// ── The four tenants ────────────────────────────────────────

export const DEMO_TENANTS: DemoTenant[] = [
  {
    key: "wfa",
    company: "Shreeji Facility Services",
    industry: "Facility Management",
    plan: "WFA",
    adminEmail: "ozzowfa@gmail.com",
    adminName: "Shreeji Admin",
    cities: AHMEDABAD_BELT,
    catalogue: FACILITY_CONSUMABLES,
    customerKind: "site",
    customersPerRep: [10, 14],
    visitsPerDay: [4, 7],
    extraModules: [],
  },
  {
    key: "sfa",
    company: "Balaji Agencies",
    industry: "FMCG Distribution",
    plan: "SFA",
    adminEmail: "ozzosfa@gmail.com",
    adminName: "Balaji Admin",
    cities: SURAT_BELT,
    catalogue: FMCG,
    customerKind: "retailer",
    customersPerRep: [26, 34],
    visitsPerDay: [5, 9],
    extraModules: ["route"],
  },
  {
    key: "wfacrm",
    company: "CoolCare Home Services",
    industry: "Appliance Service",
    plan: "CRM_WFA",
    adminEmail: "ozzowfacrm@gmail.com",
    adminName: "CoolCare Admin",
    cities: PUNE_BELT,
    catalogue: HOME_SERVICES,
    customerKind: "household",
    customersPerRep: [16, 22],
    visitsPerDay: [4, 7],
    extraModules: [],
  },
  {
    key: "sfacrm",
    company: "Satyam Ceramics & Sanitary",
    industry: "Building Materials",
    plan: "CRM_SFA",
    adminEmail: "ozzosfacrm@gmail.com",
    adminName: "Satyam Admin",
    cities: SAURASHTRA_BELT,
    catalogue: TILES,
    customerKind: "dealer",
    customersPerRep: [22, 30],
    visitsPerDay: [4, 7],
    extraModules: ["route"],
  },
];

export function tenantByKey(key: string): DemoTenant | undefined {
  return DEMO_TENANTS.find((t) => t.key === key);
}

/** The product lines a tenant's plan grants — drives what data it gets at all. */
export function linesOf(t: DemoTenant) {
  return planLines(t.plan);
}

// ── Name pools ──────────────────────────────────────────────

export const FIRST_NAMES = [
  "Aarav", "Aditya", "Akash", "Alok", "Amar", "Anand", "Aniket", "Ankit", "Arun", "Ashish",
  "Bhavesh", "Chetan", "Dhaval", "Dinesh", "Gaurav", "Girish", "Harsh", "Hemant", "Jatin", "Jignesh",
  "Kalpesh", "Kaushik", "Kiran", "Lalit", "Mahesh", "Mayur", "Mukesh", "Naresh", "Nikhil", "Nilesh",
  "Paresh", "Pankaj", "Pravin", "Rajesh", "Rakesh", "Ramesh", "Ravi", "Sachin", "Sagar", "Sanjay",
  "Shailesh", "Shirish", "Sunil", "Tarun", "Tushar", "Umesh", "Vinod", "Vishal", "Yogesh", "Zahir",
  "Anita", "Asha", "Bhavna", "Chetna", "Divya", "Geeta", "Hema", "Jyoti", "Kirti", "Lata",
  "Madhuri", "Namrata", "Neha", "Payal", "Rekha", "Sarita", "Seema", "Shilpa", "Trupti", "Vandana",
];

export const LAST_NAMES = [
  "Shah", "Patel", "Mehta", "Desai", "Trivedi", "Pandya", "Joshi", "Bhatt", "Vyas", "Dave",
  "Thakkar", "Parekh", "Gandhi", "Kapadia", "Soni", "Chokshi", "Modi", "Doshi", "Jain", "Agarwal",
  "Gupta", "Sharma", "Verma", "Yadav", "Mishra", "Tiwari", "Pandey", "Singh", "Chauhan", "Rathod",
  "Kulkarni", "Deshmukh", "Jadhav", "Patil", "Shinde", "Pawar", "Gaikwad", "More",
  "Reddy", "Rao", "Naidu", "Nair", "Menon", "Pillai", "Iyer",
];

export const FIRM_PREFIX = [
  "Shree", "Shri", "New", "Jai", "Krishna", "Ganesh", "Laxmi", "Sai", "Balaji", "Mahavir",
  "Arihant", "Vardhman", "Hari", "Om", "Gayatri", "Tirupati", "Ambika", "Durga", "Shakti", "Surya",
  "Chandra", "Ratna", "Swastik", "Vishwa", "Bharat", "Deep", "Jyot", "Kamal", "Navkar", "Pushpa",
  "Rajdhani", "Sagar", "Sangam", "Satyam", "Shubh", "Siddhi", "Umiya", "Vijay", "Yash", "Anmol",
];

/** Trade words, per customer kind, so a retailer is not called a "Tower". */
export const FIRM_KIND: Record<CustomerKind, string[]> = {
  retailer: ["Kirana Store", "General Store", "Provision Store", "Super Market", "Departmental Store", "Traders", "Stores", "Agency"],
  dealer: ["Ceramics", "Tiles & Marbles", "Sanitary Mart", "Hardware", "Building Material", "Traders", "Sales Corporation", "Enterprise"],
  site: ["Residency", "Heights", "Business Park", "Corporate House", "Tower", "Arcade", "Industrial Estate", "Hospital"],
  household: ["Residency", "Apartments", "Society", "Heights", "Villa", "Enclave", "Park", "Nagar"],
};

export const FIRM_SUFFIX = ["", "", "", " & Sons", " & Co.", " Pvt Ltd", " LLP"];

export const STREETS = [
  "Main Road", "Market Road", "Station Road", "Bazaar Street", "Ring Road",
  "Shop No 4, Shanti Complex", "Shop No 12, Krishna Plaza", "Ground Floor, Sai Arcade",
  "Near Bus Stand", "Opp. Post Office", "Shop No 7, Gokul Shopping Centre",
];

export const UNIT_NAMES: [string, string][] = [
  ["Pieces", "Pcs"],
  ["Box", "Box"],
  ["Case", "Case"],
  ["Kilograms", "Kg"],
  ["Litre", "Ltr"],
];
