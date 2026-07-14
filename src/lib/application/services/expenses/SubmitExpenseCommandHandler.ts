import { ICommand, ICommandHandler } from '../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../core/ApplicationResult';
import { IUnitOfWork } from '../../core/IUnitOfWork';
import { DomainEventBus } from '../../core/DomainEventBus';
import { PolicyEvaluator, CanCreateExpensePolicy, PolicyContext } from '../../policies';

export class SubmitExpenseCommand implements ICommand {
  constructor(
    public readonly expenseId: string,
    public readonly userId: string,
    public readonly tenantId: string
  ) {}
}

export class SubmitExpenseCommandHandler implements ICommandHandler<SubmitExpenseCommand, void> {
  constructor(
    private readonly expenseRepository: any, // Injected via DI
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: SubmitExpenseCommand): Promise<ApplicationResult<void>> {
    try {
      // 1. Authorization Policies
      const context: PolicyContext = { userId: command.userId, tenantId: command.tenantId };
      await PolicyEvaluator.evaluateOrThrow(new CanCreateExpensePolicy(), context);

      // 2. Transaction Boundaries
      return await this.unitOfWork.execute(async () => {
        
        // 3. Business Validation against Repository State
        /*
        const expense = await this.expenseRepository.findById(command.expenseId);
        if (!expense) throw new Error("Expense not found");
        
        if (expense.amount > 1000 && expense.attachments.length === 0) {
          return ApplicationResult.failure(new ApplicationError('VALIDATION_ERROR', 'Expenses over $1000 require attachments'));
        }
        
        expense.status = 'submitted';
        await this.expenseRepository.update(expense);
        */

        // 4. Domain Event Publishing
        await this.domainEventBus.publish({
          eventName: 'ExpenseSubmitted',
          payload: { id: command.expenseId, submittedBy: command.userId },
          timestamp: Date.now()
        });

        return ApplicationResult.success();
      });
    } catch (error: any) {
      if (error instanceof ApplicationError) return ApplicationResult.failure(error);
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', error.message));
    }
  }
}
