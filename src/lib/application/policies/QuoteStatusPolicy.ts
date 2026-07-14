export class QuoteStatusPolicy {
  public isValidTransition(currentStatus: string, newStatus: string): boolean {
    const validStatuses = ['Draft', 'Pending Approval', 'Approved', 'Accepted', 'Rejected', 'Expired'];
    
    // Simplistic check for existence. More complex DAG transitions can be added here.
    return validStatuses.includes(newStatus);
  }

  public requiresApproval(subtotal: number, discountTotal: number): boolean {
    // Example rule: requires approval if discount > $10k
    return discountTotal > 10000;
  }
}
