export interface IEntitySyncAdapter {
  fetchDeltas(since: number, supabaseClient: any): Promise<{ action: 'insert'|'update'|'delete', data: any }[]>;
}

export class ContactRpcSyncAdapter implements IEntitySyncAdapter {
  public async fetchDeltas(since: number, supabaseClient: any) {
    // Uses a specialized PostgreSQL RPC function optimized for fetching deltas
    const { data, error } = await supabaseClient.rpc('sync_contacts_delta', { since_epoch: since });
    if (error) throw error;
    
    return (data || []).map((row: any) => ({
      action: row.deleted_at ? 'delete' : 'upsert',
      data: row
    }));
  }
}

export class GenericTableScanAdapter implements IEntitySyncAdapter {
  constructor(private tableName: string) {}

  public async fetchDeltas(since: number, supabaseClient: any) {
    const { data, error } = await supabaseClient
      .from(this.tableName)
      .select('*')
      .gt('updated_at', new Date(since).toISOString());
      
    if (error) throw error;

    return (data || []).map((row: any) => ({
      action: row.deleted_at ? 'delete' : 'upsert',
      data: row
    }));
  }
}
