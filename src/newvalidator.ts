import Ajv2020 from "ajv/dist/2020";
import { Logger } from "@nestjs/common";
import { SchemaCompileException } from "./exceptions/plugin.exceptions";

export const ajv = new Ajv2020({ allErrors: true });

ajv.addKeyword("commands");
ajv.addKeyword("x-reporting");
ajv.addKeyword("x-buffering");
ajv.addKeyword("x-idempotency");

class PluginLogger extends Logger {
  override debug(message: string) {
    if (process.env.LOG_LEVEL === "debug") {
      super.debug(message);
    }
  }
}

const validatorCache = new Map<string, any>();
const commandValidatorCache = new Map<string, any>();

const MAX_CACHE_SIZE = 50;
const logger = new PluginLogger("ValidatorCache");

function getValidator(cacheKey: string, schema: object) {
  if (validatorCache.has(cacheKey)) {
    logger.debug(
      `[CACHE HIT] Found compiled schema for model version: ${cacheKey}`,
    );

    const validator = validatorCache.get(cacheKey);

    // LRU: move the accessed entry to the end of the Map.
    validatorCache.delete(cacheKey);
    validatorCache.set(cacheKey, validator);

    return validator;
  }

  if (validatorCache.size >= MAX_CACHE_SIZE) {
    const firstKey = validatorCache.keys().next().value;

    if (firstKey) {
      logger.warn(
        `[LRU EVICTION] Cache full! Automatically removing oldest schema: ${firstKey}`,
      );
      validatorCache.delete(firstKey);
    }
  }

  logger.log(
    `[CACHE MISS] Compiling new JSON schema for model version: ${cacheKey}`,
  );

  const validator = ajv.compile(schema);
  validatorCache.set(cacheKey, validator);

  return validator;
}

function getCommandValidator(
  cacheKey: string,
  command: string,
  payloadSchema: object,
) {
  const commandCacheKey = `${cacheKey}:${command}`;

  if (commandValidatorCache.has(commandCacheKey)) {
    logger.debug(
      `[COMMAND CACHE HIT] Found compiled command schema: ${commandCacheKey}`,
    );

    const validator = commandValidatorCache.get(commandCacheKey);

    // LRU: move the accessed entry to the end of the Map.
    commandValidatorCache.delete(commandCacheKey);
    commandValidatorCache.set(commandCacheKey, validator);

    return validator;
  }

  if (commandValidatorCache.size >= MAX_CACHE_SIZE) {
    const firstKey = commandValidatorCache.keys().next().value;

    if (firstKey) {
      logger.warn(
        `[COMMAND LRU EVICTION] Cache full! Automatically removing oldest command schema: ${firstKey}`,
      );
      commandValidatorCache.delete(firstKey);
    }
  }

  logger.log(
    `[COMMAND CACHE MISS] Compiling command payload schema: ${commandCacheKey}`,
  );

  const validator = ajv.compile(payloadSchema);
  commandValidatorCache.set(commandCacheKey, validator);

  return validator;
}

export function validateTelemetryPayload(
  expectedSchemaId: string,
  cacheKey: string,
  schema: any,
  message: any,
): {
  valid: boolean;
  errors: string[];
} {
  try {
    if (message.schemaId !== expectedSchemaId) {
      return {
        valid: false,
        errors: [
          `Schema ID mismatch: expected ${expectedSchemaId}, got ${message.schemaId}`,
        ],
      };
    }

    const validate = getValidator(cacheKey, schema);
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
    logger.error(
      `[VALIDATOR] Failed compiling schema ${cacheKey}: ${err.message}`,
    );
    throw new SchemaCompileException();
  }
}

export function validateAttributesPayload(
  cacheKey: string,
  schema: object,
  message: unknown,
): { valid: boolean; errors: string[] } {
  try {
    const validate = getValidator(
      `${cacheKey}:attributes`,
      schema,
    );

    const valid = validate(message);

    if (valid) {
      return { valid: true, errors: [] };
    }

    return {
      valid: false,
      errors:
        validate.errors?.map((error: any) => {
          const field = error.instancePath || "attributes";
          return `${field} ${error.message}`;
        }) ?? [],
    };
  } catch (error: any) {
    logger.error(
      `[VALIDATOR] Failed compiling attributes schema ${cacheKey}: ${error.message}`,
    );
    throw new SchemaCompileException();
  }
}

export function validateDeviceCommand(
  schema: any,
  command: string,
  payload: any,
  validatorCacheKey?: string,
): {
  valid: boolean;
  errors: string[];
} {
  const commandDefinition = schema?.commands?.[command];

  if (!commandDefinition) {
    return {
      valid: false,
      errors: [
        `Command '${command}' is not supported by this device model`,
      ],
    };
  }

  const payloadSchema = commandDefinition.payload;

  if (!payloadSchema) {
    return {
      valid: false,
      errors: [
        `Command '${command}' has no payload schema`,
      ],
    };
  }

  const cacheKey =
    validatorCacheKey ??
    `${
      schema?.properties?.schemaId?.const ?? "unknown-model"
    }:${JSON.stringify(payloadSchema)}`;

  const validate = getCommandValidator(
    cacheKey,
    command,
    payloadSchema,
  );

  const valid = validate(payload);

  if (valid) {
    return {
      valid: true,
      errors: [],
    };
  }

  return {
    valid: false,
    errors:
      validate.errors?.map(
        (err: any) =>
          `${err.instancePath || "payload"} ${err.message}`,
      ) ?? [],
  };
}

export function clearValidatorCache() {
  validatorCache.clear();
  commandValidatorCache.clear();
}
