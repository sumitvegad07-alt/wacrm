import { ApplicationResult } from './ApplicationResult';

export interface ICommand {
  // Marker interface
}

export interface IQuery {
  // Marker interface
}

export interface ICommandHandler<TCommand extends ICommand, TResult = void> {
  execute(command: TCommand): Promise<ApplicationResult<TResult>>;
}

export interface IQueryHandler<TQuery extends IQuery, TResult> {
  execute(query: TQuery): Promise<ApplicationResult<TResult>>;
}
