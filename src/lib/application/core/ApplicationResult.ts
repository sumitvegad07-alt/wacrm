export class ApplicationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export class ApplicationResult<T = void> {
  private constructor(
    public readonly isSuccess: boolean,
    public readonly value?: T,
    public readonly error?: ApplicationError
  ) {}

  public static success<T>(value?: T): ApplicationResult<T> {
    return new ApplicationResult<T>(true, value, undefined);
  }

  public static failure<T = void>(error: ApplicationError): ApplicationResult<T> {
    return new ApplicationResult<T>(false, undefined, error);
  }

  public getErrorOrThrow(): ApplicationError {
    if (this.isSuccess || !this.error) throw new Error("Attempted to get error on successful result");
    return this.error;
  }
}
