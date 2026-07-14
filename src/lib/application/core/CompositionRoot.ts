import { CreateContactCommandHandler } from '../services/contacts/CreateContactCommandHandler';
import { MergeContactsCommandHandler } from '../services/contacts/MergeContactsCommandHandler';
import { CreateTaskCommandHandler } from '../services/tasks/CreateTaskCommandHandler';
import { SubmitExpenseCommandHandler } from '../services/expenses/SubmitExpenseCommandHandler';
import { DomainEventBus } from './DomainEventBus';
import { DomainEventBridge } from './DomainEventBridge';
import { IUnitOfWork } from './IUnitOfWork';

/**
 * Lightweight Dependency Injection Container
 * Ensures UI components resolve handlers without instantiating infrastructure.
 */
export class CompositionRoot {
  private static instance: CompositionRoot;
  
  public domainEventBus: DomainEventBus;
  public domainEventBridge: DomainEventBridge;
  
  // Handlers
  public createContactHandler: CreateContactCommandHandler;
  public mergeContactsHandler: MergeContactsCommandHandler;
  public createTaskHandler: CreateTaskCommandHandler;
  public submitExpenseHandler: SubmitExpenseCommandHandler;

  private constructor(
    private unitOfWork: IUnitOfWork,
    private runtimeEventBus: any,
    private repositories: any // Holds references to initialized repositories
  ) {
    this.domainEventBus = new DomainEventBus();
    this.domainEventBridge = new DomainEventBridge(this.domainEventBus, this.runtimeEventBus);

    // Explicit Constructor Injection
    this.createContactHandler = new CreateContactCommandHandler(
      this.repositories.contactRepository,
      this.domainEventBus,
      this.unitOfWork
    );

    this.mergeContactsHandler = new MergeContactsCommandHandler(
      this.repositories.contactRepository,
      this.domainEventBus,
      this.unitOfWork
    );

    this.createTaskHandler = new CreateTaskCommandHandler(
      this.repositories.taskRepository,
      this.domainEventBus,
      this.unitOfWork
    );

    this.submitExpenseHandler = new SubmitExpenseCommandHandler(
      this.repositories.expenseRepository,
      this.domainEventBus,
      this.unitOfWork
    );
  }

  public static initialize(unitOfWork: IUnitOfWork, runtimeEventBus: any, repositories: any) {
    if (this.instance) throw new Error('CompositionRoot already initialized');
    this.instance = new CompositionRoot(unitOfWork, runtimeEventBus, repositories);
  }

  public static getInstance(): CompositionRoot {
    if (!this.instance) throw new Error('CompositionRoot not initialized');
    return this.instance;
  }
}
