import { 
  StorageError, 
  ProviderError, 
  TransactionError, 
  ValidationError, 
  InitializationFailureError 
} from '../../types/storage/errors';

export class WatermelonErrorMapper {
  /**
   * Catches raw exceptions thrown by WatermelonDB or LokiJS and
   * translates them into our standard Error Hierarchy.
   */
  public static mapError(error: any): StorageError {
    if (error instanceof StorageError) {
      return error; // Already mapped
    }

    const message = error?.message || 'Unknown Storage Error';

    if (message.includes('transaction')) {
      return new TransactionError(message);
    }
    
    if (message.includes('UNIQUE constraint failed') || message.includes('already exists')) {
      return new ValidationError(`Record already exists or fails unique constraint: ${message}`);
    }
    
    if (message.includes('NOT NULL constraint')) {
      return new ValidationError(`Missing required field: ${message}`);
    }

    if (message.includes('database is locked') || message.includes('busy')) {
      return new ProviderError(`Database lock timeout: ${message}`, true); // Recoverable via retry
    }

    if (message.includes('initialize') || message.includes('connect')) {
      return new InitializationFailureError(`Failed to boot WatermelonDB: ${message}`);
    }

    // Default fallback
    return new ProviderError(message, false);
  }
}
