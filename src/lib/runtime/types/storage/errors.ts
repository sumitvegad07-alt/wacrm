/**
 * Base error for all storage-related failures.
 */
export class StorageError extends Error {
  public readonly code: string;
  public readonly isRecoverable: boolean;

  constructor(message: string, code: string, isRecoverable: boolean = false) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.isRecoverable = isRecoverable;
  }
}

export class TransactionError extends StorageError {
  constructor(message: string) {
    super(message, 'ERR_TRANSACTION_FAILED', false);
    this.name = 'TransactionError';
  }
}

export class MigrationError extends StorageError {
  constructor(message: string) {
    super(message, 'ERR_MIGRATION_FAILED', false);
    this.name = 'MigrationError';
  }
}

export class ValidationError extends StorageError {
  constructor(message: string) {
    super(message, 'ERR_VALIDATION_FAILED', false);
    this.name = 'ValidationError';
  }
}

export class ProviderError extends StorageError {
  constructor(message: string, isRecoverable = true) {
    super(message, 'ERR_PROVIDER_FAULT', isRecoverable);
    this.name = 'ProviderError';
  }
}

export class VersionMismatchError extends StorageError {
  constructor(expected: string, actual: string) {
    super(`Version mismatch. Expected ${expected}, got ${actual}`, 'ERR_VERSION_MISMATCH', false);
    this.name = 'VersionMismatchError';
  }
}

export class SchemaMismatchError extends StorageError {
  constructor(message: string) {
    super(message, 'ERR_SCHEMA_MISMATCH', false);
    this.name = 'SchemaMismatchError';
  }
}

export class CapabilityMissingError extends StorageError {
  constructor(capability: string) {
    super(`Required capability missing: ${capability}`, 'ERR_CAPABILITY_MISSING', false);
    this.name = 'CapabilityMissingError';
  }
}

export class InitializationFailureError extends StorageError {
  constructor(message: string) {
    super(message, 'ERR_INITIALIZATION_FAILED', true);
    this.name = 'InitializationFailureError';
  }
}

export class HealthFailureError extends StorageError {
  constructor(message: string) {
    super(message, 'ERR_HEALTH_CHECK_FAILED', true);
    this.name = 'HealthFailureError';
  }
}

export class RecoveryFailureError extends StorageError {
  constructor(message: string) {
    super(message, 'ERR_RECOVERY_FAILED', false);
    this.name = 'RecoveryFailureError';
  }
}
