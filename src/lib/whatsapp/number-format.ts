// ------------------------------------------------------------
// WhatsApp number formatting.
//
// The product decision this encodes: admins type only the local number, the
// way they always have. The country code is fixed per organisation, shown
// beside the input, and cannot be edited on a record. That removes the single
// most common cause of an unreachable number — 9 of 27 production customers
// were stored as bare 10-digit mobiles, which WhatsApp rejects outright.
//
// The country code is an ACCOUNT SETTING defaulting to '+91', not a constant.
// Hardcoding it would work today and become a migration plus a data cleanup the
// day a customer outside India signs up. Admins still cannot change it per
// record, so the behaviour is exactly as specified.
//
// Storage format: '+<cc><national>', e.g. '+919876543210'. The '+' is kept in
// the database because it is what a human reads back, and stripped at send time
// by sanitizePhoneForMeta, which is what Meta's API wants.
// ------------------------------------------------------------

export const DEFAULT_COUNTRY_CODE = '+91'

/** Longest national number we accept, per E.164's 15-digit total. */
const MAX_E164_DIGITS = 15

/**
 * Longest plausible national number without a country code. Anything longer
 * must already include one. India and the US are both 10; nowhere in common
 * use exceeds it.
 */
const MAX_NATIONAL_DIGITS = 10

export interface SplitNumber {
  /** Always normalised to '+NN' form. */
  countryCode: string
  /** Digits only, no country code. What the admin types and sees. */
  national: string
}

/** Normalise any country-code spelling ('91', '+91', ' +91 ') to '+91'. */
export function normalizeCountryCode(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (!digits) return DEFAULT_COUNTRY_CODE
  return `+${digits}`
}

/**
 * Split a stored number into the fixed country code and the part the admin edits.
 *
 * Deliberately tolerant, because real data is messy: values arrive as
 * '+919876543210', '919876543210', '9876543210', '098765 43210' and worse. The
 * rule is: if what's stored already begins with the account's country code AND
 * what remains is a plausible national number, treat it as prefixed. Otherwise
 * treat the whole thing as national.
 *
 * The "plausible remainder" check matters. A bare 10-digit Indian mobile
 * starting 91 — say 9199887766 — would otherwise be read as country code 91
 * plus an 8-digit number, silently mangling a valid number into an invalid one.
 */
export function splitWhatsAppNumber(
  stored: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): SplitNumber {
  const cc = normalizeCountryCode(countryCode)
  const ccDigits = cc.slice(1)
  const raw = String(stored ?? '').trim()
  if (!raw) return { countryCode: cc, national: '' }

  const digits = raw.replace(/\D/g, '')
  if (!digits) return { countryCode: cc, national: '' }

  // An explicit '+' means the country code is genuinely present.
  if (raw.startsWith('+')) {
    if (digits.startsWith(ccDigits)) {
      return { countryCode: cc, national: digits.slice(ccDigits.length) }
    }
    // A different country's number. Keep it whole rather than forcing it under
    // this account's code, which would corrupt it.
    return { countryCode: `+${digits.slice(0, guessCcLength(digits))}`, national: digits.slice(guessCcLength(digits)) }
  }

  // No '+'. Strip the country code only when the number is LONGER than any
  // plausible national number — that length is the only real evidence the code
  // is actually present.
  //
  // The naive test ("starts with 91") corrupts data: 9199887766 is a valid
  // 10-digit Indian mobile, and stripping its leading 91 leaves 8 digits and a
  // silently broken number. Requiring more than MAX_NATIONAL_DIGITS handles
  // every country this could ship to — +91 12→10, +971 12→9, +1 11→10 all
  // strip correctly, while a bare national number of 10 or fewer digits is
  // always left intact.
  const looksPrefixed =
    digits.startsWith(ccDigits) &&
    digits.length > MAX_NATIONAL_DIGITS &&
    digits.length - ccDigits.length >= 6

  if (looksPrefixed) {
    return { countryCode: cc, national: digits.slice(ccDigits.length) }
  }

  return { countryCode: cc, national: digits }
}

/**
 * Country codes are 1-3 digits and cannot be told apart without a lookup table.
 * Only used for foreign numbers that already carry a '+', where the exact split
 * is cosmetic — the full number is preserved either way.
 */
function guessCcLength(digits: string): number {
  if (digits.startsWith('1') || digits.startsWith('7')) return 1
  return 2
}

/** Join an edited national number back into storage form. Empty in, empty out. */
export function joinWhatsAppNumber(
  countryCode: string,
  national: string | null | undefined,
): string {
  const cc = normalizeCountryCode(countryCode)
  const digits = String(national ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return `${cc}${digits}`
}

/**
 * Normalise anything into storage form using the account's country code.
 *
 * This is what the backfill and every save path run through, so a number can
 * only ever be stored one way regardless of how it was typed or imported.
 * Returns '' when there is nothing usable, never a half-formed value.
 */
export function normalizeWhatsAppNumber(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): string {
  const { countryCode: cc, national } = splitWhatsAppNumber(raw, countryCode)
  if (!national) return ''
  return joinWhatsAppNumber(cc, national)
}

export interface NumberValidity {
  valid: boolean
  /** Plain-English, shown under the input. */
  message?: string
}

/**
 * Validate the national part as the admin types.
 *
 * Length limits only — no country-specific pattern matching, which would
 * reject legitimate numbers as the product expands and is exactly the kind of
 * clever rule that turns into a support ticket.
 */
export function validateNationalNumber(
  national: string,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): NumberValidity {
  const digits = String(national ?? '').replace(/\D/g, '')
  if (!digits) return { valid: true } // empty is allowed; required-ness is the form's call

  const ccDigits = normalizeCountryCode(countryCode).slice(1).length

  if (digits.length < 6) {
    return { valid: false, message: 'That looks too short for a phone number.' }
  }
  if (digits.length + ccDigits > MAX_E164_DIGITS) {
    return { valid: false, message: 'That looks too long for a phone number.' }
  }
  if (digits.startsWith('0')) {
    return {
      valid: false,
      message: 'Leave off the leading 0 — the country code replaces it.',
    }
  }
  return { valid: true }
}

/** Strip formatting as the admin types, so only digits ever reach state. */
export function sanitizeNationalInput(input: string): string {
  return String(input ?? '')
    .replace(/\D/g, '')
    .slice(0, MAX_E164_DIGITS)
}

/** Display form for read-only surfaces, e.g. a deal showing its customer's number. */
export function formatWhatsAppForDisplay(
  stored: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE,
): string {
  const { countryCode: cc, national } = splitWhatsAppNumber(stored, countryCode)
  if (!national) return ''
  return `${cc} ${national}`
}
