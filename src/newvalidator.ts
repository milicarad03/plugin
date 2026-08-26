import Ajv2020 from "ajv/dist/2020";
import { Logger } from "@nestjs/common";
import { PluginErrorCode } from "./device-registry.interface";
import { ConfigMissingException, SchemaCompileException } from "./exceptions/plugin.exceptions";

export const ajv = new Ajv2020({ allErrors: true });
ajv.addKeyword("commands");
ajv.addKeyword("x-reporting");
ajv.addKeyword("x-buffering");
class PluginLogger extends Logger {
  override debug(message: string) {
    if (process.env.LOG_LEVEL === 'debug') {
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
    logger.debug(`[CACHE HIT] Found compiled schema for model version: ${cacheKey}`);
    
    const validator = validatorCache.get(cacheKey);
  
    validatorCache.delete(cacheKey);
    validatorCache.set(cacheKey, validator); 
    
    return validator;
  }

  
  if (validatorCache.size >= MAX_CACHE_SIZE) {
    const firstKey = validatorCache.keys().next().value; 
    if (firstKey) {
      logger.warn(`[LRU EVICTION] Cache full! Automatically removing oldest schema: ${firstKey}`);
      validatorCache.delete(firstKey);
    }
  }

  
  logger.log(`[CACHE MISS] Compiling new JSON schema for model version: ${cacheKey}`);
  const validator = ajv.compile(schema);
  validatorCache.set(cacheKey, validator);

  return validator;
}

export function validateTelemetryPayload(   expectedSchemaId: string, cacheKey: string, schema: any, message: any): {
  valid: boolean;
  errors: string[];
} {
  try {
    if (message.schemaId !== expectedSchemaId) {
      return {
        valid: false,
        errors: [
          `Schema ID mismatch: expected ${expectedSchemaId}, got ${message.schemaId}`
        ]
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

    logger.error(`[VALIDATOR] Failed compiling schema ${cacheKey}: ${err.message}` );
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
          const field = error.instancePath || 'attributes';
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

export function validateDeviceCommand( schema: any, command: string, payload: any): { valid: boolean; errors: string[]; } {

  const commandDefinition = schema?.commands?.[command];

  if (!commandDefinition) {
    return {
      valid: false,
      errors: [ `Command '${command}' is not supported by this device model` ]
    };
  }

  const payloadSchema = commandDefinition.payload;

  if (!payloadSchema) {
    return {
      valid: false,
      errors: [`Command '${command}' has no payload schema`]
    };
  }

  const validate = ajv.compile(payloadSchema);

  const valid = validate(payload);

  if (valid) {
    return {
      valid: true,
      errors: []
    };
  }

  return {
    valid: false,
    errors:
      validate.errors?.map( err =>`${err.instancePath || "payload"} ${err.message}` ) ?? []
  };
}
export function clearValidatorCache() {
  validatorCache.clear();
}