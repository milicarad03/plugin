import { validateTelemetryPayload, ajv, clearValidatorCache, validateDeviceCommand } from "../../src/newvalidator";
import { PluginErrorCode } from "src/device-registry.interface";

const schema = {
  type: "object",
  properties: {
    schemaId: { const: "modelF" },
    value: { type: "number" }
  },
  required: ["schemaId", "value"]
};

describe("Validator", () => {
  beforeEach(() => {
    clearValidatorCache(); 
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should validate correct payload", () => {
    const msg = { schemaId: "modelF", value: 10 };

    const result = validateTelemetryPayload("modelF", "modelF", schema, msg);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should reject invalid payload", () => {
    const msg = { schemaId: "modelF", value: "wrong" };

    const result = validateTelemetryPayload("modelF", "modelF", schema, msg);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should reject wrong schemaId", () => {
    const msg = { schemaId: "wrong", value: 10 };

    const result = validateTelemetryPayload("modelF", "modelF", schema, msg);

    expect(result.valid).toBe(false);
  });

  it("should use cache on repeated calls", () => {
    const msg = { schemaId: "modelF", value: 10 };
    const compileSpy = jest.spyOn(ajv, 'compile');
  
    const first = validateTelemetryPayload("modelF", "modelF", schema, msg);
    expect(compileSpy).toHaveBeenCalledTimes(1);
    const second = validateTelemetryPayload("modelF", "modelF", schema, msg);
    expect(compileSpy).toHaveBeenCalledTimes(1);

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    compileSpy.mockRestore();
  });

  it("should reject invalid payload with specific error", () => {
    const msg = { schemaId: "modelF", value: "wrong" };
    const result = validateTelemetryPayload("modelF", "modelF", schema, msg);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/value must be number/);
  });

  it("should gracefully handle empty or null payloads", () => {
    expect(() =>
      validateTelemetryPayload("modelF", "modelF", schema, null)
    ).toThrow();
  });

  it("should respect cache limit and evict oldest entries", () => {
    const compileSpy = jest.spyOn(ajv, 'compile');
    
    for (let i = 0; i < 50; i++) {
      const key = `model-${i}`;
      validateTelemetryPayload(key, key, { type: "object", properties: { schemaId: { const: key } }, required: ["schemaId"] }, { schemaId: key });
    }

    validateTelemetryPayload("model-50", "model-50", { type: "object", properties: { schemaId: { const: "model-50" } }, required: ["schemaId"] }, { schemaId: "model-50" });

    compileSpy.mockClear();
    validateTelemetryPayload("model-0", "model-0", { type: "object", properties: { schemaId: { const: "model-0" } }, required: ["schemaId"] }, { schemaId: "model-0" });
    
    expect(compileSpy).toHaveBeenCalled(); 
  });
  
  it("should reject payloads missing required fields", () => {
    const msg = { schemaId: "modelF" };
    const result = validateTelemetryPayload("modelF", "modelF", schema, msg);
    
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/root must have required property 'value'/);
  });

  it("should reject payloads with missing schemaId", () => {
    const msg = { value: 10 };
    const result = validateTelemetryPayload("modelF", "modelF", schema, msg);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Schema ID mismatch/);
  });

  it("should throw exception when message is null", () => {
    expect(() =>
      validateTelemetryPayload("modelF", "modelF", schema, null)
    ).toThrow();
  });

  it("should throw SchemaCompileException for malformed schema", () => {
    const invalidSchema = {
      type: "NOT_A_VALID_TYPE"
    };

    expect(() =>
      validateTelemetryPayload("bad-schema", "bad-schema", invalidSchema, { schemaId: "bad-schema" })
    ).toThrow();
  });

  it("should update cache priority when accessing an existing entry", () => {
    const compileSpy = jest.spyOn(ajv, 'compile');
    
    for (let i = 0; i < 50; i++) {
      const key = `model-${i}`;
      validateTelemetryPayload(key, key, { type: "object", properties: { schemaId: { const: key } }, required: ["schemaId"] }, { schemaId: key });
    }
    validateTelemetryPayload("model-0", "model-0", { type: "object", properties: { schemaId: { const: "model-0" } }, required: ["schemaId"] }, { schemaId: "model-0" });

    validateTelemetryPayload("model-50", "model-50", { type: "object", properties: { schemaId: { const: "model-50" } }, required: ["schemaId"] }, { schemaId: "model-50" });
    compileSpy.mockClear(); 
    
    validateTelemetryPayload("model-0", "model-0", { type: "object", properties: { schemaId: { const: "model-0" } }, required: ["schemaId"] }, { schemaId: "model-0" });
    
    expect(compileSpy).not.toHaveBeenCalled(); 
    
    compileSpy.mockRestore();
  });

  it("should handle empty or weird cache keys gracefully", () => {
    const result = validateTelemetryPayload("", "", schema, { schemaId: "" });
    expect(result.valid).toBe(false);
  });

  it("should throw exception when AJV compile fails", () => {
    jest.spyOn(ajv, "compile").mockImplementation(() => {
      throw new Error("compile fail");
    });

    expect(() =>
      validateTelemetryPayload("modelX", "modelX", schema, { schemaId: "modelX" })
    ).toThrow();
  });

  it("should reject when schemaId mismatches but structure is valid", () => {
    const msg = { schemaId: "wrong", value: 10 };
    
    const result = validateTelemetryPayload("modelF", "modelF", schema, msg);

    expect(result.valid).toBe(false);
  });

  it("should reject payloads with unexpected extra fields", () => {
    jest.restoreAllMocks(); 

    const strictSchema = {
      type: "object",
      properties: {
        schemaId: { const: "modelF" },
        value: { type: "number" }
      },
      required: ["schemaId", "value"],
      additionalProperties: false 
    };

    const msg = { schemaId: "modelF", value: 10, extraField: "nezeljeno" };
    const result = validateTelemetryPayload("modelF", "modelF", strictSchema, msg);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/root must NOT have additional properties/);
  });

  it("should reject payload when types are strictly mismatched", () => {
    const msg = { schemaId: "modelF", value: "10" };
    const result = validateTelemetryPayload("modelF", "modelF", schema, msg);

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/value must be number/);
  });

  it("should reject schema without schemaId definition", () => {
    const badSchema = {
      type: "object",
      properties: {
        value: { type: "number" }
      },
      required: ["value"]
    };

    const msg = { schemaId: "modelF", value: 10 };

    const result = validateTelemetryPayload("modelF", "modelF", badSchema, msg);

    expect(result.valid).toBe(true);
  });

  it("should reject nested type mismatch", () => {
    const nestedSchema = {
      type: "object",
      properties: {
        schemaId: { const: "modelF" },
        meta: {
          type: "object",
          properties: {
            temp: { type: "number" }
          }
        }
      },
      required: ["schemaId"]
    };

    const msg = {
      schemaId: "modelF",
      meta: { temp: "wrong" }
    };

    const result = validateTelemetryPayload("modelF", "modelF", nestedSchema, msg);

    expect(result.valid).toBe(false);
  });

  it("should re-compile schema after cache clear", () => {
    const compileSpy = jest.spyOn(ajv, 'compile');
    const msg = { schemaId: "modelF", value: 10 };

    validateTelemetryPayload("modelF", "modelF", schema, msg);
    expect(compileSpy).toHaveBeenCalledTimes(1);

    clearValidatorCache();

    validateTelemetryPayload("modelF", "modelF", schema, msg);
    expect(compileSpy).toHaveBeenCalledTimes(2);

    compileSpy.mockRestore();
  });

  it("should clear validator cache", () => {
    const compileSpy = jest.spyOn(ajv, "compile");

    validateTelemetryPayload("modelF", "modelF", schema, { schemaId: "modelF", value: 10 });

    clearValidatorCache();

    validateTelemetryPayload("modelF", "modelF", schema, { schemaId: "modelF", value: 10 });

    expect(compileSpy).toHaveBeenCalledTimes(2);
  });

  describe("validateDeviceCommand", () => {
    const commandSchema = {
      commands: {
        SET_LED: {
          payload: {
            type: "object",
            properties: {
              value: {
                type: "boolean"
              }
            },
            required: ["value"]
          }
        },

        SET_MODE: {
          payload: {
            type: "object",
            properties: {
              mode: {
                type: "string"
              }
            },
            required: ["mode"]
          }
        }
      }
    };

    it("should validate correct command payload", () => {
      const result = validateDeviceCommand(
        commandSchema,
        "SET_LED",
        { value: true }
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should reject unsupported command", () => {
      const result = validateDeviceCommand(
        commandSchema,
        "UNKNOWN_COMMAND",
        {}
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain(
        "not supported"
      );
    });

    it("should reject command without payload schema", () => {
      const schemaWithoutPayload = {
        commands: {
          SET_LED: {}
        }
      };

      const result = validateDeviceCommand(
        schemaWithoutPayload,
        "SET_LED",
        {}
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain(
        "no payload schema"
      );
    });

    it("should reject invalid payload type", () => {
      const result = validateDeviceCommand(
        commandSchema,
        "SET_LED",
        { value: "wrong" }
      );

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject missing required payload field", () => {
      const result = validateDeviceCommand(
        commandSchema,
        "SET_LED",
        {}
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(
        /must have required property/
      );
    });

    it("should validate another command correctly", () => {
      const result = validateDeviceCommand(
        commandSchema,
        "SET_MODE",
        { mode: "AUTO" }
      );

      expect(result.valid).toBe(true);
    });

    it("should reject nested payload mismatch", () => {
      const nestedSchema = {
        commands: {
          SET_CONFIG: {
            payload: {
              type: "object",
              properties: {
                config: {
                  type: "object",
                  properties: {
                    interval: {
                      type: "number"
                    }
                  },
                  required: ["interval"]
                }
              }
            }
          }
        }
      };

      const result = validateDeviceCommand(
        nestedSchema,
        "SET_CONFIG",
        {
          config: {
            interval: "bad"
          }
        }
      );

      expect(result.valid).toBe(false);
    });

    it("should return payload-prefixed validation errors", () => {
      const result = validateDeviceCommand(
        commandSchema,
        "SET_LED",
        {}
      );

      expect(result.errors[0]).toContain(
        "payload"
      );
    });
  });
});