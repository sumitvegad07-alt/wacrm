// Route Management — shared domain types (Phase 2a).
// Framework-agnostic: this module (and the rest of src/lib/route/*) is the SDK core
// designed to be reused VERBATIM by mobile (mirroring the src/lib/pricing/ precedent).
// Convention (matches src/lib/territories/types.ts): DB row types keep snake_case;
// input types use camelCase. See supabase/migrations/108-112 and
// docs/engineering/specifications/route-management.md.

export type RouteStatus = 'draft' | 'pending_approval' | 'active' | 'rejected' | 'archived';
export type ExecutionStatus = 'in_progress' | 'completed' | 'abandoned';
export type StopStatus = 'pending' | 'completed' | 'skipped';
export type ApprovalMode = 'none' | 'manager' | 'admin';
export type CapacityEnforcement = 'warn' | 'block';

/** ISO day-of-week, 1 = Monday … 7 = Sunday (matches route_plan_assignments). */
export type IsoDayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

// ── DB rows ───────────────────────────────────────────────────
export interface Route {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  primary_assignee_id: string | null; // profiles.id
  status: RouteStatus;
  created_by: string; // auth.users id
  archived_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

/** Route row enriched for list/detail display (assignee name + active customer count). */
export interface RouteWithMeta extends Route {
  customer_count: number;
  primary_assignee_name: string | null;
}

/** Server-side list params — paginated + filterable so the list scales to 500+ routes. */
export interface RouteListParams {
  accountId: string;
  statuses?: RouteStatus[];
  search?: string;
  limit?: number;
  offset?: number;
}

/** Paginated list result. `total` is the server count for the current filter. */
export interface RouteListResult {
  rows: RouteWithMeta[];
  total: number;
}

export interface RouteCustomer {
  id: string;
  account_id: string;
  route_id: string;
  contact_id: string;
  sequence: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A route customer joined with the display fields from contacts. */
export interface RouteCustomerWithContact extends RouteCustomer {
  company: string | null;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  territory_id: string | null;
  needs_territory_review: boolean;
}

export interface RoutePlanAssignment {
  id: string;
  account_id: string;
  route_id: string;
  assignee_id: string; // profiles.id
  day_of_week: number; // 1..7 ISO
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  paused_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Planner assignment enriched with the assigned route's name + status (for board chips). */
export interface RoutePlanAssignmentWithRoute extends RoutePlanAssignment {
  route_name: string | null;
  route_status: RouteStatus | null;
}

export interface RouteExecution {
  id: string;
  account_id: string;
  route_id: string;
  user_id: string; // auth.users id
  execution_date: string;
  status: ExecutionStatus;
  started_at: string | null;
  completed_at: string | null;
  tracking_session_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Execution row enriched for the web monitor: route/salesman names + stop tallies. */
export interface RouteExecutionRow extends RouteExecution {
  route_name: string | null;
  user_name: string | null;
  stops_total: number;
  stops_completed: number;
  stops_skipped: number;
  stops_pending: number;
}
export interface RouteExecutionListParams {
  accountId: string;
  date?: string; // execution_date filter (YYYY-MM-DD); omit for all dates
  statuses?: ExecutionStatus[];
  limit?: number;
  offset?: number;
}
export interface RouteExecutionListResult {
  rows: RouteExecutionRow[];
  total: number;
}

/** Date-wide execution tallies for the monitor tiles (head counts, not per-page). */
export interface RouteExecutionSummary {
  total: number; // started (any status) for the date
  running: number; // in_progress
  completed: number;
}

export interface RouteExecutionStop {
  id: string;
  account_id: string;
  execution_id: string;
  contact_id: string;
  planned_sequence: number | null; // null = unplanned mid-round stop
  actual_sequence: number | null;
  status: StopStatus;
  skip_reason: string | null;
  site_visit_id: string | null;
  visited_at: string | null;
  created_at: string;
  updated_at: string;
}

/** An execution stop enriched with the customer's display name (monitor detail). */
export interface RouteExecutionStopRow extends RouteExecutionStop {
  company: string | null;
  contact_name: string | null;
}

// ── settings (accounts.settings.route_settings) ───────────────
export interface RouteExecutionSettings {
  skip_allowed: boolean;
  skip_reason_mandatory: boolean;
  out_of_sequence_allowed: boolean;
  allow_complete_with_pending: boolean;
}
export interface RouteCapacitySettings {
  max_customers: number;
  enforcement: CapacityEnforcement;
}
export interface RouteValidationSettings {
  warn_duplicate_name: boolean;
  warn_schedule_conflict: boolean;
}
export interface RouteSettings {
  execution: RouteExecutionSettings;
  capacity: RouteCapacitySettings;
  validation: RouteValidationSettings;
  approval_mode: ApprovalMode;
}

// ── health engine ─────────────────────────────────────────────
export type RouteHealthCode =
  | 'no_customers'
  | 'primary_assignee_missing'
  | 'not_assigned'
  | 'duplicate_name'
  | 'capacity_exceeded'
  | 'contains_flagged_customer'
  | 'outside_territory';

export interface RouteHealthCheck {
  code: RouteHealthCode;
  ok: boolean; // true = passes (no warning); false = warning active
  severity: 'warning';
}
export interface RouteHealth {
  score: number; // 0..100
  checks: RouteHealthCheck[];
}

// ── audit history (History tab) ───────────────────────────────
export interface RouteHistoryEntry {
  id: string;
  action: string;
  message: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
}

// ── "today's route" resolver payload ──────────────────────────
export interface RouteTodayCustomer {
  contact_id: string;
  sequence: number;
  company: string | null;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}
export interface RouteForToday {
  route: Route;
  customers: RouteTodayCustomer[];
  assignment_id: string;
}

// ── write inputs (camelCase) ──────────────────────────────────
export interface UpsertRouteInput {
  routeId: string; // client-generated uuid (idempotent / offline-stable)
  name: string;
  description?: string | null;
  primaryAssigneeId?: string | null;
  /** null/undefined = leave customers unchanged; array = set the exact set (order = sequence). */
  customerIds?: string[] | null;
  /** Optimistic concurrency: pass the version last read to detect a stale edit. */
  expectedVersion?: number | null;
}

export interface ImportCustomersInput {
  routeId: string;
  mode: 'all' | 'select';
  contactIds?: string[];
}

/** A contact row for the "Select customers to import" picker (paginated + searchable). */
export interface ImportableContact {
  id: string;
  company: string | null;
  name: string | null;
  territory_id: string | null;
  needs_territory_review: boolean;
}
export interface ImportableContactsParams {
  accountId: string;
  search?: string;
  limit?: number;
  offset?: number;
}
export interface ImportableContactsResult {
  rows: ImportableContact[];
  total: number;
}

export interface ImportCustomersResult {
  added: number;
  skipped_already_routed: number;
  skipped_ineligible: number;
}

export interface PlannerSetInput {
  routeId: string;
  assigneeId: string;
  dayOfWeek: IsoDayOfWeek;
  isActive?: boolean;
  startDate?: string | null;
  endDate?: string | null;
}

export interface PlannerMoveInput {
  routeId: string;
  fromAssigneeId: string;
  fromDayOfWeek: IsoDayOfWeek;
  toAssigneeId: string;
  toDayOfWeek: IsoDayOfWeek;
}

/** One planned stop captured on the device at start (client-authoritative snapshot). */
export interface ExecutionStopSeed {
  stopId: string; // client-generated
  contactId: string;
  plannedSequence: number | null;
}
export interface ExecutionStartInput {
  executionId: string; // client-generated
  routeId: string;
  executionDate?: string;
  trackingSessionId?: string | null;
  stops: ExecutionStopSeed[];
}

/** Visit payload persisted onto the reused site_visits row. */
export interface StopVisitPayload {
  check_in_at?: string;
  check_in_lat?: number;
  check_in_lng?: number;
  check_in_method?: 'geofence_auto' | 'manual' | 'qr_scan';
  notes?: string;
  visit_photo_url?: string;
  feedback_type?: string;
  feedback_text?: string;
}
export interface StopCompleteInput {
  stopId: string;
  siteVisitId: string; // client-generated
  visit?: StopVisitPayload;
  actualSequence?: number | null;
}
export interface StopSkipInput {
  stopId: string;
  reason?: string | null;
  actualSequence?: number | null;
}
