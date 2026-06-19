const { normalizeWithMapping } = require("../../src/mapping-normalizer");

describe("Mapping Normalizer", () => {
  const mapping = {
    fields: {
      pressure: { path: "performance.stages.p1" },
      flow: { path: "performance.output.flow" }
    }
  };

  it("should map fields correctly", () => {
    const message = {
      performance: {
        stages: { p1: 4.5 },
        output: { flow: 20 }
      }
    };

    const result = normalizeWithMapping(message, "device1", mapping);

    expect(result.data.pressure).toBe(4.5);
    expect(result.data.flow).toBe(20);
  });

  it("should skip missing fields", () => {
    const message = {};

    const result = normalizeWithMapping(message, "device1", mapping);

    expect(result.data.pressure).toBeUndefined();
    expect(result.data.flow).toBeUndefined();
  });

  it("should return null for invalid message", () => {
    const result = normalizeWithMapping(null, "device1", mapping);

    expect(result).toBeNull();
  });
  it("should handle deep missing paths gracefully", () => {
  const message = { performance: null }; // Ili prazan objekat

  const result = normalizeWithMapping(message, "device1", mapping);

  expect(result.data.pressure).toBeUndefined();
  expect(result.data.flow).toBeUndefined();
 });
});
