import { DomainEventBus } from './DomainEventBus';
import { RuntimeEventBus, REPOSITORY_EVENT } from '../../runtime/events/runtime-event-bus';

export class DomainEventBridge {
  constructor(
    private readonly domainBus: DomainEventBus,
    private readonly runtimeBus: typeof RuntimeEventBus
  ) {
    this.initialize();
  }

  private initialize() {
    // Bridges business events into infrastructure events when applicable.
    // This allows the Application Layer to remain oblivious to the Sync Engine.
    
    this.domainBus.subscribe('ContactCreated', async (event) => {
      this.runtimeBus.publish({
        type: REPOSITORY_EVENT.ENTITY_CREATED,
        payload: {
          entityType: 'contacts',
          entityId: event.payload.id,
          data: event.payload,
          timestamp: event.timestamp
        }
      });
    });

    this.domainBus.subscribe('ContactUpdated', async (event) => {
      this.runtimeBus.publish({
        type: REPOSITORY_EVENT.ENTITY_UPDATED,
        payload: {
          entityType: 'contacts',
          entityId: event.payload.id,
          data: event.payload,
          timestamp: event.timestamp
        }
      });
    });

    this.domainBus.subscribe('ContactDeleted', async (event) => {
      this.runtimeBus.publish({
        type: REPOSITORY_EVENT.ENTITY_DELETED,
        payload: {
          entityType: 'contacts',
          entityId: event.payload.id,
          data: event.payload,
          timestamp: event.timestamp
        }
      });
    });
    
    // Additional domain events mapped here...
  }
}
