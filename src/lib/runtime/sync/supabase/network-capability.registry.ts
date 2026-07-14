export type NetworkCapability = 
  | 'SupportsBatchUpload'
  | 'SupportsRPC'
  | 'SupportsDeltaSync'
  | 'SupportsStreaming'
  | 'SupportsCompression'
  | 'SupportsStorage'
  | 'SupportsOfflineAuth';

export class NetworkCapabilityRegistry {
  private static capabilities = new Set<NetworkCapability>();

  public static register(capability: NetworkCapability) {
    this.capabilities.add(capability);
  }

  public static has(capability: NetworkCapability): boolean {
    return this.capabilities.has(capability);
  }

  public static reset() {
    this.capabilities.clear();
  }
}
