import { Logger } from "@nestjs/common";
//const logger = new Logger("MappingNormalizer");
class PluginLogger extends Logger {
  override debug(message: string) {
    if (process.env.LOG_LEVEL === 'debug') {
      super.debug(message);
    }
  }
}
export const logger = new PluginLogger("MappingNormalizer");
export type MappingDefinition = {
  fields: Record<string,{path: string;}>;
};


function getValueByPath(obj: any, path: string) {
  ///dodato
  if (typeof path !== 'string') {
    return undefined;
  }
  return path.split(".").reduce((acc, key) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined;
    }
    if (acc === undefined || acc === null) {
      return undefined;
    }
    return acc[key];
  }, obj);
}


export function normalizeWithMapping(
  message: unknown,
  deviceId: string,
  mapping: MappingDefinition
) {
  if (!message || typeof message !== "object") {
    logger.warn(`[MAPPER] Normalization aborted for device ${deviceId}: Message is not a valid object.`);
    return null;
  }
  ///dodato
  if (!mapping || !mapping.fields) {
    logger.warn(`[MAPPER] Normalization aborted for device ${deviceId}: Invalid mapping definition.`);
    throw new Error(`[MAPPER] Invalid mapping definition for device ${deviceId}`);
   // return null;
  }

  const data: Record<string, unknown> = {};
  logger.debug(`[MAPPER] Starting data extraction for device: ${deviceId}`);

  for (const targetKey of Object.keys(mapping.fields)) {
    const { path } = mapping.fields[targetKey];

    const value = getValueByPath(message, path);

    if (value !== undefined) {
      data[targetKey] = value;
      logger.debug(`[MAPPER] Extracted: "${targetKey}" from path "${path}" -> Value: ${JSON.stringify(value)}`);
    }else {
      logger.debug(`[MAPPER] Missing field in payload: Path "${path}" for target key "${targetKey}" resolved to undefined.`);
    }
  }

  return {
    deviceId,
    timestamp: new Date().toISOString(),
    data,
    raw: message
  };
}