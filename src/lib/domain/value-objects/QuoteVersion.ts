export class QuoteVersion {
  constructor(public readonly versionNumber: number) {
    if (versionNumber < 1) {
      throw new Error("Version number must be at least 1");
    }
  }

  public getDisplayString(): string {
    return \`V\${this.versionNumber}\`;
  }

  public getNextVersion(): QuoteVersion {
    return new QuoteVersion(this.versionNumber + 1);
  }
}
