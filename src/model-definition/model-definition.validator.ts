import Ajv2020 from 'ajv/dist/2020';

export interface ModelDefinitionValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function resolveSchemaPath(schema: any, dottedPath: string): boolean {
  if (typeof dottedPath !== 'string' || !dottedPath.trim()) {
    return false;
  }

  const segments = dottedPath.split('.').filter(Boolean);

  let current = schema;

  for (const segment of segments) {
    if (current?.properties?.[segment]) {
      current = current.properties[segment];
      continue;
    }

    if (
      current?.type === 'array' &&
      current?.items?.properties?.[segment]
    ) {
      current = current.items.properties[segment];
      continue;
    }

    return false;
  }

  return true;
}

function validateCustomKeywords(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateCustomKeywords(item, `${path}[${index}]`, errors);
    });
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (key === 'x-reporting') {
      if (!isRecord(child)) {
        errors.push(`X_REPORTING_INVALID: '${path}.${key}' must be an object`);
      } else {
        const allowedStates = new Set(['ACTIVE', 'IDLE']);
        if (Object.keys(child).length === 0) {
          errors.push(`X_REPORTING_EMPTY: '${path}.${key}'`);
        }

        for (const [state, interval] of Object.entries(child)) {
          if (!allowedStates.has(state)) {
            errors.push(`X_REPORTING_STATE_INVALID: '${path}.${key}.${state}'`);
            continue;
          }
          if (
            interval !== null &&
            (typeof interval !== 'number' || !Number.isFinite(interval) || interval <= 0)
          ) {
            errors.push(
              `X_REPORTING_INTERVAL_INVALID: '${path}.${key}.${state}' must be a positive number or null`,
            );
          }
        }
      }
    }

    if (key === 'x-buffering') {
      if (!isRecord(child)) {
        errors.push(`X_BUFFERING_INVALID: '${path}.${key}' must be an object`);
      } else {
        const interval = child.interval;

        if (
          typeof interval !== 'number' ||
          !Number.isFinite(interval) ||
          interval <= 0
        ) {
          errors.push(
            `X_BUFFERING_INTERVAL_INVALID: '${path}.${key}.interval' must be a positive number`,
          );
        }

        for (const childKey of Object.keys(child)) {
          if (childKey !== 'interval') {
            errors.push(`X_BUFFERING_PROPERTY_INVALID: '${path}.${key}.${childKey}'`);
          }
        }
      }
    }

    validateCustomKeywords(child, `${path}.${key}`, errors);
  }
}

export function validateModelDefinition(
  expectedModelId: string,
  schema: unknown,
  mapping: unknown,
): ModelDefinitionValidationResult {
  const errors: string[] = [];

  if (!isRecord(schema)) {
    return {
      valid: false,
      errors: ['SCHEMA_MUST_BE_JSON_OBJECT'],
    };
  }

  if (!isRecord(mapping)) {
    return {
      valid: false,
      errors: ['MAPPING_MUST_BE_JSON_OBJECT'],
    };
  }

  try {
    const ajv = new Ajv2020({ allErrors: true });

    ajv.addKeyword('commands');
    ajv.addKeyword('x-reporting');
    ajv.addKeyword('x-buffering');

    ajv.compile(schema);
  } catch (error: any) {
    errors.push(
      `INVALID_JSON_SCHEMA: ${error?.message ?? 'Schema compilation failed'}`,
    );
  }

  validateCustomKeywords(schema, 'schema', errors);

  const schemaId = schema?.properties?.schemaId?.const;

  if (typeof schemaId !== 'string') {
    errors.push('SCHEMA_ID_CONST_MISSING');
  } else if (schemaId !== expectedModelId) {
    errors.push(
      `SCHEMA_MODEL_MISMATCH: expected '${expectedModelId}', got '${schemaId}'`,
    );
  }

  const rootRequired = Array.isArray(schema.required) ? schema.required : [];

  if (!rootRequired.includes('schemaId')) {
    errors.push('SCHEMA_ID_MUST_BE_REQUIRED');
  }

  if (!isRecord(mapping.fields) || Object.keys(mapping.fields).length === 0) {
    errors.push('MAPPING_FIELDS_MISSING');

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  for (const [targetKey, definition] of Object.entries(mapping.fields)) {
    if (!isRecord(definition)) {
      errors.push(`MAPPING_FIELD_INVALID: '${targetKey}'`);
      continue;
    }

    const path = definition.path;

    if (typeof path !== 'string' || !path.trim()) {
      errors.push(`MAPPING_PATH_MISSING: '${targetKey}'`);
      continue;
    }

    if (!resolveSchemaPath(schema, path)) {
      errors.push(`MAPPING_PATH_NOT_IN_SCHEMA: '${targetKey}' -> '${path}'`);
    }

    const historyPath = definition.historyPath;

    if (historyPath !== undefined) {
      if (typeof historyPath !== 'string' || !historyPath.trim()) {
        errors.push(`HISTORY_PATH_INVALID: '${targetKey}'`);
      } else if (!resolveSchemaPath(schema, historyPath)) {
        errors.push(`HISTORY_PATH_NOT_IN_SCHEMA: '${targetKey}' -> '${historyPath}'`);
      }
    }

    const operation = definition.operation;
    if (operation !== undefined) {
      const allowedOperations = new Set(['array', 'min', 'max']);
      if (typeof operation !== 'string' || !allowedOperations.has(operation)) {
        errors.push(
          `MAPPING_OPERATION_INVALID: '${targetKey}' has invalid operation '${operation}'`,
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}