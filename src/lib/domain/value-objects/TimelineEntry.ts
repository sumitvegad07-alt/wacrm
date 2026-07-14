import { ActivityType } from '../entities/Activity';

export class TimelineEntry {
  constructor(
    public readonly id: string,
    public readonly timestamp: Date,
    public readonly type: ActivityType | 'SystemEvent',
    public readonly title: string,
    public readonly description: string,
    public readonly icon: string
  ) {}
}
