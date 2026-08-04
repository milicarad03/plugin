export class DeviceNotFoundException extends Error {
  constructor(deviceId: string) {
    super(`Device ${deviceId} not found`);
    this.name = 'DeviceNotFoundException';
  }
}

export class DeviceOfflineException extends Error {
  constructor(deviceId: string) {
    super(`Device ${deviceId} is offline`);
    this.name = 'DeviceOfflineException';
  }
}

export class DeviceUninitializedException extends Error {
  constructor(deviceId: string) {
    super(`Device ${deviceId} is uninitialized`);
    this.name = 'DeviceUninitializedException';
  }
}

export class ConfigMissingException extends Error {
  constructor() {
    super('Plugin configuration missing');
    this.name = 'ConfigMissingException';
  }
}

export class ConfigMismatchException extends Error {
  constructor() {
    super('Schema and model version mismatch');
    this.name = 'ConfigMismatchException';
  }
}

export class NormalizationFailedException extends Error {
  constructor() {
    super('Telemetry normalization failed');
    this.name = 'NormalizationFailedException';
  }
}

export class HookFailedException extends Error {
  constructor() {
    super('Plugin hook failed');
    this.name = 'HookFailedException';
  }
}

export class InvalidTimestampException extends Error {
  constructor() {
    super('Invalid timestamp');
    this.name = 'InvalidTimestampException';
  }
}

export class SchemaCompileException extends Error {
  constructor() {
    super('Schema compilation failed');
    this.name = 'SchemaCompileException';
  }
}
export class DeviceSchemaMissingException extends Error {
  constructor(deviceId: string) {
    super(`Device ${deviceId} has no schema`);
    this.name = 'DeviceSchemaMissingException';
  }
}
export class DatabaseFailureException extends Error {
  constructor(message?: string) {
    super(message ?? "Database failure");
    this.name = "DatabaseFailureException";
  }
}
export class CommandValidationException extends Error {
  constructor(errors: string[]) {
    super(errors.join(", "));
    this.name = "CommandValidationException";
  }
}
