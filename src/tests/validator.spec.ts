import  { validateTelemetryPayload, ajv, clearValidatorCache } from "../../src/newvalidator"
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

    const result = validateTelemetryPayload("modelF", schema, msg);

    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it("should reject invalid payload", () => {
    const msg = { schemaId: "modelF", value: "wrong" };

    const result = validateTelemetryPayload("modelF", schema, msg);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should reject wrong schemaId", () => {
    const msg = { schemaId: "wrong", value: 10 };

    const result = validateTelemetryPayload("modelF", schema, msg);

    expect(result.valid).toBe(false);
  });

  it("should use cache on repeated calls", () => {
    const msg = { schemaId: "modelF", value: 10 };
    const compileSpy = jest.spyOn(ajv, 'compile');
  

    const first = validateTelemetryPayload("modelF", schema, msg);
    expect(compileSpy).toHaveBeenCalledTimes(1);
    const second = validateTelemetryPayload("modelF", schema, msg);
    expect(compileSpy).toHaveBeenCalledTimes(1);

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    compileSpy.mockRestore();
  });

  it("should reject invalid payload with specific error", () => {
  const msg = { schemaId: "modelF", value: "wrong" };
  const result = validateTelemetryPayload("modelF", schema, msg);

  expect(result.valid).toBe(false);
 
  expect(result.errors[0]).toMatch(/value must be number/);
  });

  it("should gracefully handle empty or null payloads", () => {
  const result = validateTelemetryPayload("modelF", schema, {});
  expect(result.valid).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
  });


  it("should respect cache limit and evict oldest entries", () => {
    const compileSpy = jest.spyOn(ajv, 'compile');
    
   
    for (let i = 0; i < 50; i++) {
      const key = `model-${i}`;
      validateTelemetryPayload(key, { type: "object", properties: { schemaId: { const: key } }, required: ["schemaId"] }, { schemaId: key });
    }

  
    validateTelemetryPayload("model-50", { type: "object", properties: { schemaId: { const: "model-50" } }, required: ["schemaId"] }, { schemaId: "model-50" });

   
    compileSpy.mockClear();
    validateTelemetryPayload("model-0", { type: "object", properties: { schemaId: { const: "model-0" } }, required: ["schemaId"] }, { schemaId: "model-0" });
    
    expect(compileSpy).toHaveBeenCalled(); 
  });
  
  it("should reject payloads missing required fields", () => {
    const msg = { schemaId: "modelF" };
    const result = validateTelemetryPayload("modelF", schema, msg);
    
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/must have required property 'value'/);
  });

  it("should reject payloads with missing schemaId", () => {
      const msg = { value: 10 };
      const result = validateTelemetryPayload("modelF", schema, msg);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/Schema ID mismatch/);
    });

    it("should handle null message safely", () => {
    const result = validateTelemetryPayload("modelF", schema, null);

    expect(result.valid).toBe(false);
  });
  it("should handle malformed schema object", () => {
    const invalidSchema = { type: "NOT_A_VALID_TYPE" };
    const result = validateTelemetryPayload("bad-schema", invalidSchema, { schemaId: "bad-schema" });
    
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0); 
  });

  it("should update cache priority when accessing an existing entry", () => {
    const compileSpy = jest.spyOn(ajv, 'compile');
    
    for (let i = 0; i < 50; i++) {
      const key = `model-${i}`;
      validateTelemetryPayload(key, { type: "object", properties: { schemaId: { const: key } }, required: ["schemaId"] }, { schemaId: key });
    }
    validateTelemetryPayload("model-0", { type: "object", properties: { schemaId: { const: "model-0" } }, required: ["schemaId"] }, { schemaId: "model-0" });

    validateTelemetryPayload("model-50", { type: "object", properties: { schemaId: { const: "model-50" } }, required: ["schemaId"] }, { schemaId: "model-50" });
    compileSpy.mockClear(); 
    
    validateTelemetryPayload("model-0", { type: "object", properties: { schemaId: { const: "model-0" } }, required: ["schemaId"] }, { schemaId: "model-0" });
    
    expect(compileSpy).not.toHaveBeenCalled(); 
    
    compileSpy.mockRestore();
  });

  it("should handle empty or weird cache keys gracefully", () => {
    const result = validateTelemetryPayload("", schema, { schemaId: "" });
    expect(result.valid).toBe(false); // jer schemaId neće biti prazan string u msg
  });
  it("should handle AJV compile error gracefully", () => {
    jest.spyOn(ajv, 'compile').mockImplementation(() => {
      throw new Error("compile fail");
    });

    const result = validateTelemetryPayload("modelX", schema, { schemaId: "modelX" });

    expect(result.valid).toBe(false);
  });
  it("should reject when schemaId mismatches but structure is valid", () => {
    const msg = { schemaId: "wrong", value: 10 };
    
    const result = validateTelemetryPayload("modelF", schema, msg);

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
    const result = validateTelemetryPayload("modelF", strictSchema, msg);

    expect(result.valid).toBe(false);

    expect(result.errors[0]).toMatch(/must NOT have additional properties/);
  });
  it("should reject payload when types are strictly mismatched", () => {
    const msg = { schemaId: "modelF", value: "10" };
    const result = validateTelemetryPayload("modelF", schema, msg);

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

    const msg = { value: 10 };

    const result = validateTelemetryPayload("modelF", badSchema, msg);

    expect(result.valid).toBe(false);
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
      }
    };

    const msg = {
      schemaId: "modelF",
      meta: { temp: "wrong" }
    };

    const result = validateTelemetryPayload("modelF", nestedSchema, msg);

    expect(result.valid).toBe(false);
  });
  it("should re-compile schema after cache clear", () => {
      const compileSpy = jest.spyOn(ajv, 'compile');
      const msg = { schemaId: "modelF", value: 10 };

    
      validateTelemetryPayload("modelF", schema, msg);
      expect(compileSpy).toHaveBeenCalledTimes(1);

    
      clearValidatorCache();

    
      validateTelemetryPayload("modelF", schema, msg);
      expect(compileSpy).toHaveBeenCalledTimes(2);

      compileSpy.mockRestore();
  });

});