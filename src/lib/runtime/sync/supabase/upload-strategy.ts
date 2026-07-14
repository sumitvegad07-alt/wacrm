export interface UploadStrategyContext {
  table: string;
  payload: any;
  supabaseClient: any;
}

export interface IUploadStrategy {
  execute(context: UploadStrategyContext): Promise<void>;
}

export class UpsertStrategy implements IUploadStrategy {
  public async execute(context: UploadStrategyContext): Promise<void> {
    const { error } = await context.supabaseClient
      .from(context.table)
      .upsert(context.payload);
      
    if (error) throw error;
  }
}

export class DeleteStrategy implements IUploadStrategy {
  public async execute(context: UploadStrategyContext): Promise<void> {
    const { error } = await context.supabaseClient
      .from(context.table)
      .delete()
      .eq('id', context.payload.id);
      
    if (error) throw error;
  }
}
