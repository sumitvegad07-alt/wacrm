export interface PipelineStageConfig {
  id: string;
  name: string;
  defaultProbability: number;
  order: number;
}

export interface PipelineConfig {
  id: string;
  name: string;
  stages: PipelineStageConfig[];
}

export const defaultPipelineConfig: PipelineConfig = {
  id: 'standard-sales',
  name: 'Standard Sales Pipeline',
  stages: [
    { id: 'discovery', name: 'Discovery', defaultProbability: 10, order: 1 },
    { id: 'qualified', name: 'Qualified', defaultProbability: 25, order: 2 },
    { id: 'proposal', name: 'Proposal', defaultProbability: 50, order: 3 },
    { id: 'negotiation', name: 'Negotiation', defaultProbability: 80, order: 4 },
    { id: 'closed-won', name: 'Closed Won', defaultProbability: 100, order: 5 },
    { id: 'closed-lost', name: 'Closed Lost', defaultProbability: 0, order: 6 }
  ]
};
