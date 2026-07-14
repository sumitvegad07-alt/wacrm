export interface EntityConfig {
  runtimeEntityType: string;
  storageTable: string;
  primaryKey: string;
  uploadStrategy: 'upsert' | 'rpc' | 'attachment';
  downloadStrategy: 'table_scan' | 'rpc' | 'view';
}

export class EntityRegistry {
  private static registry = new Map<string, EntityConfig>();

  public static register(config: EntityConfig) {
    this.registry.set(config.runtimeEntityType, config);
  }

  public static getConfig(entityType: string): EntityConfig {
    const config = this.registry.get(entityType);
    if (!config) {
      throw new Error(`[EntityRegistry] Entity type '${entityType}' is not registered.`);
    }
    return config;
  }
}

// Pre-registering system defaults
EntityRegistry.register({
  runtimeEntityType: 'contacts',
  storageTable: 'contacts',
  primaryKey: 'id',
  uploadStrategy: 'upsert',
  downloadStrategy: 'rpc'
});
EntityRegistry.register({
  runtimeEntityType: 'gps_points',
  storageTable: 'location_pings',
  primaryKey: 'id',
  uploadStrategy: 'rpc',
  downloadStrategy: 'table_scan'
});
