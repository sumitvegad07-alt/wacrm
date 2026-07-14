import { PipelineConfig, PipelineStageConfig } from './PipelineConfiguration';
import { ApplicationError } from '../core/ApplicationResult';

export class PipelinePolicy {
  constructor(private readonly config: PipelineConfig) {}

  public getStage(stageId: string): PipelineStageConfig {
    const stage = this.config.stages.find(s => s.id === stageId);
    if (!stage) {
      throw new ApplicationError('VALIDATION_ERROR', \`Stage '\${stageId}' does not exist in pipeline '\${this.config.name}'.\`);
    }
    return stage;
  }

  public validateTransition(currentStageId: string, newStageId: string): void {
    const current = this.getStage(currentStageId);
    const next = this.getStage(newStageId);

    // Business Rule: Cannot skip straight from early stages to closed won without proposal/negotiation
    if (next.id === 'closed-won' && current.order < 3) {
      throw new ApplicationError('POLICY_VIOLATION', 'Cannot move directly to Closed Won without submitting a Proposal.');
    }
  }

  public getDefaultProbability(stageId: string): number {
    return this.getStage(stageId).defaultProbability;
  }
}
