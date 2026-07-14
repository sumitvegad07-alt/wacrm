export class SupabaseErrorMapper {
  /**
   * Translates raw PostgrestError into deterministic Runtime error structures.
   */
  public static mapError(error: any): { message: string, shouldRetry: boolean, isAuthError: boolean } {
    // JWT/Auth Errors
    if (error?.status === 401 || error?.code === 'PGRST301') {
      return { message: 'RuntimeAuthError: Session expired or invalid', shouldRetry: false, isAuthError: true };
    }

    // RLS / Permissions
    if (error?.code === '42501' || error?.status === 403) {
      return { message: 'RuntimePermissionError: Insufficient privileges (RLS)', shouldRetry: false, isAuthError: false };
    }

    // Unique Constraint / Conflict
    if (error?.code === '23505') {
      return { message: 'RuntimeConflictError: Record already exists', shouldRetry: false, isAuthError: false };
    }

    // Network / Timeout
    if (error?.message?.includes('fetch') || error?.code === 'ETIMEDOUT') {
      return { message: 'RuntimeNetworkError: Connection failed', shouldRetry: true, isAuthError: false };
    }

    // Default Fallback
    return { 
      message: `RuntimeUnknownError: ${error?.message || 'Unknown provider error'}`, 
      shouldRetry: true, 
      isAuthError: false 
    };
  }
}
