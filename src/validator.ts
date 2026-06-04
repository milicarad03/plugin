import Ajv2020 from 'ajv/dist/2020';
import telemetryMessageSchema from './device2.schema.json';

const ajv = new Ajv2020({ allErrors: true });

const validateTelemetryMessage = ajv.compile(telemetryMessageSchema);

export function validateTelemetryPayload(message: unknown): {
  valid: boolean;
  errors: string[];
} {
  const valid = validateTelemetryMessage(message);

  if (valid) {
    return {
      valid: true,
      errors: [],
    };
  }

  return {
    valid: false,
    errors:
      validateTelemetryMessage.errors?.map((err) => {
        const field = err.instancePath || 'root';
        return `${field} ${err.message}`;
      }) ?? [],
  };
}