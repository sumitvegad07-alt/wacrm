export interface IAuthProvider {
  getTenantId(): string | null;
  getUserId(): string | null;
  getSessionId(): string | null;
  
  /**
   * Returns true if the user is currently authenticated
   */
  isAuthenticated(): boolean;
}
