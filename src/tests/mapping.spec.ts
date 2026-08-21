import { normalizeWithMapping, logger } from '../mapping-normalizer';
import { ConfigMissingException } from 'src/exceptions/plugin.exceptions';

describe('Mapping Normalizer', () => {
  beforeEach(() => {
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mapping = {
    fields: {
      pressure: { path: 'performance.stages.p1' },
      flow: { path: 'performance.output.flow' },
    },
  };

  it('should map fields correctly', () => {
    const message = {
      performance: {
        stages: { p1: 4.5 },
        output: { flow: 20 },
      },
    };

    const result = normalizeWithMapping(message, 'device1', mapping);

    expect(result!.data.pressure).toBe(4.5);
    expect(result!.data.flow).toBe(20);
    expect(result!.deviceId).toBe('device1');
    expect(result!.raw).toEqual(message);
    expect(result!.timestamp).toBeDefined();
  });

  it('should skip missing fields', () => {
    const message = {};

    const result = normalizeWithMapping(message, 'device1', mapping);

    expect(result!.data.pressure).toBeUndefined();
    expect(result!.data.flow).toBeUndefined();
  });

  it('should return null for invalid message', () => {
    const result = normalizeWithMapping(null, 'device1', mapping);

    expect(result).toBeNull();
  });

  it('should handle deep missing paths gracefully', () => {
    const message = { performance: null };

    const result = normalizeWithMapping(message, 'device1', mapping);

    expect(result!.data.pressure).toBeUndefined();
    expect(result!.data.flow).toBeUndefined();
  });

  it('should include falsy values (0 and false) as valid data', () => {
    const customMapping = {
      fields: {
        val1: { path: 'a.b' },
        val2: { path: 'a.c' },
      },
    };
    const message = { a: { b: 0, c: false } };

    const result = normalizeWithMapping(message, 'device1', customMapping);

    expect(result!.data.val1).toBe(0);
    expect(result!.data.val2).toBe(false);
  });

  it('should handle null values in payload correctly', () => {
    const customMapping = { fields: { val: { path: 'a.b' } } };
    const message = { a: { b: null } };

    const result = normalizeWithMapping(message, 'device1', customMapping);
    expect(result!.data).toHaveProperty('val');
    expect(result!.data.val).toBeNull();
  });

  it('should handle empty mapping', () => {
    const result = normalizeWithMapping({}, 'device1', { fields: {} });

    expect(result!.data).toEqual({});
  });

  it('should ignore non-existing deep paths', () => {
    const customMapping = {
      fields: {
        test: { path: 'x.y.z' },
      },
    };

    const result = normalizeWithMapping({}, 'device1', customMapping);

    expect(result!.data.test).toBeUndefined();
  });

  it('should handle invalid mapping path (e.g. non-string)', () => {
    const badMapping = { fields: { test: { path: 123 as any } } };

    const result = normalizeWithMapping({ a: 1 }, 'device1', badMapping);
    expect(result!.data.test).toBeUndefined();
  });

  it('should handle arrays as part of the path', () => {
    const customMapping = { fields: { first: { path: 'items.0' } } };
    const message = { items: ['a', 'b'] };

    const result = normalizeWithMapping(message, 'device1', customMapping);
    expect(result!.data.first).toBe('a');
  });

  it('should throw ConfigMissingException when mapping is null', () => {
    expect(() =>
      normalizeWithMapping({}, 'device1', null as any),
    ).toThrow(ConfigMissingException);
  });

  it('should throw ConfigMissingException when mapping is undefined', () => {
    expect(() =>
      normalizeWithMapping({}, 'device1', undefined as any),
    ).toThrow(ConfigMissingException);
  });

  it('should handle path that points to a property with undefined value', () => {
    const customMapping = { fields: { val: { path: 'a.b' } } };
    const message = { a: { b: undefined } };

    const result = normalizeWithMapping(message, 'device1', customMapping);

    expect(result!.data).not.toHaveProperty('val');
  });

  it('should safely ignore prototype access attempts', () => {
    const customMapping = { fields: { test: { path: '__proto__.toString' } } };
    const message = {};

    const result = normalizeWithMapping(message, 'device1', customMapping);

    expect(result!.data.test).toBeUndefined();
  });

  it('should handle empty path string safely', () => {
    const customMapping = { fields: { val: { path: '' } } };

    const result = normalizeWithMapping({}, 'device1', customMapping);

    expect(result!.data.val).toBeUndefined();
  });

  it('should handle array as message safely', () => {
    const result = normalizeWithMapping([], 'device1', {
      fields: { val: { path: '0' } },
    });

    expect(result).not.toBeNull();
  });

  it('should safely handle objects with circular references', () => {
    const message: any = { a: 1 };
    message.self = message;

    const customMapping = { fields: { val: { path: 'a' } } };

    const result = normalizeWithMapping(message, 'device1', customMapping);

    expect(result!.data.val).toBe(1);
  });

  it('should log warning when message is invalid', () => {
    const warnSpy = jest.spyOn(logger, 'warn');
    normalizeWithMapping(null, 'device1', mapping);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Normalization aborted'),
    );
  });

  it('should ignore mapping entries without path', () => {
    const customMapping = { fields: { test: {} as any } };

    const result = normalizeWithMapping({}, 'device1', customMapping);

    expect(result!.data.test).toBeUndefined();
  });

  it('should return partial data if only some fields exist in payload', () => {
    const customMapping = {
      fields: {
        pressure: { path: 'performance.stages.p1' },
        temp: { path: 'performance.temp' },
      },
    };
    const message = { performance: { stages: { p1: 4.5 } } };

    const result = normalizeWithMapping(message, 'device1', customMapping);

    expect(result!.data.pressure).toBe(4.5);
    expect(result!.data.temp).toBeUndefined();
  });

  it('should handle large mapping definitions gracefully', () => {
    const largeMapping: any = { fields: {} };
    for (let i = 0; i < 100; i++) {
      largeMapping.fields[`key${i}`] = { path: `data.p${i}` };
    }

    const result = normalizeWithMapping({ data: {} }, 'device1', largeMapping);

    expect(Object.keys(result!.data).length).toBe(0);
  });

  it('should handle paths with special characters safely', () => {
    const customMapping = { fields: { val: { path: 'special.key' } } };
    const message = { 'special.key': 'vrijednost' };

    const result = normalizeWithMapping(message, 'device1', customMapping);
    expect(result!.data.val).toBeUndefined();
  });

  it('should handle duplicated mapping paths safely', () => {
    const customMapping = {
      fields: {
        a: { path: 'x.y' },
        b: { path: 'x.y' },
      },
    };

    const message = { x: { y: 100 } };

    const result = normalizeWithMapping(message, 'device1', customMapping);

    expect(result!.data.a).toBe(100);
    expect(result!.data.b).toBe(100);
  });

  it('should safely ignore constructor access attempts', () => {
    const customMapping = {
      fields: {
        test: { path: 'constructor.name' },
      },
    };

    const result = normalizeWithMapping({}, 'device1', customMapping);

    expect(result!.data.test).toBeUndefined();
  });

  it('should safely ignore direct prototype path access', () => {
    const customMapping = {
      fields: {
        test: { path: 'prototype.test' },
      },
    };

    const result = normalizeWithMapping({}, 'device1', customMapping);

    expect(result!.data.test).toBeUndefined();
  });

  it('should throw ConfigMissingException when mapping.fields is missing', () => {
    expect(() =>
      normalizeWithMapping({}, 'device1', {} as any),
    ).toThrow(ConfigMissingException);
  });

  it('should return null for string message', () => {
    const result = normalizeWithMapping('invalid', 'device1', mapping);

    expect(result).toBeNull();
  });

  it('should return null for numeric message', () => {
    const result = normalizeWithMapping(123, 'device1', mapping);

    expect(result).toBeNull();
  });

  describe('Array Mapping Operations (array, min, max)', () => {
    it("should return entire array when operation is 'array' or omitted", () => {
      const customMapping = {
        fields: {
          samplesArray: { path: 'metrics.samples', operation: 'array' as const },
          samplesDefault: { path: 'metrics.samples' },
        },
      };
      const message = { metrics: { samples: [10, 20, 30] } };

      const result = normalizeWithMapping(message, 'device1', customMapping);

      expect(result!.data.samplesArray).toEqual([10, 20, 30]);
      expect(result!.data.samplesDefault).toEqual([10, 20, 30]);
    });

    it("should calculate correct 'min' and 'max' values from array", () => {
      const customMapping = {
        fields: {
          minTemp: { path: 'readings.temperatures', operation: 'min' as const },
          maxTemp: { path: 'readings.temperatures', operation: 'max' as const },
        },
      };
      const message = { readings: { temperatures: [12.5, 4.2, 18.0, 9.1] } };

      const result = normalizeWithMapping(message, 'device1', customMapping);

      expect(result!.data.minTemp).toBe(4.2);
      expect(result!.data.maxTemp).toBe(18.0);
    });

    it('should convert numeric strings inside array for min/max', () => {
      const customMapping = {
        fields: {
          minVal: { path: 'data.values', operation: 'min' as const },
          maxVal: { path: 'data.values', operation: 'max' as const },
        },
      };
      const message = { data: { values: ['15', '3', 8] } };

      const result = normalizeWithMapping(message, 'device1', customMapping);

      expect(result!.data.minVal).toBe(3);
      expect(result!.data.maxVal).toBe(15);
    });

    it('should handle empty arrays by returning undefined', () => {
      const customMapping = {
        fields: {
          minVal: { path: 'data.empty', operation: 'min' as const },
        },
      };
      const message = { data: { empty: [] } };

      const result = normalizeWithMapping(message, 'device1', customMapping);

      expect(result!.data.minVal).toBeUndefined();
      expect(result!.data).not.toHaveProperty('minVal');
    });

    it('should skip min/max calculation when value at path is NOT an array (e.g. primitive number)', () => {
      const customMapping = {
        fields: {
          minVal: { path: 'data.single', operation: 'min' as const },
          maxVal: { path: 'data.single', operation: 'max' as const },
        },
      };
      const message = { data: { single: 42 } };

      const result = normalizeWithMapping(message, 'device1', customMapping);

      expect(result!.data.minVal).toBeUndefined();
      expect(result!.data.maxVal).toBeUndefined();
    });

    it('should ignore non-numeric array items safely', () => {
      const customMapping = {
        fields: {
          minVal: { path: 'data.mixed', operation: 'min' as const },
        },
      };
      const message = { data: { mixed: ['invalid', null, 10, 5, undefined] } };

      const result = normalizeWithMapping(message, 'device1', customMapping);

      expect(result!.data.minVal).toBe(5);
    });

    it('should extract min/max correctly from tuple array [value, timestamp]', () => {
      const customMapping = {
        fields: {
          minPower: { path: 'historicalTelemetry.kw', operation: 'min' as const },
          maxPower: { path: 'historicalTelemetry.kw', operation: 'max' as const },
        },
      };

      const message = {
        historicalTelemetry: {
          kw: [
            [150.5, '2026-08-18T10:00:00Z'],
            [45.2, '2026-08-18T10:05:00Z'],
            [210.0, '2026-08-18T10:10:00Z'],
          ],
        },
      };

      const result = normalizeWithMapping(message, 'device1', customMapping);

      expect(result!.data.minPower).toBe(45.2);
      expect(result!.data.maxPower).toBe(210.0);
    });

    it('should not expose raw history keys', () => {
      const mapping = {
        fields: {
          powerDraw: {
            path: 'performance.electrical.kw',
            historyPath: 'historicalTelemetry.kw',
          },
        },
      };

      const message = {
        historicalTelemetry: {
          kw: [[100, '2026']],
        },
      };

      const result = normalizeWithMapping(message, 'device1', mapping);

      expect(result!.data.historicalTelemetry.kw).toBeUndefined();
    });

    it('should map multiple history fields', () => {
      const mapping = {
        fields: {
          powerDraw: {
            path: 'x',
            historyPath: 'historicalTelemetry.kw',
          },
          pressStage1: {
            path: 'y',
            historyPath: 'historicalTelemetry.p1',
          },
        },
      };

      const message = {
        historicalTelemetry: {
          kw: [[100, 'a']],
          p1: [[5, 'b']],
        },
      };

      const result = normalizeWithMapping(message, 'device1', mapping);

      expect(result!.data.historicalTelemetry.powerDraw).toEqual([[100, 'a']]);
      expect(result!.data.historicalTelemetry.pressStage1).toEqual([[5, 'b']]);
    });

    it('should map historyPath fields into normalized historicalTelemetry', () => {
      const mapping = {
        fields: {
          powerDraw: {
            path: 'performance.electrical.kw',
            historyPath: 'historicalTelemetry.kw',
          },
        },
      };

      const message = {
        historicalTelemetry: {
          kw: [
            [100, '2026-01-01T10:00:00Z'],
            [200, '2026-01-01T10:01:00Z'],
          ],
        },
      };

      const result = normalizeWithMapping(message, 'device1', mapping);

      expect(result!.data.historicalTelemetry.powerDraw).toEqual([
        [100, '2026-01-01T10:00:00Z'],
        [200, '2026-01-01T10:01:00Z'],
      ]);
    });

    it('should ignore missing historyPath values', () => {
      const mapping = {
        fields: {
          powerDraw: {
            path: 'performance.kw',
            historyPath: 'historicalTelemetry.kw',
          },
        },
      };

      const result = normalizeWithMapping({}, 'device1', mapping);

      expect(result!.data.historicalTelemetry).toBeUndefined();
    });

    it('should map kw history to powerDraw history', () => {
      const mapping = {
        fields: {
          powerDraw: {
            path: 'performance.electrical.kw',
            historyPath: 'historicalTelemetry.kw',
          },
        },
      };

      const message = {
        historicalTelemetry: {
          kw: [
            [124.9, '2026-08-19T11:29:18.561Z'],
            [179.2, '2026-08-19T11:29:38.580Z'],
          ],
        },
      };

      const result = normalizeWithMapping(message, 'device1', mapping);

      expect(result!.data.historicalTelemetry.powerDraw).toHaveLength(2);
    });

    it('should not create empty historicalTelemetry object', () => {
      const mapping = {
        fields: {
          powerDraw: {
            path: 'performance.electrical.kw',
            historyPath: 'historicalTelemetry.kw',
          },
        },
      };

      const result = normalizeWithMapping({}, 'device1', mapping);

      expect(result!.data.historicalTelemetry).toBeUndefined();
    });

    it('should map history even when current path value does not exist', () => {
      const mapping = {
        fields: {
          powerDraw: {
            path: 'performance.electrical.kw',
            historyPath: 'historicalTelemetry.kw',
          },
        },
      };

      const message = {
        historicalTelemetry: {
          kw: [[100, '2026']],
        },
      };

      const result = normalizeWithMapping(message, 'device1', mapping);

      expect(result!.data.historicalTelemetry.powerDraw).toEqual([[100, '2026']]);
    });

    it('should aggregate all mapped history fields into one historicalTelemetry object', () => {
      const mapping = {
        fields: {
          powerDraw: {
            path: 'x',
            historyPath: 'historicalTelemetry.kw',
          },
          airflow: {
            path: 'y',
            historyPath: 'historicalTelemetry.flow',
          },
          powerFactor: {
            path: 'z',
            historyPath: 'historicalTelemetry.pf',
          },
        },
      };

      const message = {
        historicalTelemetry: {
          kw: [[100, 'a']],
          flow: [[20, 'b']],
          pf: [[0.9, 'c']],
        },
      };

      const result = normalizeWithMapping(message, 'device1', mapping);

      expect(result!.data.historicalTelemetry).toEqual({
        powerDraw: [[100, 'a']],
        airflow: [[20, 'b']],
        powerFactor: [[0.9, 'c']],
      });
    });

    it('should aggregate multiple history mappings', () => {
      const mapping = {
        fields: {
          powerDraw: {
            path: 'x',
            historyPath: 'historicalTelemetry.kw',
          },
          airflow: {
            path: 'y',
            historyPath: 'historicalTelemetry.flow',
          },
        },
      };

      const result = normalizeWithMapping(
        {
          historicalTelemetry: {
            kw: [[100, 'a']],
            flow: [[20, 'b']],
          },
        },
        'device1',
        mapping,
      );

      expect(result!.data.historicalTelemetry).toEqual({
        powerDraw: [[100, 'a']],
        airflow: [[20, 'b']],
      });
    });

    it('should map history even when current value is missing', () => {
      const mapping = {
        fields: {
          powerDraw: {
            path: 'performance.electrical.kw',
            historyPath: 'historicalTelemetry.kw',
          },
        },
      };

      const result = normalizeWithMapping(
        {
          historicalTelemetry: {
            kw: [[100, '2026']],
          },
        },
        'device1',
        mapping,
      );

      expect(result!.data.historicalTelemetry.powerDraw).toEqual([[100, '2026']]);
    });

    it('should support compressor vibration metadata mapping', () => {
      const mapping = {
        fields: {
          vibrationHistory: {
            path: 'historicalTelemetry.vibration',
            operation: 'array' as const,
          },
          vibrationMin: {
            path: 'historicalTelemetry.vibration',
            operation: 'min' as const,
          },
          vibrationMax: {
            path: 'historicalTelemetry.vibration',
            operation: 'max' as const,
          },
        },
      };

      const message = {
        historicalTelemetry: {
          vibration: [
            [8, 't1'],
            [4, 't2'],
            [10, 't3'],
            [6, 't4'],
          ],
        },
      };

      const result = normalizeWithMapping(message, 'device1', mapping);

      expect(result!.data.vibrationHistory).toEqual([
        [8, 't1'],
        [4, 't2'],
        [10, 't3'],
        [6, 't4'],
      ]);

      expect(result!.data.vibrationMin).toBe(4);
    });
  });
});