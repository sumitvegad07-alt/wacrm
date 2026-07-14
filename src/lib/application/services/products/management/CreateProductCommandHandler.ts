import { ICommand, ICommandHandler } from '../../../core/CqrsInterfaces';
import { ApplicationResult, ApplicationError } from '../../../core/ApplicationResult';
import { IUnitOfWork } from '../../../core/IUnitOfWork';
import { DomainEventBus } from '../../../core/DomainEventBus';
import { ProductRepository } from '../../../../repositories/implementations/product.repository';
import { ProductType } from '../../../../domain/entities/Product';

export class CreateProductCommand implements ICommand {
  constructor(
    public readonly id: string,
    public readonly sku: string,
    public readonly name: string,
    public readonly type: ProductType
  ) {}
}

export class CreateProductCommandHandler implements ICommandHandler<CreateProductCommand, string> {
  constructor(
    private readonly repository: ProductRepository,
    private readonly domainEventBus: DomainEventBus,
    private readonly unitOfWork: IUnitOfWork
  ) {}

  public async execute(command: CreateProductCommand): Promise<ApplicationResult<string>> {
    try {
      const skuExists = await this.repository.skuExists(command.sku);
      if (skuExists) throw new ApplicationError('VALIDATION_ERROR', 'SKU must be unique.');

      return await this.unitOfWork.execute(async () => {
        const product = {
          id: command.id,
          sku: command.sku,
          name: command.name,
          type: command.type,
          status: 'Draft' as const,
          sync_status: 'pending' as const,
          sync_version: 1
        };

        await this.repository.create(product);

        await this.domainEventBus.publish({
          eventName: 'ProductCreated',
          payload: product,
          timestamp: Date.now()
        });

        return ApplicationResult.success(command.id);
      });
    } catch (e: any) {
      if (e instanceof ApplicationError) return ApplicationResult.failure(e);
      return ApplicationResult.failure(new ApplicationError('SYSTEM_ERROR', e.message));
    }
  }
}
