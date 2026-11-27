// ============================================================
// Custom features — per-client switches.
//
// WHAT THIS IS FOR. A client asks for something we do NOT want every tenant to
// have: an extra screen, an extra report, a different rule, a one-off workflow.
// The answer is never a second app, a second portal or a branch of the code. It
// is one key in this file, the code behind it written so it is OFF unless the
// key is granted, and the key ticked on that client's account from
// /admin/companies/[id]. Same app in the stores, same URLs, same deploy.
//
// WHY THE CATALOGUE IS CODE AND THE GRANT IS DATA.
//   - The catalogue (this file) is code because a switch with no code behind it
//     does nothing. Writing the key here is part of building the feature, so the
//     register can never list a feature that does not exist, and `tsc` plus
//     custom-features.test.ts catch a mistyped key.
//   - The grant (`accounts.custom_features`, a text[]) is data because WHO has
//     it changes without a deploy — that is the whole point.
//
// WHY NOT module_settings. Those twelve keys are the product's own optional
// modules: a tenant admin may switch them on themselves, and the server clamps
// them to the plan. A custom feature is the opposite — only OZZO grants it, the
// client cannot find it in their own Settings, and other tenants must not even
// learn it exists. Same reason the DMS is an add-on line rather than a module
// toggle (see ADDON_LINES in ./catalog).
//
// THE RULE THAT KEEPS THIS SMALL. When a SECOND client asks for the same thing,
// it stops being a custom feature: make it an ordinary setting or module for
// everyone, default OFF, and retire the key (see `retired` below). Otherwise
// every sale adds a branch nobody can test, which is how a product stops being
// a product.
// ============================================================

/** Where the switch has an effect. Register only — it gates nothing by itself. */
export type CustomFeatureSurface = "web" | "mobile" | "dms";

export interface CustomFeature {
  /** Stored in accounts.custom_features. lower_snake_case, never reused. */
  key: string;
  /** Short name for the superadmin screens. */
  label: string;
  /** What it does, in one sentence a salesperson can read. */
  description: string;
  /** Who asked for it — the account name or customer id, for the register. */
  requestedBy: string;
  /** YYYY-MM-DD the key was added, so the register reads as a history. */
  since: string;
  /** Which apps change when it is granted. */
  surfaces: readonly CustomFeatureSurface[];
  /**
   * True once the behaviour became standard for everyone (or the client left).
   * A retired key stays listed so the register keeps its history, and stays
   * readable so an account that still holds it is not silently changed — but it
   * can no longer be granted to anyone new.
   */
  retired?: boolean;
  /** Why it was retired, for the register. */
  retiredNote?: string;
}

/**
 * Every per-client switch that exists. Empty is the correct state: a key is
 * added in the same change as the code that honours it, never in advance.
 */
export const CUSTOM_FEATURES: readonly CustomFeature[] = [] as const;

export function customFeature(key: string): CustomFeature | undefined {
  return CUSTOM_FEATURES.find((f) => f.key === key);
}

// The three functions below take the catalogue as a defaulted argument purely so
// the tests can exercise them against a sample catalogue. Callers pass one
// argument; the catalogue is empty today and would make every behaviour test
// vacuous otherwise.

/** A key in the catalogue, retired or not. */
export function isCustomFeatureKey(
  v: unknown,
  catalog: readonly CustomFeature[] = CUSTOM_FEATURES
): boolean {
  return typeof v === "string" && catalog.some((f) => f.key === v);
}

/** A key that may still be granted to an account that does not have it. */
export function isGrantableCustomFeature(
  v: unknown,
  catalog: readonly CustomFeature[] = CUSTOM_FEATURES
): boolean {
  return (
    typeof v === "string" && catalog.some((f) => f.key === v && !f.retired)
  );
}

/**
 * Clean a stored array into the keys this build understands.
 *
 * Unknown keys are dropped rather than kept, so a key removed from the
 * catalogue cannot keep granting anything, and junk in the column cannot reach
 * a comparison. Retired keys are KEPT: the client still has the behaviour until
 * someone unticks it on purpose.
 */
export function normalizeCustomFeatures(
  raw: unknown,
  catalog: readonly CustomFeature[] = CUSTOM_FEATURES
): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const v of raw) {
    if (isCustomFeatureKey(v, catalog)) seen.add(v as string);
  }
  return Array.from(seen).sort();
}

/** True only when this account has been granted the key. Fails closed. */
export function accountHasCustomFeature(
  customFeatures: string[] | null | undefined,
  key: string
): boolean {
  return Array.isArray(customFeatures) && customFeatures.includes(key);
}
