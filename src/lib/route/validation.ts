// Route Management — client-side input validation (Phase 2a).
// Zod schemas (repo uses zod ^4). Server RPCs are still authoritative; this catches
// obvious mistakes early and produces a typed RouteError('validation') before the round-trip.

import { z } from 'zod';
import { RouteError } from './errors';
import type {
  UpsertRouteInput,
  ImportCustomersInput,
  PlannerSetInput,
  PlannerMoveInput,
  ExecutionStartInput,
  StopCompleteInput,
  StopSkipInput,
} from './types';

const uuid = z.string().uuid();
const dow = z.number().int().min(1).max(7);

export const upsertRouteSchema = z.object({
  routeId: uuid,
  name: z.string().trim().min(1, 'Route name is required').max(120, 'Route name is too long'),
  description: z.string().trim().max(2000).nullish(),
  primaryAssigneeId: uuid.nullish(),
  customerIds: z.array(uuid).nullish(),
  expectedVersion: z.number().int().nonnegative().nullish(),
});

export const importCustomersSchema = z.object({
  routeId: uuid,
  mode: z.enum(['all', 'select']),
  contactIds: z.array(uuid).optional(),
}).refine((v) => v.mode !== 'select' || (v.contactIds?.length ?? 0) > 0, {
  message: 'Select at least one customer to import',
  path: ['contactIds'],
});

export const plannerSetSchema = z.object({
  routeId: uuid,
  assigneeId: uuid,
  dayOfWeek: dow,
  isActive: z.boolean().optional(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
});

export const plannerMoveSchema = z.object({
  routeId: uuid,
  fromAssigneeId: uuid,
  fromDayOfWeek: dow,
  toAssigneeId: uuid,
  toDayOfWeek: dow,
});

export const executionStartSchema = z.object({
  executionId: uuid,
  routeId: uuid,
  executionDate: z.string().optional(),
  trackingSessionId: uuid.nullish(),
  stops: z.array(
    z.object({
      stopId: uuid,
      contactId: uuid,
      plannedSequence: z.number().int().nullable(),
    })
  ),
});

export const stopCompleteSchema = z.object({
  stopId: uuid,
  siteVisitId: uuid,
  visit: z
    .object({
      check_in_at: z.string().optional(),
      check_in_lat: z.number().optional(),
      check_in_lng: z.number().optional(),
      check_in_method: z.enum(['geofence_auto', 'manual', 'qr_scan']).optional(),
      notes: z.string().optional(),
      visit_photo_url: z.string().optional(),
      feedback_type: z.string().optional(),
      feedback_text: z.string().optional(),
    })
    .optional(),
  actualSequence: z.number().int().nullish(),
});

export const stopSkipSchema = z.object({
  stopId: uuid,
  reason: z.string().trim().nullish(),
  actualSequence: z.number().int().nullish(),
});

/** Validate against a schema, throwing a typed RouteError('validation') on failure. */
export function assertValid<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new RouteError('validation', first?.message ?? 'Invalid input');
  }
  return result.data;
}

// Typed convenience validators used by the SDK.
export const validateUpsertRoute = (i: UpsertRouteInput) => assertValid(upsertRouteSchema, i);
export const validateImportCustomers = (i: ImportCustomersInput) => assertValid(importCustomersSchema, i);
export const validatePlannerSet = (i: PlannerSetInput) => assertValid(plannerSetSchema, i);
export const validatePlannerMove = (i: PlannerMoveInput) => assertValid(plannerMoveSchema, i);
export const validateExecutionStart = (i: ExecutionStartInput) => assertValid(executionStartSchema, i);
export const validateStopComplete = (i: StopCompleteInput) => assertValid(stopCompleteSchema, i);
export const validateStopSkip = (i: StopSkipInput) => assertValid(stopSkipSchema, i);
