import { ContactRoleConfiguration } from './ContactRoleConfiguration';
import { ApplicationError } from '../core/ApplicationResult';

export class ContactRolePolicy {
  constructor(private readonly config: ContactRoleConfiguration) {}

  public validateRole(roleId: string, isPrimary: boolean): void {
    const role = this.config.roles.find(r => r.id === roleId);
    
    if (!role) {
      throw new ApplicationError('VALIDATION_ERROR', `Contact Role '${roleId}' is not configured for this tenant.`);
    }

    if (isPrimary && !role.canBePrimary) {
      throw new ApplicationError('VALIDATION_ERROR', `The role '${role.name}' cannot be used as a Primary Account designation.`);
    }
  }
}
