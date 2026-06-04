import Ajv2020 from "ajv/dist/2020";
import fs from "fs";
import path from "path";

const ajv = new Ajv2020({ allErrors: true });

//  cache da ne kompilira svaki put
const validatorCache = new Map<string, any>();

function getSchemaPath(deviceId: string) {
  return path.join(process.cwd(), "schema", deviceId, "schema.json");
}

function getValidator(deviceId: string) {
  if (validatorCache.has(deviceId)) {
    return validatorCache.get(deviceId);
  }

  const schemaPath = getSchemaPath(deviceId);

  console.log("[SCHEMA] schema path:", schemaPath);


  if (!fs.existsSync(schemaPath)) {
    throw new Error(`[SCHEMA] Missing schema for device: ${deviceId}`);
  }

  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  const validator = ajv.compile(schema);

  validatorCache.set(deviceId, validator);

  return validator;
}

export function validateTelemetryPayload(
  deviceId: string,
  message: unknown
): {
  valid: boolean;
  errors: string[];
} {
  try {
    const validate = getValidator(deviceId);

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