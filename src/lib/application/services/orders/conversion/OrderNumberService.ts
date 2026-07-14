export class OrderNumberService {
  /**
   * Dedicated policy to generate unique sequential numbers.
   * Isolates numbering logic from the conversion engine.
   */
  public async generateNextOrderNumber(): Promise<string> {
    // In a real system, this would query a sequence generator or database counter
    const timestamp = Date.now().toString().slice(-6);
    return \`ORD-2026-\${timestamp}\`;
  }
}
