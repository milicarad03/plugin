import { normalizeWithMapping,logger } from "../../src/mapping-normalizer";

describe("Mapping Normalizer", () => {


  beforeEach(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks(); 
  });

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

    expect(result!.data.pressure).toBe(4.5);
    expect(result!.data.flow).toBe(20);
    expect(result!.deviceId).toBe("device1");
    expect(result!.raw).toEqual(message);
    expect(result!.timestamp).toBeDefined();

  });

  it("should skip missing fields", () => {
    const message = {};

    const result = normalizeWithMapping(message, "device1", mapping);

    expect(result!.data.pressure).toBeUndefined();
    expect(result!.data.flow).toBeUndefined();
  });

  it("should return null for invalid message", () => {
    const result = normalizeWithMapping(null, "device1", mapping);

    expect(result).toBeNull();
  });

  it("should handle deep missing paths gracefully", () => {
  const message = { performance: null }; 

  const result = normalizeWithMapping(message, "device1", mapping);

  expect(result!.data.pressure).toBeUndefined();
  expect(result!.data.flow).toBeUndefined();
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

    expect(result!.data.val1).toBe(0);
    expect(result!.data.val2).toBe(false);
  });

  it("should handle null values in payload correctly", () => {
    const mapping = { fields: { val: { path: "a.b" } } };
    const message = { a: { b: null } };

    const result = normalizeWithMapping(message, "device1", mapping);
    expect(result!.data).toHaveProperty("val");
    expect(result!.data.val).toBeNull();
  });
  
  it("should handle empty mapping", () => {
    const result = normalizeWithMapping({}, "device1", { fields: {} });

    expect(result!.data).toEqual({});
  });

  it("should ignore non-existing deep paths", () => {
    const mapping = {
      fields: {
        test: { path: "x.y.z" }
      }
    };

    const result = normalizeWithMapping({}, "device1", mapping);

    expect(result!.data.test).toBeUndefined();
  });
  it("should handle invalid mapping path (e.g. non-string)", () => {
    const badMapping = { fields: { test: { path: 123 as any } } };
    
    const result = normalizeWithMapping({ a: 1 }, "device1", badMapping);
    expect(result!.data.test).toBeUndefined(); 
  });
  it("should handle arrays as part of the path", () => {
    const mapping = { fields: { first: { path: "items.0" } } };
    const message = { items: ["a", "b"] };

    const result = normalizeWithMapping(message, "device1", mapping);
    expect(result!.data.first).toBe("a");
  });

  it("should throw when mapping is null", () => {
    expect(() =>
      normalizeWithMapping({}, "device1", null as any)
    ).toThrow("Invalid mapping definition");
  });

  it("should throw when mapping is undefined", () => {
    expect(() =>
      normalizeWithMapping({}, "device1", undefined as any)
    ).toThrow("Invalid mapping definition");
  });


  it("should handle path that points to a property with undefined value", () => {
    const mapping = { fields: { val: { path: "a.b" } } };
    const message = { a: { b: undefined } }; 

    const result = normalizeWithMapping(message, "device1", mapping);
   
    expect(result!.data).not.toHaveProperty("val");
  });

  it("should safely ignore prototype access attempts", () => {
    const mapping = { fields: { test: { path: "__proto__.toString" } } };
    const message = {};

    const result = normalizeWithMapping(message, "device1", mapping);
   
    expect(result!.data.test).toBeUndefined();
  });
  it("should handle empty path string safely", () => {
    const mapping = { fields: { val: { path: "" } } };

    const result = normalizeWithMapping({}, "device1", mapping);

    expect(result!.data.val).toBeUndefined();
  });

  it("should handle array as message safely", () => {
    const result = normalizeWithMapping([], "device1", { fields: { val: { path: "0" } } });

    expect(result).not.toBeNull();
  });
  it("should safely handle objects with circular references", () => {
    const message: any = { a: 1 };
    message.self = message; 
    
    const mapping = { fields: { val: { path: "a" } } };
    

    const result = normalizeWithMapping(message, "device1", mapping);
    
    expect(result!.data.val).toBe(1);
  });
  it("should log warning when message is invalid", () => {
    const warnSpy = jest.spyOn(logger, 'warn');
    normalizeWithMapping(null, "device1", mapping);
    
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Normalization aborted"));
  });
  it("should ignore mapping entries without path", () => {
    const mapping = { fields: { test: {} as any } };

    const result = normalizeWithMapping({}, "device1", mapping);

    expect(result!.data.test).toBeUndefined();
  });
  it("should return partial data if only some fields exist in payload", () => {
    const mapping = {
      fields: {
        pressure: { path: "performance.stages.p1" },
        temp: { path: "performance.temp" } 
      }
    };
    const message = { performance: { stages: { p1: 4.5 } } };
    
    const result = normalizeWithMapping(message, "device1", mapping);
    
    expect(result!.data.pressure).toBe(4.5);
    expect(result!.data.temp).toBeUndefined(); 
  });
  it("should handle large mapping definitions gracefully", () => {
    const largeMapping: any = { fields: {} };
    for(let i=0; i<100; i++) largeMapping.fields[`key${i}`] = { path: `data.p${i}` };
    
    const result = normalizeWithMapping({ data: {} }, "device1", largeMapping);
    
    expect(Object.keys(result!.data).length).toBe(0);
  });
  it("should handle paths with special characters safely", () => {
    
    const mapping = { fields: { val: { path: "special.key" } } };
    const message = { "special.key": "vrijednost" }; 

    const result = normalizeWithMapping(message, "device1", mapping);
    expect(result!.data.val).toBeUndefined(); 
  });

  it("should handle duplicated mapping paths safely", () => {
    const mapping = {
      fields: {
        a: { path: "x.y" },
        b: { path: "x.y" }
      }
    };

    const message = { x: { y: 100 } };

    const result = normalizeWithMapping(message, "device1", mapping);

    expect(result!.data.a).toBe(100);
    expect(result!.data.b).toBe(100);
  });

  it("should safely ignore constructor access attempts", () => {
    const mapping = {
      fields: {
        test: { path: "constructor.name" }
      }
    };

    const result = normalizeWithMapping(
      {},
      "device1",
      mapping
    );

    expect(result!.data.test).toBeUndefined();
  });
  it(("should safely ignore direct prototype path access"), () => {
    const mapping = {
      fields: {
        test: { path: "prototype.test" }
      }
    };

    const result = normalizeWithMapping(
      {},
      "device1",
      mapping
    );

    expect(result!.data.test).toBeUndefined();
  });
  it("should throw when mapping.fields is missing", () => {
    expect(() =>
      normalizeWithMapping(
        {},
        "device1",
        {} as any
      )
    ).toThrow("Invalid mapping definition");
  });
  it("should return null for string message", () => {
    const result = normalizeWithMapping(
      "invalid",
      "device1",
      mapping
    );

    expect(result).toBeNull();
  });
  it("should return null for numeric message", () => {
    const result = normalizeWithMapping(
      123,
      "device1",
      mapping
    );

    expect(result).toBeNull();
  });

});
