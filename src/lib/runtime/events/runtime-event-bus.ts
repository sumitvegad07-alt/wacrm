/**
 * Barrel re-export for the RuntimeEventBus singleton and
 * repository-level event type constants used by the Application layer.
 *
 * The canonical implementation lives in
 *   runtime/services/runtime-event-bus.service.ts
 * This file exists so Application-layer modules can import from
 *   '../../runtime/events/runtime-event-bus'
 * without reaching into the services directory directly.
 */
export { RuntimeEventBus } from '../services/runtime-event-bus.service';

/**
 * String-enum of repository-level event types published via the
 * RuntimeEventBus when the DomainEventBridge translates domain events
 * into infrastructure events.
 */
export const REPOSITORY_EVENT = {
  ENTITY_CREATED: 'REPOSITORY_EVENT:ENTITY_CREATED',
  ENTITY_UPDATED: 'REPOSITORY_EVENT:ENTITY_UPDATED',
  ENTITY_DELETED: 'REPOSITORY_EVENT:ENTITY_DELETED',
} as const;

export type RepositoryEventType =
  (typeof REPOSITORY_EVENT)[keyof typeof REPOSITORY_EVENT];
