export interface IDomainEvent {
  eventName: string;
  payload: any;
  timestamp: number;
}

export type DomainEventHandler = (event: IDomainEvent) => void | Promise<void>;

export class DomainEventBus {
  private handlers = new Map<string, DomainEventHandler[]>();

  public subscribe(eventName: string, handler: DomainEventHandler) {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, []);
    }
    this.handlers.get(eventName)!.push(handler);
  }

  public async publish(event: IDomainEvent) {
    const handlers = this.handlers.get(event.eventName) || [];
    for (const handler of handlers) {
      await handler(event);
    }
  }
}
