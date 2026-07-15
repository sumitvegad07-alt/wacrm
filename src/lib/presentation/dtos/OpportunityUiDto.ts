import { Opportunity } from '../../domain/entities/Opportunity';
import { WeightedForecast } from '../../domain/value-objects/WeightedForecast';

export type SyncBadgeState = 'pending' | 'uploading' | 'synced' | 'failed' | 'conflict';

export class OpportunityUiDto {
  public readonly id: string;
  public readonly formattedName: string;
  public readonly stageBadge: string;
  public readonly weightedForecastDisplay: string;
  public readonly closeDateDisplay: string;
  public readonly syncBadge: SyncBadgeState;
  
  constructor(entity: Opportunity) {
    this.id = entity.id;
    this.formattedName = entity.name;
    this.stageBadge = entity.stageId.toUpperCase();
    
    const forecast = new WeightedForecast(entity.forecastAmount, entity.probability, entity.currency);
    this.weightedForecastDisplay = forecast.getFormatted();
    
    this.closeDateDisplay = entity.expectedCloseDate 
      ? new Date(entity.expectedCloseDate).toLocaleDateString() 
      : 'No close date';
      
    if (entity.sync_status === 'pending') {
      this.syncBadge = 'pending';
    } else if (entity.sync_status === 'error') {
      this.syncBadge = 'failed';
    } else if (entity.sync_status === 'conflict') {
      this.syncBadge = 'conflict';
    } else {
      this.syncBadge = 'synced';
    }
  }
}
