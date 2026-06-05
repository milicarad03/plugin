import Ajv2020 from "ajv/dist/2020";

const ajv = new Ajv2020({ allErrors: true });

// cache po schema objektu
const validatorCache = new WeakMap<object, any>();

function getValidator(schema: object) {
  if (validatorCache.has(schema)) {
    return validatorCache.get(schema);
  }

  const validator = ajv.compile(schema);
  validatorCache.set(schema, validator);

  return validator;
}

export function validateTelemetryPayload(
  schema: any,
  message: unknown
): {
  valid: boolean;
  errors: string[];
} {
  try {
    const validate = getValidator(schema);

    const valid = validate(message);

    if (valid) {
      return { valid: true, errors: [] };
    }

    return {
      valid: false,
      errors:
        validate.errors?.map((err: any) => {
          const field = err.instancePath || "root";
          return `${field} ${err.message}`;
        }) ?? [],
    };
  } catch (err: any) {
    return {
      valid: false,
      errors: [err.message],
    };
  }
}