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

function resolveSchemaNode(schema: any, dottedPath: string): any | null {
  if (typeof dottedPath !== 'string' || !dottedPath.trim()) {
    return null;
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

    return null;
  }

  return current;
}

function resolveSchemaPath(schema: any, dottedPath: string): boolean {
  return resolveSchemaNode(schema, dottedPath) !== null;
}

function hasOwn(value: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateCommandIdempotency(
  schema: Record<string, any>,
  mapping: Record<string, any>,
  errors: string[],
): void {
  if (!isRecord(schema.commands)) {
    return;
  }

  const mappingFields = isRecord(mapping.fields)
    ? new Set(Object.keys(mapping.fields))
    : new Set<string>();

  for (const [commandName, commandDefinition] of Object.entries(
    schema.commands,
  )) {
    if (!isRecord(commandDefinition)) {
      continue;
    }

    const idempotency = commandDefinition['x-idempotency'];

    if (idempotency === undefined) {
      continue;
    }

    if (!isRecord(idempotency)) {
      errors.push(`COMMAND_IDEMPOTENCY_INVALID: '${commandName}'`);
      continue;
    }

    const stateBinding =
      typeof idempotency.stateBinding === 'string'
        ? idempotency.stateBinding.trim()
        : '';
    const payloadPath =
      typeof idempotency.payloadPath === 'string'
        ? idempotency.payloadPath.trim()
        : '';

    if (!stateBinding) {
      errors.push(
        `COMMAND_IDEMPOTENCY_STATE_BINDING_INVALID: '${commandName}'`,
      );
    } else if (!mappingFields.has(stateBinding)) {
      errors.push(
        `COMMAND_IDEMPOTENCY_STATE_BINDING_NOT_FOUND: '${commandName}' -> '${stateBinding}'`,
      );
    } else if (payloadPath) {
      const mappingDefinition = mapping.fields[stateBinding];
      const stateNode = resolveSchemaNode(
        schema,
        mappingDefinition?.path,
      );
      const payloadNode = resolveSchemaNode(
        commandDefinition.payload,
        payloadPath,
      );
      const stateType =
        mappingDefinition?.operation === 'min' ||
        mappingDefinition?.operation === 'max'
          ? 'number'
          : stateNode?.type;

      if (
        typeof stateType === 'string' &&
        typeof payloadNode?.type === 'string' &&
        stateType !== payloadNode.type
      ) {
        errors.push(
          `COMMAND_IDEMPOTENCY_TYPE_MISMATCH: '${commandName}' state '${stateType}' payload '${payloadNode.type}'`,
        );
      }
    }

    if (!payloadPath) {
      errors.push(
        `COMMAND_IDEMPOTENCY_PAYLOAD_PATH_INVALID: '${commandName}'`,
      );
    } else if (
      !resolveSchemaPath(commandDefinition.payload, payloadPath)
    ) {
      errors.push(
        `COMMAND_IDEMPOTENCY_PAYLOAD_PATH_NOT_FOUND: '${commandName}' -> '${payloadPath}'`,
      );
    }

    if (
      !Number.isInteger(idempotency.maxAgeMs) ||
      idempotency.maxAgeMs <= 0
    ) {
      errors.push(
        `COMMAND_IDEMPOTENCY_MAX_AGE_INVALID: '${commandName}'`,
      );
    }

    if (
      idempotency.epsilon !== undefined &&
      (typeof idempotency.epsilon !== 'number' ||
        !Number.isFinite(idempotency.epsilon) ||
        idempotency.epsilon < 0)
    ) {
      errors.push(
        `COMMAND_IDEMPOTENCY_EPSILON_INVALID: '${commandName}'`,
      );
    }

    const allowedKeys = new Set([
      'stateBinding',
      'payloadPath',
      'maxAgeMs',
      'epsilon',
    ]);

    for (const key of Object.keys(idempotency)) {
      if (!allowedKeys.has(key)) {
        errors.push(
          `COMMAND_IDEMPOTENCY_PROPERTY_INVALID: '${commandName}.${key}'`,
        );
      }
    }
  }
}

function validateDashboardMapping(
  schema: Record<string, any>,
  mapping: Record<string, any>,
  errors: string[],
): void {
  const dashboard = mapping.dashboard;

  if (!isRecord(dashboard)) {
    errors.push('DASHBOARD_MISSING');
    return;
  }

  if (!Array.isArray(dashboard.sections) || dashboard.sections.length === 0) {
    errors.push('DASHBOARD_SECTIONS_MISSING');
    return;
  }

  const mappingFields = isRecord(mapping.fields)
    ? new Set(Object.keys(mapping.fields))
    : new Set<string>();
  const commands = isRecord(schema.commands) ? schema.commands : {};
  const sectionIds = new Set<string>();
  const itemIds = new Set<string>();
  const bindRequiredComponents = new Set([
    'value-card',
    'line-chart',
    'table',
  ]);
  const commandRequiredComponents = new Set([
    'switch',
    'numeric-input',
    'command-form',
  ]);
  const commandFieldRequiredComponents = new Set([
    'switch',
    'numeric-input',
  ]);

  dashboard.sections.forEach((section: unknown, sectionIndex: number) => {
    if (!isRecord(section)) {
      errors.push(`DASHBOARD_SECTION_INVALID: index ${sectionIndex}`);
      return;
    }

    const sectionId =
      typeof section.id === 'string' ? section.id.trim() : '';

    if (!sectionId) {
      errors.push(`DASHBOARD_SECTION_ID_INVALID: index ${sectionIndex}`);
    } else if (sectionIds.has(sectionId)) {
      errors.push(`DASHBOARD_SECTION_ID_DUPLICATE: '${sectionId}'`);
    } else {
      sectionIds.add(sectionId);
    }

    const sectionLabel = sectionId || `index ${sectionIndex}`;
    const columns = section.columns;

    if (!Number.isInteger(columns) || columns <= 0) {
      errors.push(`DASHBOARD_COLUMNS_INVALID: section '${sectionLabel}'`);
    }

    if (!Array.isArray(section.items)) {
      errors.push(`DASHBOARD_ITEMS_INVALID: section '${sectionLabel}'`);
      return;
    }

    section.items.forEach((item: unknown, itemIndex: number) => {
      if (!isRecord(item)) {
        errors.push(
          `DASHBOARD_ITEM_INVALID: section '${sectionLabel}', index ${itemIndex}`,
        );
        return;
      }

      const itemId = typeof item.id === 'string' ? item.id.trim() : '';

      if (!itemId) {
        errors.push(
          `DASHBOARD_ITEM_ID_INVALID: section '${sectionLabel}', index ${itemIndex}`,
        );
      } else if (itemIds.has(itemId)) {
        errors.push(`DASHBOARD_ITEM_ID_DUPLICATE: '${itemId}'`);
      } else {
        itemIds.add(itemId);
      }

      const itemLabel = itemId || `${sectionLabel}[${itemIndex}]`;
      const component =
        typeof item.component === 'string' ? item.component.trim() : '';

      if (!component) {
        errors.push(`DASHBOARD_COMPONENT_INVALID: item '${itemLabel}'`);
      }

      if (
        item.colSpan !== undefined &&
        (!Number.isInteger(item.colSpan) ||
          item.colSpan <= 0 ||
          (Number.isInteger(columns) && item.colSpan > columns))
      ) {
        errors.push(`DASHBOARD_COL_SPAN_INVALID: item '${itemLabel}'`);
      }

      const bind = typeof item.bind === 'string' ? item.bind.trim() : '';

      if (bindRequiredComponents.has(component) && !bind) {
        errors.push(`DASHBOARD_BIND_REQUIRED: item '${itemLabel}'`);
      } else if (item.bind !== undefined && !bind) {
        errors.push(`DASHBOARD_BIND_INVALID: item '${itemLabel}'`);
      } else if (bind && !mappingFields.has(bind)) {
        errors.push(
          `DASHBOARD_BINDING_NOT_FOUND: item '${itemLabel}' -> '${bind}'`,
        );
      }

      if (item.visibleWhen !== undefined) {
        if (!isRecord(item.visibleWhen)) {
          errors.push(`DASHBOARD_VISIBILITY_INVALID: item '${itemLabel}'`);
        } else {
          const visibilityBind =
            typeof item.visibleWhen.bind === 'string'
              ? item.visibleWhen.bind.trim()
              : '';

          if (!visibilityBind || !hasOwn(item.visibleWhen, 'equals')) {
            errors.push(`DASHBOARD_VISIBILITY_INVALID: item '${itemLabel}'`);
          } else if (!mappingFields.has(visibilityBind)) {
            errors.push(
              `DASHBOARD_VISIBILITY_BINDING_NOT_FOUND: item '${itemLabel}' -> '${visibilityBind}'`,
            );
          }
        }
      }

      const command =
        typeof item.command === 'string' ? item.command.trim() : '';

      if (commandRequiredComponents.has(component) && !command) {
        errors.push(`DASHBOARD_COMMAND_REQUIRED: item '${itemLabel}'`);
      } else if (item.command !== undefined && !command) {
        errors.push(`DASHBOARD_COMMAND_INVALID: item '${itemLabel}'`);
      } else if (command && !isRecord(commands[command])) {
        errors.push(
          `DASHBOARD_COMMAND_NOT_FOUND: item '${itemLabel}' -> '${command}'`,
        );
      }

      const commandField =
        typeof item.commandField === 'string'
          ? item.commandField.trim()
          : '';

      if (commandFieldRequiredComponents.has(component) && !commandField) {
        errors.push(`DASHBOARD_COMMAND_FIELD_REQUIRED: item '${itemLabel}'`);
      } else if (item.commandField !== undefined && !commandField) {
        errors.push(`DASHBOARD_COMMAND_FIELD_INVALID: item '${itemLabel}'`);
      } else if (commandField) {
        const payloadProperties = commands[command]?.payload?.properties;

        if (!command || !isRecord(payloadProperties) || !hasOwn(payloadProperties, commandField)) {
          errors.push(
            `DASHBOARD_COMMAND_FIELD_NOT_FOUND: item '${itemLabel}' -> '${commandField}'`,
          );
        }
      }

      for (const property of ['min', 'max', 'step']) {
        const value = item[property];

        if (
          value !== undefined &&
          (typeof value !== 'number' || !Number.isFinite(value))
        ) {
          errors.push(
            `DASHBOARD_NUMERIC_CONSTRAINT_INVALID: item '${itemLabel}.${property}'`,
          );
        }
      }

      if (typeof item.step === 'number' && item.step <= 0) {
        errors.push(
          `DASHBOARD_NUMERIC_CONSTRAINT_INVALID: item '${itemLabel}.step'`,
        );
      }

      if (
        typeof item.min === 'number' &&
        typeof item.max === 'number' &&
        item.min > item.max
      ) {
        errors.push(`DASHBOARD_NUMERIC_RANGE_INVALID: item '${itemLabel}'`);
      }
    });
  });
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
    ajv.addKeyword('x-idempotency');

    ajv.compile(schema);
  } catch (error: any) {
    errors.push(
      `INVALID_JSON_SCHEMA: ${error?.message ?? 'Schema compilation failed'}`,
    );
  }

  validateCustomKeywords(schema, 'schema', errors);
  validateCommandIdempotency(schema, mapping, errors);

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
  } else {
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
  }

  validateDashboardMapping(schema, mapping, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}
