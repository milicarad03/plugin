import { ConfigMissingException } from "./exceptions/plugin.exceptions";

export interface MappingFieldDefinition {
  path: string;
  historyPath?: string;
  operation?: 'array' | 'min' | 'max';
}

export interface MappingDefinition {
  fields: Record<string, MappingFieldDefinition>;
}

export interface NormalizedData {
  deviceId: string;
  timestamp: string;
  data: Record<string, any>;
  raw: any;
}

export const logger = {
  warn: (msg: string) => console.warn(msg),
  debug: (msg: string) => console.debug(msg),
};

/*
 * Pomoćna funkcija za bezbedno izvlačenje vrednosti iz objekta po dotted path-u
 */
function getValueByPath(obj: any, path: string): any {
  if (!obj || typeof path !== 'string' || !path.trim()) {
    return undefined;
  }

  const segments = path.split('.').filter(Boolean);
  let current = obj;

  for (const segment of segments) {
    if (
      segment === 'prototype' ||
      segment === 'constructor' ||
      segment === '__proto__'
    ) {
      return undefined;
    }

    if (current === null || current === undefined) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

/*
 * Pomoćna funkcija za izvlačenje čisto numeričkih vrednosti iz niza.
 * Rukuje i sa obično numeričkim nizovima [1, 2] i sa tuple nizovima [[val, timestamp], ...]
 */
function extractNumericValues(arr: unknown[]): number[] {
  return arr
    .filter((item) => item !== null && item !== undefined && item !== '')
    .map((item) => {
      // Ako je item ugnježdeni niz [value, timestamp], uzmi prvi element
      if (Array.isArray(item)) {
        return item.length > 0 ? Number(item[0]) : NaN;
      }
      return Number(item);
    })
    .filter((num) => !Number.isNaN(num));
}

export function normalizeWithMapping(
  message: any,
  deviceId: string,
  mapping: MappingDefinition,
): NormalizedData | null {
  if (!mapping || !mapping.fields) {
    logger.warn(`[MAPPER] Normalization aborted for device ${deviceId}: Invalid mapping definition.`);
    throw new ConfigMissingException();
  }

  if (!message || typeof message !== 'object') {
    logger.warn(`[MAPPER] Normalization aborted for device ${deviceId}: Invalid message payload.`);
    return null;
  }

  const data: Record<string, any> = {};

  for (const [targetKey, fieldDef] of Object.entries(mapping.fields)) {
    if (!fieldDef || typeof fieldDef.path !== 'string') {
      continue;
    }

    const rawVal = getValueByPath(message, fieldDef.path);

    if (rawVal === undefined) {
      continue;
    }

    const operation = fieldDef.operation;

    if (operation === 'min' || operation === 'max') {
      if (!Array.isArray(rawVal)) {
        continue;
      }

      const numericValues =
        extractNumericValues(rawVal);

      if (numericValues.length > 0) {
        data[targetKey] =
          operation === 'min'
            ? Math.min(...numericValues)
            : Math.max(...numericValues);
      }

      continue;
    } else if (operation === 'array') {
        if (Array.isArray(rawVal)) {
          data[targetKey] = rawVal;
        }
    } else {
      // Podrazumevano ponašanje (vraca ceo objekat/niz/primitivu)
      data[targetKey] = rawVal;
    }
  }
  console.log(
  'MAPPING RESULT',
  JSON.stringify(data, null, 2),
);

  return {
    deviceId,
    timestamp: new Date().toISOString(),
    data,
    raw: message,
  };
}