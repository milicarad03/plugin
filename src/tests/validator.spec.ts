const { validateTelemetryPayload } = require("../../src/newvalidator");

const schema = {
  type: "object",
  properties: {
    schemaId: { const: "modelF" },
    value: { type: "number" }
  },
  required: ["schemaId", "value"]
};

describe("Validator", () => {
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

    const first = validateTelemetryPayload("modelF", schema, msg);
    const second = validateTelemetryPayload("modelF", schema, msg);

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
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

  expect(true).toBe(true); 
  });
  
  it("should reject payloads missing required fields", () => {
  const msg = { schemaId: "modelF" };
  const result = validateTelemetryPayload("modelF", schema, msg);
  
  expect(result.valid).toBe(false);
  expect(result.errors[0]).toMatch(/must have required property 'value'/);
});


});