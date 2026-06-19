import { DeviceDashboardService } from './device-dashboard.service';
import Redis from 'ioredis-mock';
import * as validator from '../newvalidator';
import * as mapper from '../mapping-normalizer';

// ✅ Mockujemo module da izolujemo servis
jest.mock('../newvalidator');
jest.mock('../mapping-normalizer');

describe('DeviceDashboardService', () => {
  let service: DeviceDashboardService;
  let mockRedis: any;
  let mockOptions: any;

  // ✅ Helper za kreiranje standardne šeme (ista kao u validator testu)
  const mockSchema = {
    type: "object",
    properties: { schemaId: { const: "modelF" }, value: { type: "number" } },
    required: ["schemaId", "value"]
  };

  // ✅ Helper za kreiranje device objekta
  function mockDevice(overrides = {}) {
    return {
      model: 'modelF',
      schema: mockSchema,
      mapping: { fields: { val: { path: 'val' } } },
      ...overrides
    };
  }

  const mockValidator = validator.validateTelemetryPayload as jest.Mock;
  const mockMapper = mapper.normalizeWithMapping as jest.Mock;

  beforeEach(async () => {
    mockRedis = new Redis();

    // 🔧 FIX: ioredis-mock deli isti in-memory store između instanci/testova.
    // Bez flushall-a, ključevi upisani u jednom testu (npr. cache:device:x)
    // ostaju vidljivi u sledećem testu i servis dobija "cache HIT" sa starim
    // (pogrešnim) device objektom umesto da pozove findDeviceById ponovo.
    await mockRedis.flushall();

    mockOptions = {
      redis: mockRedis,
      findDeviceById: jest.fn(),
      onTelemetry: jest.fn(),
    };
    service = new DeviceDashboardService(mockOptions);
    jest.clearAllMocks();
  });

  it('should process telemetry successfully', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());
    mockValidator.mockReturnValue({ valid: true, errors: [] });
    mockMapper.mockReturnValue({ deviceId: 'dev-123', data: { val: 50 }, timestamp: '2026-06-19T12:00:00Z', raw: {} });

    const result = await service.processTelemetry({ value: 50 }, { deviceId: 'dev-123' });

    expect(result.approved).toBe(true);
    expect(mockOptions.onTelemetry).toHaveBeenCalled();
  });

  it('should reject if device not found', async () => {
    mockOptions.findDeviceById.mockResolvedValue(null);
    const result = await service.processTelemetry({}, { deviceId: 'x' });
    expect(result.reason).toBe('DEVICE_NOT_FOUND');
  });

  it('should reject missing deviceId', async () => {
    const result = await service.processTelemetry({}, {} as any);
    expect(result.reason).toBe('MISSING_DEVICE_IDENTIFIER');
  });

  it('should reject missing schema', async () => {
    // Ovde eksplicitno postavljamo schema na null
    mockOptions.findDeviceById.mockResolvedValue(mockDevice({ schema: null }));
    const result = await service.processTelemetry({}, { deviceId: 'x' });
    expect(result.reason).toBe('MISSING_SCHEMA');
  });

  // ✅ MISSING MAPPING - osiguravamo da schema POSTOJI
  it('should reject missing mapping', async () => {
    mockOptions.findDeviceById.mockResolvedValue({
      model: 'modelF',
      schema: { properties: { schemaId: { const: 'modelF' } } },
      mapping: null 
    });

    const result = await service.processTelemetry({}, { deviceId: 'x' });
    expect(result.reason).toBe('MISSING_MAPPING');
  });

  // ✅ INVALID SCHEMA - osiguravamo da mapping POSTOJI
  it('should reject invalid schema payload', async () => {
    mockOptions.findDeviceById.mockResolvedValue({
      model: 'modelF',
      schema: { properties: { schemaId: { const: 'modelF' } } },
      mapping: { fields: {} }
    });
    mockValidator.mockReturnValue({ valid: false, errors: ['error'] });

    const result = await service.processTelemetry({ value: 'wrong' }, { deviceId: 'x' });
    expect(result.reason).toBe('INVALID_TELEMETRY_SCHEMA');
  });

  // ✅ NORMALIZATION FAIL - osiguravamo da mapping POSTOJI
  it('should reject if normalization fails', async () => {
    mockOptions.findDeviceById.mockResolvedValue({
      model: 'modelF',
      schema: { properties: { schemaId: { const: 'modelF' } } },
      mapping: { fields: {} }
    });
    mockValidator.mockReturnValue({ valid: true, errors: [] });
    mockMapper.mockReturnValue(null);
    
    const result = await service.processTelemetry({ value: 10 }, { deviceId: 'x' });
    expect(result.reason).toBe('NORMALIZATION_FAILED');
  });

  it('should proceed to DB fetch even if Redis fails', async () => {
    mockRedis.get = jest.fn().mockRejectedValue(new Error('Redis down'));
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());
    mockValidator.mockReturnValue({ valid: true, errors: [] });
    mockMapper.mockReturnValue({ deviceId: 'dev-1', data: {}, timestamp: '', raw: {} });

    const result = await service.processTelemetry({ value: 10 }, { deviceId: 'dev-1' });
    expect(result.approved).toBe(true);
  });
});