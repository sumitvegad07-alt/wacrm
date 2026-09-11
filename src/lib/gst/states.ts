/**
 * Canonical India GST state list + 2-digit state codes.
 *
 * This is the TS MIRROR of the SQL function `gst_state_code(text)` in
 * migration 20260911120000_gst_determinants.sql. The two MUST stay in sync —
 * the same TS/SQL parity contract the pricing engine has. The SQL side is
 * authoritative for what gets persisted on an order; this side drives the
 * Company Profile state picker and the order-form live preview so that what
 * the user sees matches what the server will store.
 *
 * A GSTIN's first two characters ARE its state code, so for a registered party
 * the code should be derived from the GSTIN (see `gstStateCodeFromGstin`);
 * `gstStateCode(name)` is the fallback for an unregistered (B2C) party entered
 * only by state name.
 */

export interface GstState {
  /** 2-digit GST state code, e.g. "24" for Gujarat. */
  code: string;
  /** Canonical display name, e.g. "Gujarat". */
  name: string;
}

/** The picker list — official name + code, ordered by code. */
export const GST_STATES: readonly GstState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '25', name: 'Daman and Diu' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
];

/** Common aliases → canonical code, matching the SQL function's extra cases. */
const ALIAS_TO_CODE: Record<string, string> = {
  uttaranchal: '05',
  newdelhi: '07',
  orissa: '21',
  chattisgarh: '22',
  pondicherry: '34',
  andamannicobar: '35',
  dadranagarhaveli: '26',
  dadraandnagarhaveli: '26',
};

const norm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^a-z]/g, '');

const NAME_TO_CODE: Record<string, string> = (() => {
  const m: Record<string, string> = { ...ALIAS_TO_CODE };
  for (const s of GST_STATES) m[norm(s.name)] = s.code;
  return m;
})();

const CODE_TO_NAME: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const s of GST_STATES) m[s.code] = s.name;
  return m;
})();

/** State NAME → 2-digit code. Mirror of SQL `gst_state_code(text)`. NULL-safe. */
export function gstStateCode(name: string | null | undefined): string | null {
  return NAME_TO_CODE[norm(name)] ?? null;
}

/** 2-digit code → canonical NAME (for the Tally exporter / display). */
export function gstStateName(code: string | null | undefined): string | null {
  return code ? CODE_TO_NAME[code] ?? null : null;
}

/**
 * A registered party's authoritative state code is the first two chars of its
 * 15-char GSTIN. Returns null when the GSTIN is absent or malformed.
 */
export function gstStateCodeFromGstin(gstin: string | null | undefined): string | null {
  const g = (gstin ?? '').trim();
  if (g.length !== 15) return null;
  const code = g.slice(0, 2);
  return CODE_TO_NAME[code] ? code : null;
}

export type GstType = 'intrastate' | 'interstate' | 'unknown';

/**
 * The determination, mirroring the SQL in create_order/update_order exactly:
 * both codes present and equal → intrastate; both present → interstate;
 * anything missing → unknown (NEVER a silent 'interstate').
 */
export function determineGstType(
  supplierStateCode: string | null | undefined,
  placeOfSupplyCode: string | null | undefined,
): GstType {
  if (!supplierStateCode || !placeOfSupplyCode) return 'unknown';
  return supplierStateCode === placeOfSupplyCode ? 'intrastate' : 'interstate';
}
