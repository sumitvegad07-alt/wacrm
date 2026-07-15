import { INetworkProvider, SyncOperationPayload } from '../network.provider';
import { IAuthProvider } from '../../interfaces/auth.provider';
import { createClient } from '../../../supabase/client';
import { EntityRegistry } from './entity.registry';
import { SyncRegistry } from './sync.registry';
import { UpsertStrategy, DeleteStrategy, IUploadStrategy } from './upload-strategy';
import { ContactRpcSyncAdapter, GenericTableScanAdapter, IEntitySyncAdapter } from './adapters/entity-sync-adapter';
import { SupabaseErrorMapper } from './error.mapper';
import { NetworkCapabilityRegistry } from './network-capability.registry';

export class SupabaseNetworkProvider implements INetworkProvider {
  private supabase = createClient();
  private authProvider: IAuthProvider | null = null;
  
  private uploadStrategies = new Map<string, IUploadStrategy>([
    ['upsert', new UpsertStrategy()],
    ['delete', new DeleteStrategy()]
  ]);

  private downloadAdapters = new Map<string, IEntitySyncAdapter>([
    ['contacts', new ContactRpcSyncAdapter()],
    ['gps_points', new GenericTableScanAdapter('location_pings')]
  ]);

  constructor() {
    NetworkCapabilityRegistry.register('SupportsBatchUpload');
    NetworkCapabilityRegistry.register('SupportsRPC');
  }

  public setAuthProvider(auth: IAuthProvider) {
    this.authProvider = auth;
  }

  private async ensureAuthenticated() {
    if (!this.authProvider) throw new Error('AuthProvider not injected');
    
    // As per CTO mandate, explicitly ask the auth provider for a valid session before ANY network request
    const token = await this.authProvider.getSessionId();
    if (!token) {
      throw new Error('RuntimeAuthError: No valid session available');
    }
  }

  public async uploadBatch(operations: SyncOperationPayload[]) {
    try {
      await this.ensureAuthenticated();
      
      const errors: any[] = [];
      
      for (const op of operations) {
        try {
          const config = EntityRegistry.getConfig(op.entityType);
          const strategyName = op.action === 'delete' ? 'delete' : config.uploadStrategy;
          const strategy = this.uploadStrategies.get(strategyName);
          
          if (!strategy) throw new Error(`Strategy ${strategyName} not found`);

          await strategy.execute({
            table: config.storageTable,
            payload: op.data,
            supabaseClient: this.supabase
          });
        } catch (rawError) {
          const mapped = SupabaseErrorMapper.mapError(rawError);
          // If it's a fatal error (like RLS), we flag it so the Runtime can DLQ it.
          // If auth expired mid-flight, we abort batch
          if (mapped.isAuthError) throw new Error(mapped.message);
          
          errors.push(new Error(mapped.message));
        }
      }

      return { success: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
    } catch (e) {
      return { success: false, errors: [e] };
    }
  }

  public async fetchDeltas(since: number) {
    await this.ensureAuthenticated();
    
    const activeEntities = SyncRegistry.getActiveEntities();
    let allDeltas: any[] = [];

    for (const entity of activeEntities) {
      const adapter = this.downloadAdapters.get(entity);
      if (!adapter) continue;

      try {
        const deltas = await adapter.fetchDeltas(since, this.supabase);
        allDeltas = allDeltas.concat(
          deltas.map(d => ({ entityType: entity, action: d.action, data: d.data }))
        );
      } catch (rawError) {
        const mapped = SupabaseErrorMapper.mapError(rawError);
        console.error(`[DeltaFetch] Failed for ${entity}:`, mapped.message);
      }
    }

    return allDeltas;
  }
}
