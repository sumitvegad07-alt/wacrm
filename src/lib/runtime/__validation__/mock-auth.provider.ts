import { IAuthProvider } from '../interfaces/auth.provider';

export class MockAuthProvider implements IAuthProvider {
  private tenantId: string = 'tenant-1';
  private userId: string = 'user-1';

  public setTenantId(id: string) { this.tenantId = id; }
  public setUserId(id: string) { this.userId = id; }

  getTenantId(): string | null { return this.tenantId; }
  getUserId(): string | null { return this.userId; }
  getSessionId(): string | null { return 'sess-123'; }
  isAuthenticated(): boolean { return true; }
}
