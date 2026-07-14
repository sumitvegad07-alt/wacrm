export type TimelineEventType = 'Activity' | 'Quote' | 'Order' | 'Call' | 'Meeting' | 'OpportunityCreated' | 'OpportunityWon';

export interface TimelineEvent {
  /** Uniquely identifies this event in the timeline */
  readonly id: string;
  
  /** The chronological sorting key */
  readonly timestamp: string;
  
  /** Generic categorization */
  readonly type: TimelineEventType;
  
  /** Human readable title/summary */
  readonly title: string;
  
  /** Detailed description or payload */
  readonly description: string;
  
  /** The source ID in the original module (e.g. quoteId, activityId) */
  readonly sourceEntityId: string;
}
