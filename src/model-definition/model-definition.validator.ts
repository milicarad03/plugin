import Ajv2020 from 'ajv/dist/2020';

export interface ModelDefinitionValidationResult {
  valid: boolean;
  errors: string[];
}

function isRecord( value: unknown): value is Record<string, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

/*
 * Proverava da li putanja iz mapper-a
 * postoji u JSON Schema definiciji.
 *
 * Primer:
 *
 * data.temp
 *
 * schema.properties.data
 *       .properties.temp
 */
function resolveSchemaPath( schema: any, dottedPath: string,): boolean {
  if (typeof dottedPath !== 'string' ||!dottedPath.trim()) {
    return false;
  }

  const segments = dottedPath.split('.').filter(Boolean);

  let current = schema;

  for (const segment of segments) {
    /*
     * Obično objektno polje.
     */
    if ( current?.properties?.[segment]) {
      current = current.properties[segment ];
      continue;
    }

    /*
     * Podrška ako se putanja
     * nalazi unutar objekata
     * koji su elementi niza.
     */
    if (current?.type === 'array' && current
        ?.items
        ?.properties
        ?.[segment]
    ) {
      current =
        current.items .properties[segment];

      continue;
    }

    return false;
  }

  return true;
}

/*
 * Proverava naša custom
 * proširenja JSON Schema-e:
 *
 * x-reporting
 * x-buffering
 *
 * Ona se koriste kao metadata
 * za simulator/uređaj i ne
 * predstavljaju polja koja
 * moraju postojati u telemetriji.
 */
function validateCustomKeywords( value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach(
      (item, index) => {
        validateCustomKeywords(
          item,
          `${path}[${index}]`,
          errors,
        );
      },
    );

    return;
  }

  if (!isRecord(value)) return;
  

  for (const [key, child] of Object.entries(value)) {
    /*
     * x-reporting format:
     *
     * "x-reporting": {
     *   "ACTIVE": 6000,
     *   "IDLE": 120000
     * }
     *
     * ili:
     *
     * "IDLE": null
     *
     * null znači da se polje
     * ne reportuje u tom stanju.
     */
    if ( key === 'x-reporting') {
      if (!isRecord(child)) {
        errors.push( `X_REPORTING_INVALID: '${path}.${key}' must be an object`);
      } else {
        const allowedStates =
          new Set([
            'ACTIVE',
            'IDLE',
          ]);
        if (
          Object.keys( child).length === 0) {
          errors.push(`X_REPORTING_EMPTY: '${path}.${key}'`);
        }

        for ( const [ state, interval ] of Object.entries( child) ) {
          /*
           * Ne dozvoljavamo
           * proizvoljna stanja.
           */
          if ( !allowedStates.has(state)) {
            errors.push( `X_REPORTING_STATE_INVALID: '${path}.${key}.${state}'` );
            continue;
          }
          if ( interval !== null && (typeof interval !== 'number' || !Number.isFinite( interval,  ) ||interval <= 0)) {
            errors.push(
              `X_REPORTING_INTERVAL_INVALID: '${path}.${key}.${state}' must be a positive number or null`,
            );
          }
        }
      }
    }

    /*
     * x-buffering format:
     *
     * "x-buffering": {
     *   "interval": 5000
     * }
     */
    if ( key === 'x-buffering' ) {
      if (!isRecord(child)) {
        errors.push( `X_BUFFERING_INVALID: '${path}.${key}' must be an object`);
      } else {
        const interval =
          child.interval;

        if (
          typeof interval !==
            'number' ||
          !Number.isFinite(
            interval,
          ) ||
          interval <= 0
        ) {
          errors.push(
            `X_BUFFERING_INTERVAL_INVALID: '${path}.${key}.interval' must be a positive number`,
          );
        }

        /*
         * Za sada x-buffering
         * dozvoljava samo interval.
         *
         * Time hvatamo typo ili
         * pogrešnu konfiguraciju.
         */
        for (
          const childKey
          of Object.keys(
            child,
          )
        ) {
          if (
            childKey !==
            'interval'
          ) {
            errors.push(
              `X_BUFFERING_PROPERTY_INVALID: '${path}.${key}.${childKey}'`,
            );
          }
        }
      }
    }

    /*
     * Nastavljamo rekurzivno
     * kroz celu JSON Schema-u.
     */
    validateCustomKeywords(
      child,
      `${path}.${key}`,
      errors,
    );
  }
}

export function validateModelDefinition(
  expectedModelId: string,
  schema: unknown,
  mapping: unknown,
): ModelDefinitionValidationResult {
  const errors: string[] = [];

  /*
   * 1. Schema mora biti
   * JSON objekat.
   */
  if (!isRecord(schema)) {
    return {
      valid: false,
      errors: [
        'SCHEMA_MUST_BE_JSON_OBJECT',
      ],
    };
  }

  /*
   * Mapper mora biti
   * JSON objekat.
   */
  if (!isRecord(mapping)) {
    return {
      valid: false,
      errors: [
        'MAPPING_MUST_BE_JSON_OBJECT',
      ],
    };
  }

  /*
   * 2. JSON Schema mora moći
   * da se kompajlira.
   *
   * Ne koristimo strict:false.
   *
   * Eksplicitno dozvoljavamo
   * samo custom keyword-e koje
   * naš sistem poznaje.
   */
  try {
    const ajv =
      new Ajv2020({
        allErrors: true,
      });

    ajv.addKeyword(
      'commands',
    );

    ajv.addKeyword(
      'x-reporting',
    );

    ajv.addKeyword(
      'x-buffering',
    );

    ajv.compile(
      schema,
    );
  } catch (
    error: any
  ) {
    errors.push(
      `INVALID_JSON_SCHEMA: ${
        error?.message ??
        'Schema compilation failed'
      }`,
    );
  }

  /*
   * 3. Provera custom
   * metadata keyword-a.
   *
   * Ovo proverava sadržaj:
   *
   * x-reporting
   * x-buffering
   */
  validateCustomKeywords(
    schema,
    'schema',
    errors,
  );

  /*
   * 4. schemaId mora
   * odgovarati modelu
   * za koji se vrši upload.
   *
   * Primer:
   *
   * expectedModelId = modelB
   *
   * schema:
   *
   * "schemaId": {
   *   "type": "string",
   *   "const": "modelB"
   * }
   */
  const schemaId =
    schema
      ?.properties
      ?.schemaId
      ?.const;

  if (
    typeof schemaId !==
    'string'
  ) {
    errors.push(
      'SCHEMA_ID_CONST_MISSING',
    );
  } else if (
    schemaId !==
    expectedModelId
  ) {
    errors.push(
      `SCHEMA_MODEL_MISMATCH: expected '${expectedModelId}', got '${schemaId}'`,
    );
  }

  /*
   * 5. schemaId mora
   * biti obavezan u svakoj
   * telemetry poruci.
   *
   * Schema zato mora imati:
   *
   * "required": [
   *   "schemaId"
   * ]
   */
  const rootRequired =
    Array.isArray(
      schema.required,
    )
      ? schema.required
      : [];

  if (
    !rootRequired.includes(
      'schemaId',
    )
  ) {
    errors.push(
      'SCHEMA_ID_MUST_BE_REQUIRED',
    );
  }

  /*
   * 6. Mapper mora
   * imati fields.
   */
  if (
    !isRecord(
      mapping.fields,
    ) ||
    Object.keys(
      mapping.fields,
    ).length === 0
  ) {
    errors.push(
      'MAPPING_FIELDS_MISSING',
    );

    return {
      valid:
        errors.length === 0,

      errors,
    };
  }

  /*
   * 7. Svaki mapper path
   * mora postojati u schema.
   *
   * Primer:
   *
   * "temperature": {
   *   "path": "data.temp"
   * }
   *
   * mora odgovarati:
   *
   * properties.data
   *   .properties.temp
   */
  for (
    const [
      targetKey,
      definition,
    ]
    of Object.entries(
      mapping.fields,
    )
  ) {
    if (
      !isRecord(
        definition,
      )
    ) {
      errors.push(
        `MAPPING_FIELD_INVALID: '${targetKey}'`,
      );

      continue;
    }

    const path =
      definition.path;

    if (
      typeof path !==
        'string' ||
      !path.trim()
    ) {
      errors.push(
        `MAPPING_PATH_MISSING: '${targetKey}'`,
      );

      continue;
    }

    if (
      !resolveSchemaPath(
        schema,
        path,
      )
    ) {
      errors.push(
        `MAPPING_PATH_NOT_IN_SCHEMA: '${targetKey}' -> '${path}'`,
      );
    }

    /*
     * historyPath nije
     * obavezan.
     *
     * Ali ako postoji,
     * mora biti validna
     * putanja kroz schema.
     */
    const historyPath =
      definition.historyPath;

    if (
      historyPath !==
      undefined
    ) {
      if (
        typeof historyPath !==
          'string' ||
        !historyPath.trim()
      ) {
        errors.push(
          `HISTORY_PATH_INVALID: '${targetKey}'`,
        );
      } else if (
        !resolveSchemaPath(
          schema,
          historyPath,
        )
      ) {
        errors.push(
          `HISTORY_PATH_NOT_IN_SCHEMA: '${targetKey}' -> '${historyPath}'`,
        );
      }
    }
  }

  return {
    valid:
      errors.length === 0,

    errors,
  };
}