import type { JobPriority } from './types';

export type AssignmentMode = 'manual' | 'area_based';

export type ServiceSettings = {
  asset_code_prefix: string;
  job_no_prefix: string;
  /**
   * Target resolution hours per priority. Each value is a whole number in
   * 1..8760 (one year); anything else falls back to the default. The cap and
   * integer rule exist because Phase 2 casts these into a Postgres interval in
   * a trigger, and a value like 1e21 serialises as "1e+21", which that cast
   * cannot parse.
   */
  sla_hours: Record<JobPriority, number>;
  default_assignment_mode: AssignmentMode;
  require_asset_on_assign: boolean;
};

export const DEFAULT_SERVICE_SETTINGS: ServiceSettings = {
  asset_code_prefix: 'AST',
  job_no_prefix: 'JOB',
  sla_hours: { low: 72, medium: 48, high: 24, critical: 4 },
  default_assignment_mode: 'area_based',
  require_asset_on_assign: true,
};

const MAX_SLA_HOURS = 8760; // one year
const PRIORITIES: JobPriority[] = ['low', 'medium', 'high', 'critical'];

function normalizePrefix(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  return cleaned.length > 0 ? cleaned : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function normalizeServiceSettings(raw: unknown): ServiceSettings {
  if (!isRecord(raw)) return { ...DEFAULT_SERVICE_SETTINGS, sla_hours: { ...DEFAULT_SERVICE_SETTINGS.sla_hours } };

  const slaRaw = isRecord(raw.sla_hours) ? raw.sla_hours : {};
  const sla_hours = { ...DEFAULT_SERVICE_SETTINGS.sla_hours };
  for (const p of PRIORITIES) {
    const v = slaRaw[p];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_SLA_HOURS) sla_hours[p] = v;
  }

  return {
    asset_code_prefix: normalizePrefix(raw.asset_code_prefix, DEFAULT_SERVICE_SETTINGS.asset_code_prefix),
    job_no_prefix: normalizePrefix(raw.job_no_prefix, DEFAULT_SERVICE_SETTINGS.job_no_prefix),
    sla_hours,
    default_assignment_mode:
      raw.default_assignment_mode === 'manual' || raw.default_assignment_mode === 'area_based'
        ? raw.default_assignment_mode
        : DEFAULT_SERVICE_SETTINGS.default_assignment_mode,
    require_asset_on_assign:
      typeof raw.require_asset_on_assign === 'boolean'
        ? raw.require_asset_on_assign
        : DEFAULT_SERVICE_SETTINGS.require_asset_on_assign,
  };
}

const DAY_MS = 86_400_000;
const EXPIRING_WINDOW_DAYS = 30;

export function warrantyState(
  asset: { warranty_end: string | null },
  today: Date = new Date(),
): 'none' | 'active' | 'expiring' | 'expired' {
  if (!asset.warranty_end) return 'none';
  // Compare calendar days in UTC. warranty_end is a DATE column, so it carries
  // no time or zone; anchoring both sides to UTC midnight keeps the boundary
  // days stable regardless of where the viewer sits.
  const end = Date.parse(`${asset.warranty_end}T00:00:00Z`);
  if (Number.isNaN(end)) return 'none';
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.floor((end - now) / DAY_MS);
  if (Number.isNaN(days)) return 'none'; // invalid `today`: a safe answer beats a confidently wrong one
  if (days < 0) return 'expired';
  return days <= EXPIRING_WINDOW_DAYS ? 'expiring' : 'active';
}
