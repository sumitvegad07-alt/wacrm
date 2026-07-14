export interface HealthIndicators {
  /** Deterministic structural indicators. No AI/Magic scores. */
  
  readonly daysSinceLastInteraction: number;
  readonly hasOpenOpportunity: boolean;
  readonly hasRecentOrder: boolean;
  readonly activeQuoteCount: number;
  readonly activeOrderCount: number;
  
  readonly daysSinceCustomerCreation: number;
}
