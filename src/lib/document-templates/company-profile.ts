import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The letterhead: who the document is *from*.
 *
 * WHY THIS EXISTS
 * Every print route read the company details straight off the `accounts` row —
 * `account.business_name`, `account.phone`, `account.email`, `account.gst_number`,
 * `account.gstin`. **None of those columns exist.** The real details are saved by the
 * Company Profile screen into `accounts.settings.company_profile`. So the printed header
 * fell back to the raw account name, the contact line rendered empty, and every document
 * printed the literal text "GST No :" followed by nothing. The uploaded company logo was
 * never rendered at all.
 *
 * Resolving it in one place means the four print routes cannot drift apart again.
 */
export interface CompanyLetterhead {
  name: string;
  logoUrl: string | null;
  email: string;
  phone: string;
  website: string;
  gstNumber: string;
  addressLines: string[];
}

interface RawProfile {
  name?: string;
  logo_url?: string;
  registered_email?: string;
  registered_contact_no?: string;
  support_contact_no?: string;
  website?: string;
  gst_number?: string;
  address?: string;
  area?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function toLetterhead(
  companyProfile: unknown,
  accountName?: string | null
): CompanyLetterhead {
  const p: RawProfile =
    companyProfile && typeof companyProfile === 'object' ? (companyProfile as RawProfile) : {};

  // Street on one line, then the locality line, so a document does not print a single
  // run-on address string with stray commas where fields are blank.
  const localityLine = [clean(p.area), clean(p.city), clean(p.state), clean(p.pincode)]
    .filter(Boolean)
    .join(', ');

  const addressLines = [clean(p.address), localityLine, clean(p.country)].filter(Boolean);

  return {
    name: clean(p.name) || clean(accountName) || 'Company',
    logoUrl: clean(p.logo_url) || null,
    email: clean(p.registered_email),
    // Falls back to the support number so the document is not left without any way to
    // reach the business.
    phone: clean(p.registered_contact_no) || clean(p.support_contact_no),
    website: clean(p.website),
    gstNumber: clean(p.gst_number),
    addressLines,
  };
}

export async function fetchLetterhead(
  supabase: SupabaseClient,
  accountId: string
): Promise<CompanyLetterhead> {
  const { data } = await supabase
    .from('accounts')
    .select('name, settings')
    .eq('id', accountId)
    .maybeSingle();

  return toLetterhead(data?.settings?.company_profile, data?.name);
}
