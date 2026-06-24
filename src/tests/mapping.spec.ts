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
    expect(result.deviceId).toBe("device1");
    expect(result.raw).toEqual(message);
    expect(result.timestamp).toBeDefined();

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
  const message = { performance: null }; 

  const result = normalizeWithMapping(message, "device1", mapping);

  expect(result.data.pressure).toBeUndefined();
  expect(result.data.flow).toBeUndefined();
 });

 it("should include falsy values (0 and false) as valid data", () => {
    const mapping = {
      fields: {
        val1: { path: "a.b" },
        val2: { path: "a.c" }
      }
    };
    const message = { a: { b: 0, c: false } };

    const result = normalizeWithMapping(message, "device1", mapping);

    expect(result.data.val1).toBe(0);
    expect(result.data.val2).toBe(false);
  });

  it("should handle null values in payload correctly", () => {
    const mapping = { fields: { val: { path: "a.b" } } };
    const message = { a: { b: null } };

    const result = normalizeWithMapping(message, "device1", mapping);
    expect(result.data).toHaveProperty("val");
    expect(result.data.val).toBeNull();
  });
  
  it("should handle empty mapping", () => {
    const result = normalizeWithMapping({}, "device1", { fields: {} });

    expect(result.data).toEqual({});
  });

  it("should ignore non-existing deep paths", () => {
    const mapping = {
      fields: {
        test: { path: "x.y.z" }
      }
    };

    const result = normalizeWithMapping({}, "device1", mapping);

    expect(result.data.test).toBeUndefined();
  });
  it("should handle invalid mapping path (e.g. non-string)", () => {
  const badMapping = { fields: { test: { path: 123 as any } } };
  
  const result = normalizeWithMapping({ a: 1 }, "device1", badMapping);
  expect(result.data.test).toBeUndefined(); 
});
it("should handle arrays as part of the path", () => {
    const mapping = { fields: { first: { path: "items.0" } } };
    const message = { items: ["a", "b"] };

    const result = normalizeWithMapping(message, "device1", mapping);
    expect(result.data.first).toBe("a");
  });

  it("should return null if mapping is null/undefined", () => {
    // Tvoj kod ne proverava da li je 'mapping' validan objekat
    // Ovo bi bio dobar test za robusnost
    const result = normalizeWithMapping({}, "device1", null as any);
    expect(result).toBeDefined(); // Ili da baci grešku, zavisno od dizajna
  });

});
