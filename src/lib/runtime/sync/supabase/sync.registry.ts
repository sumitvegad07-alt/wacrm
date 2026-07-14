import { EntityRegistry } from './entity.registry';

export class SyncRegistry {
  private static activeEntities = new Set<string>();

  public static enableSync(entityType: string) {
    // Validates that the entity is known
    EntityRegistry.getConfig(entityType);
    this.activeEntities.add(entityType);
  }

  public static disableSync(entityType: string) {
    this.activeEntities.delete(entityType);
  }

  public static getActiveEntities(): string[] {
    return Array.from(this.activeEntities);
  }
}

// Default activations
SyncRegistry.enableSync('contacts');
SyncRegistry.enableSync('gps_points');
