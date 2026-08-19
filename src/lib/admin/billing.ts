// ============================================================
// Plan, seat and module rules for the superadmin billing write path.
//
// Validation lives here as pure functions rather than inline in the route, so
// the rules that decide what a tenant is allowed to be are testable and stated
// once. The route stays responsible for auth, persistence and audit.
//
// The plan → product-line → module map itself lives in `@/lib/plans/catalog`;
// this module composes it into the billing write path (validating a requested
// change and deriving the module_settings a plan implies).
// ============================================================

import {
  PLAN_IDS,
  PLAN_PRICE,
  MODULE_KEYS,
  clampModuleSettings,
  defaultModuleSettings,
  isNewPlan,
  type PlanId,
  type ModuleKey,
} from "@/lib/plans/catalog";

// Re-exported so existing callers (the superadmin tenant editor) keep importing
// the module list from one place.
export { MODULE_KEYS };
export type { ModuleKey, PlanId };

/** The plans a superadmin may assign going forward. */
export const PLANS = PLAN_IDS;
export type Plan = PlanId;

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "suspended",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Billing counts a minimum of 3 seats regardless of actual user count. */
export const MIN_BILLABLE_SEATS = 3;

export function isPlan(v: unknown): v is Plan {
  return isNewPlan(v);
}

export function isStatus(v: unknown): v is SubscriptionStatus {
  return (
    typeof v === "string" &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(v)
  );
}

export function isModuleKey(v: unknown): v is ModuleKey {
  return typeof v === "string" && (MODULE_KEYS as readonly string[]).includes(v);
}

export interface AccountBillingState {
  subscription_plan: string | null;
  subscription_status: string | null;
  subscription_expires_at: string | null;
  user_count: number | null;
  module_settings: Record<string, boolean> | null;
}

export interface BillingChange {
  plan?: unknown;
  status?: unknown;
  expiresAt?: unknown;
  userCount?: unknown;
  modules?: unknown;
}

export interface ValidatedChange {
  subscription_plan?: Plan;
  subscription_status?: SubscriptionStatus;
  subscription_expires_at?: string | null;
  user_count?: number;
  module_settings?: Record<string, boolean>;
}

export class BillingValidationError extends Error {}

/**
 * Validate a requested change against the account's current state.
 *
 * Returns only the fields actually being changed, so the caller writes a
 * minimal update and the audit entry records exactly what moved.
 *
 * Module enforcement: whenever the plan changes, or the modules are edited,
 * the resulting module_settings is clamped to the plan's allowed set — a
 * module outside the plan can never be written true. Changing the plan without
 * touching the module checkboxes re-seeds module_settings to the new plan's
 * defaults.
 *
 * @param current - the account as it stands
 * @param change  - untrusted request body
 * @param activeUsers - real profile count, used to refuse a seat reduction
 *                      below the users who already exist
 */
export function validateBillingChange(
  current: AccountBillingState,
  change: BillingChange,
  activeUsers: number,
): ValidatedChange {
  const out: ValidatedChange = {};

  // Only validate the plan when it is actually changing. A save that leaves a
  // legacy plan value ("Free"/"Enterprise") untouched must not be rejected just
  // because that value is not one of the new sellable plans.
  const planChanging =
    change.plan !== undefined && change.plan !== current.subscription_plan;
  if (planChanging) {
    if (!isPlan(change.plan)) {
      throw new BillingValidationError(
        `Unknown plan. Expected one of: ${PLANS.join(", ")}`,
      );
    }
    out.subscription_plan = change.plan;
  }

  if (change.status !== undefined) {
    if (!isStatus(change.status)) {
      throw new BillingValidationError(
        `Unknown status. Expected one of: ${SUBSCRIPTION_STATUSES.join(", ")}`,
      );
    }
    if (change.status !== current.subscription_status) {
      out.subscription_status = change.status;
    }
  }

  if (change.expiresAt !== undefined) {
    if (change.expiresAt === null || change.expiresAt === "") {
      out.subscription_expires_at = null;
    } else if (typeof change.expiresAt !== "string") {
      throw new BillingValidationError("Expiry must be a date string or null");
    } else {
      const t = Date.parse(change.expiresAt);
      if (Number.isNaN(t)) {
        throw new BillingValidationError("Expiry is not a valid date");
      }
      out.subscription_expires_at = new Date(t).toISOString();
    }
  }

  if (change.userCount !== undefined) {
    const n = Number(change.userCount);
    if (!Number.isInteger(n) || n < 1) {
      throw new BillingValidationError("Seat count must be a positive whole number");
    }
    // Refusing to set a limit below the users who already exist: the app
    // enforces this limit on employee creation, so an under-set limit silently
    // locks a tenant out of managing their own team.
    if (n < activeUsers) {
      throw new BillingValidationError(
        `Cannot set ${n} seats — the tenant already has ${activeUsers} users`,
      );
    }
    if (n !== current.user_count) out.user_count = n;
  }

  // The plan the resulting module_settings must obey — the new plan if it is
  // changing, otherwise the current one.
  const effectivePlan = out.subscription_plan ?? current.subscription_plan;

  if (change.modules !== undefined) {
    if (
      typeof change.modules !== "object" ||
      change.modules === null ||
      Array.isArray(change.modules)
    ) {
      throw new BillingValidationError("Modules must be an object of key → boolean");
    }
    // Start from the current settings so unspecified keys are preserved, layer
    // the requested edits on top, then clamp the whole thing to the plan.
    const desired: Record<string, boolean> = {
      ...(current.module_settings ?? {}),
      ...(change.modules as Record<string, boolean>),
    };
    out.module_settings = clampModuleSettings(effectivePlan, desired);
  } else if (planChanging) {
    // Plan changed but the module checkboxes were not sent — seed the new
    // plan's defaults so enabling a plan actually turns its features on.
    out.module_settings = defaultModuleSettings(effectivePlan);
  }

  return out;
}

/**
 * Monthly revenue for one account, in INR.
 *
 * Soft-deleted and never-activated tenants are excluded by the caller, not
 * here. A legacy plan value that predates the line model prices at 0 — those
 * accounts are counted by the billing page's own legacy-aware calculation
 * until they are re-planned.
 */
export function monthlyRevenue(
  plan: string | null,
  userCount: number | null,
): number {
  if (!isPlan(plan)) return 0;
  const seats = Math.max(userCount ?? MIN_BILLABLE_SEATS, MIN_BILLABLE_SEATS);
  return PLAN_PRICE[plan] * seats;
}
