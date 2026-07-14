import { ApplicationResult, ApplicationError } from '../core/ApplicationResult';

export interface IAuthorizationPolicy<TContext> {
  evaluate(context: TContext): Promise<boolean>;
}

export class PolicyEvaluator {
  public static async evaluateOrThrow<T>(
    policy: IAuthorizationPolicy<T>, 
    context: T
  ): Promise<void> {
    const isAuthorized = await policy.evaluate(context);
    if (!isAuthorized) {
      throw new ApplicationError(
        'UNAUTHORIZED', 
        `User is not authorized to perform this action based on policy: ${policy.constructor.name}`
      );
    }
  }
}

// Example Context for Policies
export interface PolicyContext {
  userId: string;
  tenantId: string;
  resourceId?: string;
}

// Concrete Example Policy
export class CanCreateExpensePolicy implements IAuthorizationPolicy<PolicyContext> {
  public async evaluate(context: PolicyContext): Promise<boolean> {
    // In the future this checks RBAC, territory logic, etc.
    // For now, if they have a userId they can create an expense.
    return !!context.userId;
  }
}
