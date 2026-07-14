export interface IUnitOfWork {
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  
  // Executes a block of code within a transaction scope
  execute<T>(work: () => Promise<T>): Promise<T>;
}
