// ============================================================
// Plan, seat and module rules for the superadmin billing write path.
//
// Validation lives here as pure functions rather than inline in the route, so
// the rules that decide what a tenant is allowed to be are testable and stated
// once. The route stays responsible for auth, persistence and audit.
// ============================================================

export const PLANS = ["Trial", "Basic", "Pro", "Enterprise"] as const;
export type Plan = (typeof PLANS)[number];

export const SUBSCRIPTION_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "suspended",
  "cancelled",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Per-user monthly price, matching what the Billing page already reports. */
export const PLAN_PRICES: Record<Plan, number> = {
  Trial: 0,
  Basic: 100,
  Pro: 200,
  Enterprise: 350,
};

/** Billing counts a minimum of 3 seats regardless of actual user count. */
export const MIN_BILLABLE_SEATS = 3;

export const MODULE_KEYS = [
  "whatsapp",
  "quotation",
  "expense",
  "dispatch",
  "pending_dispatch",
  "territory",
  "reporting_hierarchy",
  "route",
  "payment",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isPlan(v: unknown): v is Plan {
  return typeof v === "string" && (PLANS as readonly string[]).includes(v);
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

  if (change.plan !== undefined) {
    if (!isPlan(change.plan)) {
      throw new BillingValidationError(
        `Unknown plan. Expected one of: ${PLANS.join(", ")}`,
      );
    }
    if (change.plan !== current.subscription_plan) out.subscription_plan = change.plan;
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

  if (change.modules !== undefined) {
    if (
      typeof change.modules !== "object" ||
      change.modules === null ||
      Array.isArray(change.modules)
    ) {
      throw new BillingValidationError("Modules must be an object of key → boolean");
    }
    const next: Record<string, boolean> = { ...(current.module_settings ?? {}) };
    for (const [key, value] of Object.entries(change.modules)) {
      if (!isModuleKey(key)) {
        throw new BillingValidationError(`Unknown module: ${key}`);
      }
      if (typeof value !== "boolean") {
        throw new BillingValidationError(`Module ${key} must be true or false`);
      }
      next[key] = value;
    }
    out.module_settings = next;
  }

  return out;
}

/**
 * Monthly revenue for one account.
 *
 * Soft-deleted and never-activated tenants are excluded by the caller, not
 * here — this answers "what is this account worth", and the decision about
 * which accounts count is a separate one.
 */
export function monthlyRevenue(
  plan: string | null,
  userCount: number | null,
): number {
  if (!isPlan(plan)) return 0;
  const seats = Math.max(userCount ?? MIN_BILLABLE_SEATS, MIN_BILLABLE_SEATS);
  return PLAN_PRICES[plan] * seats;
}
