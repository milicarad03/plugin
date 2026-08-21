import { validateModelDefinition } from "src/model-definition/model-definition.validator";

describe('validateModelDefinition', () => {
  const validSchema = {
    type: 'object',
    required: ['schemaId'],
    properties: {
      schemaId: {
        type: 'string',
        const: 'smartPumpModel',
      },
      metrics: {
        type: 'object',
        properties: {
          flowRate: {
            type: 'number',
            'x-reporting': {
              ACTIVE: 5000,
              IDLE: null,
            },
          },
        },
      },
      historicalTelemetry: {
        type: 'object',
        properties: {
          flowRate: {
            type: 'array',
            'x-buffering': {
              interval: 10000,
            },
            items: {
              type: 'object',
              properties: {
                val: { type: 'number' },
              },
            },
          },
        },
      },
    },
  };

  const validMapping = {
    fields: {
      flowRate: {
        path: 'metrics.flowRate',
        historyPath: 'historicalTelemetry.flowRate',
        operation: 'min',
      },
    },
  };

  it('should validate a correct schema and mapping definition', () => {
    const result = validateModelDefinition('smartPumpModel', validSchema, validMapping);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject non-object schemas or mappings', () => {
    expect(validateModelDefinition('smartPumpModel', null, validMapping)).toEqual({
      valid: false,
      errors: ['SCHEMA_MUST_BE_JSON_OBJECT'],
    });

    expect(validateModelDefinition('smartPumpModel', validSchema, 'invalid')).toEqual({
      valid: false,
      errors: ['MAPPING_MUST_BE_JSON_OBJECT'],
    });
  });

  it('should fail on AJV schema compilation errors', () => {
    const invalidAjvSchema = {
      type: 'invalid-type-name',
      required: ['schemaId'],
      properties: {
        schemaId: { const: 'smartPumpModel' },
      },
    };

    const result = validateModelDefinition('smartPumpModel', invalidAjvSchema, validMapping);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('INVALID_JSON_SCHEMA');
  });

  it('should validate schemaId constraints and required status', () => {
    const missingConst = {
      type: 'object',
      properties: { schemaId: { type: 'string' } },
    };
    const resultMissing = validateModelDefinition('smartPumpModel', missingConst, validMapping);
    expect(resultMissing.errors).toContain('SCHEMA_ID_CONST_MISSING');
    expect(resultMissing.errors).toContain('SCHEMA_ID_MUST_BE_REQUIRED');

    const mismatchSchema = {
      type: 'object',
      required: ['schemaId'],
      properties: { schemaId: { const: 'otherModel' } },
    };
    const resultMismatch = validateModelDefinition('smartPumpModel', mismatchSchema, validMapping);
    expect(resultMismatch.errors).toContain(
      "SCHEMA_MODEL_MISMATCH: expected 'smartPumpModel', got 'otherModel'",
    );
  });

  it('should validate x-reporting custom keywords', () => {
    const badReportingSchema = {
      ...validSchema,
      properties: {
        ...validSchema.properties,
        metrics: {
          type: 'object',
          properties: {
            flowRate: {
              type: 'number',
              'x-reporting': {
                INVALID_STATE: 100,
                ACTIVE: -500,
              },
            },
          },
        },
      },
    };

    const result = validateModelDefinition('smartPumpModel', badReportingSchema, validMapping);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "X_REPORTING_STATE_INVALID: 'schema.properties.metrics.properties.flowRate.x-reporting.INVALID_STATE'",
    );
    expect(result.errors).toContain(
      "X_REPORTING_INTERVAL_INVALID: 'schema.properties.metrics.properties.flowRate.x-reporting.ACTIVE' must be a positive number or null",
    );
  });

  it('should validate x-buffering custom keywords', () => {
    const badBufferingSchema = {
      ...validSchema,
      properties: {
        ...validSchema.properties,
        historicalTelemetry: {
          type: 'object',
          properties: {
            flowRate: {
              type: 'array',
              'x-buffering': {
                interval: 0,
                unknownProp: true,
              },
            },
          },
        },
      },
    };

    const result = validateModelDefinition('smartPumpModel', badBufferingSchema, validMapping);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "X_BUFFERING_INTERVAL_INVALID: 'schema.properties.historicalTelemetry.properties.flowRate.x-buffering.interval' must be a positive number",
    );
    expect(result.errors).toContain(
      "X_BUFFERING_PROPERTY_INVALID: 'schema.properties.historicalTelemetry.properties.flowRate.x-buffering.unknownProp'",
    );
  });

  it('should validate mapping fields and paths', () => {
    const missingFieldsMapping = { fields: {} };
    const resultMissing = validateModelDefinition('smartPumpModel', validSchema, missingFieldsMapping);
    expect(resultMissing.errors).toContain('MAPPING_FIELDS_MISSING');

    const badPathsMapping = {
      fields: {
        testField: {
          path: 'non.existent.path',
          historyPath: 'invalid.history.path',
          operation: 'invalidOp',
        },
        invalidDefinition: 'not-an-object' as any,
        emptyPath: { path: '' },
      },
    };

    const resultBadPaths = validateModelDefinition('smartPumpModel', validSchema, badPathsMapping);
    expect(resultBadPaths.errors).toContain(
      "MAPPING_PATH_NOT_IN_SCHEMA: 'testField' -> 'non.existent.path'",
    );
    expect(resultBadPaths.errors).toContain(
      "HISTORY_PATH_NOT_IN_SCHEMA: 'testField' -> 'invalid.history.path'",
    );
    expect(resultBadPaths.errors).toContain(
      "MAPPING_OPERATION_INVALID: 'testField' has invalid operation 'invalidOp'",
    );
    expect(resultBadPaths.errors).toContain("MAPPING_FIELD_INVALID: 'invalidDefinition'");
    expect(resultBadPaths.errors).toContain("MAPPING_PATH_MISSING: 'emptyPath'");
  });
});