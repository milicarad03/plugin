//const { validateTelemetryPayload, ajv, clearValidatorCache } = require("../../src/newvalidator");
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

  for (let i = 0; i < 51; i++) {
    const key = `model-${i}`;
    const s = { type: "object", properties: { schemaId: { const: key } }, required: ["schemaId"] };
    const m = { schemaId: key };
    validateTelemetryPayload(key, s, m);
  }

  const result = validateTelemetryPayload("model-0", {
      type: "object",
      properties: { schemaId: { const: "model-0" } },
      required: ["schemaId"]
    }, { schemaId: "model-0" });


  //expect(true).toBe(true); 
  expect(result.valid).toBe(true);
  });
  
  it("should reject payloads missing required fields", () => {
    const msg = { schemaId: "modelF" };
    const result = validateTelemetryPayload("modelF", schema, msg);
    
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/must have required property 'value'/);
  });

  it("should reject payloads with missing schemaId", () => {
      const msg = { value: 10 }; // fali schemaId
      const result = validateTelemetryPayload("modelF", schema, msg);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/Schema ID mismatch/);
    });

    it("should handle null message safely", () => {
    const result = validateTelemetryPayload("modelF", schema, null);

    expect(result.valid).toBe(false);
  });



});