export class WeightedForecast {
  private readonly value: number;

  constructor(
    public readonly amount: number,
    public readonly probability: number,
    public readonly currency: string = 'USD'
  ) {
    if (probability < 0 || probability > 100) {
      throw new Error("Probability must be between 0 and 100");
    }
    this.value = (amount * probability) / 100;
  }

  public getValue(): number {
    return this.value;
  }

  public getFormatted(): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: this.currency,
      maximumFractionDigits: 0
    }).format(this.value);
  }
}
