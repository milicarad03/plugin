import { validateModelDefinition } from "src/model-definition/model-definition.validator";

describe('validateModelDefinition', () => {
  const validSchema = {
    type: 'object',
    required: ['schemaId'],
    commands: {
      SET_FLOW_TARGET: {
        payload: {
          type: 'object',
          required: ['target'],
          properties: {
            target: { type: 'number' },
          },
        },
      },
    },
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
    dashboard: {
      sections: [
        {
          id: 'overview',
          title: 'Overview',
          columns: 2,
          items: [
            {
              id: 'flow-rate',
              component: 'value-card',
              bind: 'flowRate',
            },
            {
              id: 'flow-target',
              component: 'numeric-input',
              command: 'SET_FLOW_TARGET',
              commandField: 'target',
              min: 0,
              max: 500,
              step: 1,
            },
            {
              id: 'flow-gauge',
              component: 'oil-gauge',
              bind: 'flowRate',
            },
          ],
        },
      ],
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

  it('should require a dashboard with at least one section', () => {
    const withoutDashboard = {
      fields: validMapping.fields,
    };
    const withoutSections = {
      ...validMapping,
      dashboard: { sections: [] },
    };

    expect(
      validateModelDefinition('smartPumpModel', validSchema, withoutDashboard).errors,
    ).toContain('DASHBOARD_MISSING');
    expect(
      validateModelDefinition('smartPumpModel', validSchema, withoutSections).errors,
    ).toContain('DASHBOARD_SECTIONS_MISSING');
  });

  it('should reject duplicate dashboard identifiers and invalid layout values', () => {
    const invalidLayoutMapping = {
      ...validMapping,
      dashboard: {
        sections: [
          {
            id: 'duplicate',
            columns: 1,
            items: [
              {
                id: 'same-item',
                component: 'value-card',
                bind: 'flowRate',
              },
            ],
          },
          {
            id: 'duplicate',
            columns: 0,
            items: [
              {
                id: 'same-item',
                component: 'value-card',
                bind: 'flowRate',
                colSpan: 2,
              },
            ],
          },
        ],
      },
    };

    const result = validateModelDefinition(
      'smartPumpModel',
      validSchema,
      invalidLayoutMapping,
    );

    expect(result.errors).toContain("DASHBOARD_SECTION_ID_DUPLICATE: 'duplicate'");
    expect(result.errors).toContain("DASHBOARD_COLUMNS_INVALID: section 'duplicate'");
    expect(result.errors).toContain("DASHBOARD_ITEM_ID_DUPLICATE: 'same-item'");
    expect(result.errors).toContain("DASHBOARD_COL_SPAN_INVALID: item 'same-item'");
  });

  it('should validate dashboard bindings and visibility bindings', () => {
    const invalidBindingMapping = {
      ...validMapping,
      dashboard: {
        sections: [
          {
            id: 'overview',
            columns: 1,
            items: [
              {
                id: 'unknown-value',
                component: 'value-card',
                bind: 'missingField',
                visibleWhen: {
                  bind: 'missingCondition',
                  equals: false,
                },
              },
            ],
          },
        ],
      },
    };

    const result = validateModelDefinition(
      'smartPumpModel',
      validSchema,
      invalidBindingMapping,
    );

    expect(result.errors).toContain(
      "DASHBOARD_BINDING_NOT_FOUND: item 'unknown-value' -> 'missingField'",
    );
    expect(result.errors).toContain(
      "DASHBOARD_VISIBILITY_BINDING_NOT_FOUND: item 'unknown-value' -> 'missingCondition'",
    );
  });

  it('should validate dashboard commands and command payload fields', () => {
    const invalidCommandMapping = {
      ...validMapping,
      dashboard: {
        sections: [
          {
            id: 'controls',
            columns: 2,
            items: [
              {
                id: 'unknown-command',
                component: 'command-form',
                command: 'DOES_NOT_EXIST',
              },
              {
                id: 'unknown-field',
                component: 'numeric-input',
                command: 'SET_FLOW_TARGET',
                commandField: 'missing',
              },
            ],
          },
        ],
      },
    };

    const result = validateModelDefinition(
      'smartPumpModel',
      validSchema,
      invalidCommandMapping,
    );

    expect(result.errors).toContain(
      "DASHBOARD_COMMAND_NOT_FOUND: item 'unknown-command' -> 'DOES_NOT_EXIST'",
    );
    expect(result.errors).toContain(
      "DASHBOARD_COMMAND_FIELD_NOT_FOUND: item 'unknown-field' -> 'missing'",
    );
  });

  it('should reject invalid numeric constraints', () => {
    const invalidNumericMapping = {
      ...validMapping,
      dashboard: {
        sections: [
          {
            id: 'controls',
            columns: 1,
            items: [
              {
                id: 'flow-target',
                component: 'numeric-input',
                command: 'SET_FLOW_TARGET',
                commandField: 'target',
                min: 10,
                max: 5,
                step: 0,
              },
            ],
          },
        ],
      },
    };

    const result = validateModelDefinition(
      'smartPumpModel',
      validSchema,
      invalidNumericMapping,
    );

    expect(result.errors).toContain(
      "DASHBOARD_NUMERIC_CONSTRAINT_INVALID: item 'flow-target.step'",
    );
    expect(result.errors).toContain(
      "DASHBOARD_NUMERIC_RANGE_INVALID: item 'flow-target'",
    );
  });
});
