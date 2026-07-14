export class ActivityStatusPolicy {
  public isValidTransition(currentStatus: string, newStatus: string): boolean {
    const validStatuses = ['Open', 'In Progress', 'Completed', 'Deferred', 'Cancelled'];
    return validStatuses.includes(newStatus);
  }

  public isTerminal(status: string): boolean {
    return status === 'Completed' || status === 'Cancelled';
  }
}
