import { RuntimeEvent } from '../types/events';

type EventHandler<T extends RuntimeEvent = RuntimeEvent> = (event: T) => void;

class RuntimeEventBusService {
  private static instance: RuntimeEventBusService;
  private listeners: Map<string, Set<EventHandler<any>>> = new Map();

  private constructor() {}

  public static getInstance(): RuntimeEventBusService {
    if (!RuntimeEventBusService.instance) {
      RuntimeEventBusService.instance = new RuntimeEventBusService();
    }
    return RuntimeEventBusService.instance;
  }

  public subscribe<T extends RuntimeEvent>(eventType: T['type'], handler: EventHandler<T>): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.listeners.get(eventType)?.delete(handler);
    };
  }

  public publish(event: RuntimeEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error(`Error in event handler for ${event.type}:`, error);
        }
      });
    }
  }

  public clearAllListeners(): void {
    this.listeners.clear();
  }
}

export const RuntimeEventBus = RuntimeEventBusService.getInstance();
