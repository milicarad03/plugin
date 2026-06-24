import { DeviceDashboardService } from './device-dashboard.service';
import Redis from 'ioredis-mock';
import * as validator from '../newvalidator';
import * as mapper from '../mapping-normalizer';


jest.mock('../newvalidator');
jest.mock('../mapping-normalizer');

describe('DeviceDashboardService', () => {
  let service: DeviceDashboardService;
  let mockRedis: any;
  let mockOptions: any;


  const mockSchema = {
    type: "object",
    properties: { schemaId: { const: "modelF" }, value: { type: "number" } },
    required: ["schemaId", "value"]
  };

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
    await mockRedis.flushall();
    mockRedis.removeAllListeners();

    mockOptions = {
      redis: mockRedis,
      findDeviceById: jest.fn(),
      onTelemetry: jest.fn(),
      onStatusChange: jest.fn(),
    };
    service = new DeviceDashboardService(mockOptions);
    jest.clearAllMocks();
  });
  afterEach(async () => {
    if (mockRedis) {
      await mockRedis.disconnect();
    }
  
    jest.clearAllMocks();
  });

  it('should use Redis cache if data exists (Cache Hit)', async () => {
    const device = mockDevice();
    await mockRedis.set('cache:device:dev-123', JSON.stringify(device));
    mockValidator.mockReturnValue({ valid: true, errors: [] });
    mockMapper.mockReturnValue({ deviceId: 'dev-123', data: {}, timestamp: '', raw: {} });

    //findDeviceById ne sme biti pozvan ako je device u kesu
    await service.processTelemetry({ value: 50 }, { deviceId: 'dev-123' });

    expect(mockOptions.findDeviceById).not.toHaveBeenCalled();
    expect(mockValidator).toHaveBeenCalled();
  });

  it('should reject configuration mismatch', async () => {
    mockOptions.findDeviceById.mockResolvedValue({ model: 'modelF', schema: { properties: { schemaId: { const: 'WRONG_MODEL' } }},
      mapping: { fields: {} }
    });

    const result = await service.processTelemetry(
      { value: 10 },
      { deviceId: 'x' }
    );

    expect(result.reason).toBe('CONFIGURATION_MISMATCH');
  });
  it('should reject missing model version', async () => {
    mockOptions.findDeviceById.mockResolvedValue({model: null, schema: mockSchema, mapping: { fields: {} }});

    const result = await service.processTelemetry({}, { deviceId: 'x' });

    expect(result.reason).toBe('MISSING_MODEL_VERSION');
  });


  it('should process telemetry successfully', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());
    mockValidator.mockReturnValue({ valid: true, errors: [] });
    mockMapper.mockReturnValue({ deviceId: 'dev-123', data: { val: 50 }, timestamp: '2026-06-19T12:00:00Z', raw: {} });

    const result = await service.processTelemetry({ value: 50 }, { deviceId: 'dev-123' });

    expect(result.approved).toBe(true);
    //expect(mockOptions.onTelemetry).toHaveBeenCalled();
    expect(mockOptions.onTelemetry).toHaveBeenCalledWith( expect.objectContaining({deviceId: 'dev-123'}));

    const cached = await mockRedis.get('cache:device:dev-123');
    expect(cached).toBeTruthy();

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
   
    mockOptions.findDeviceById.mockResolvedValue(mockDevice({ schema: null }));
    const result = await service.processTelemetry({}, { deviceId: 'x' });
    expect(result.reason).toBe('MISSING_SCHEMA');
  });

 
  it('should reject missing mapping', async () => {
    mockOptions.findDeviceById.mockResolvedValue({
      model: 'modelF',
      schema: { properties: { schemaId: { const: 'modelF' } } },
      mapping: null 
    });

    const result = await service.processTelemetry({}, { deviceId: 'x' });
    expect(result.reason).toBe('MISSING_MAPPING');
  });

  
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

  it('should process status and normalize state to uppercase', async () => {
    const statusPayload = { status: 'online', timestamp: '2026-06-19T10:00:00Z' };
    await service.processStatus(statusPayload, { deviceId: 'dev-123' });

    expect(mockOptions.onStatusChange).toHaveBeenCalledWith('dev-123', 'ONLINE');
  });

  it('should reject status if status object is invalid', async () => {
    await service.processStatus(null, { deviceId: 'dev-123' });
    expect(mockOptions.onStatusChange).not.toHaveBeenCalled();
  });

  it('should proceed to DB fetch even if Redis fails', async () => {
    mockRedis.get = jest.fn().mockRejectedValue(new Error('Redis down'));
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());
    mockValidator.mockReturnValue({ valid: true, errors: [] });
    mockMapper.mockReturnValue({ deviceId: 'dev-1', data: {}, timestamp: '', raw: {} });

    const result = await service.processTelemetry({ value: 10 }, { deviceId: 'dev-1' });
    expect(result.approved).toBe(true);
  });

  it('should continue processing even if Redis set fails', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());
    mockValidator.mockReturnValue({ valid: true, errors: [] });
    mockMapper.mockReturnValue({ deviceId: 'dev-123', data: { val: 50 }, timestamp: '...', raw: {} });

   
    mockRedis.set = jest.fn().mockRejectedValue(new Error('Redis set failed'));

    const result = await service.processTelemetry({ value: 50 }, { deviceId: 'dev-123' });

  
    expect(result.approved).toBe(true);
  });
  it('should default status to UNKNOWN if status field is missing', async () => {
      const statusPayload = { timestamp: '2026-06-19T10:00:00Z' }; 
      await service.processStatus(statusPayload, { deviceId: 'dev-123' });

      expect(mockOptions.onStatusChange).toHaveBeenCalledWith('dev-123', 'UNKNOWN');
  });
  it('should log error if onStatusChange hook fails', async () => {
      mockOptions.onStatusChange.mockRejectedValue(new Error('DB failure'));
      const spy = jest.spyOn(service['logger'], 'error');
      
      await service.processStatus({ status: 'online' }, { deviceId: 'dev-123' });
      
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Error executing status hook: DB failure'));
  });
  it('should handle malformed non-object telemetry payload', async () => {
      mockOptions.findDeviceById.mockResolvedValue(mockDevice());
      
      const result = await service.processTelemetry(12345, { deviceId: 'dev-123' });
      
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('INVALID_PAYLOAD_FORMAT');
  });
  it('should function correctly when Redis is not provided', async () => {
      const serviceNoRedis = new DeviceDashboardService({ ...mockOptions, redis: undefined });
      mockOptions.findDeviceById.mockResolvedValue(mockDevice());
      mockValidator.mockReturnValue({ valid: true });
      mockMapper.mockReturnValue({ data: {} });

      const result = await serviceNoRedis.processTelemetry({ val: 1 }, { deviceId: 'dev-123' });
      expect(result.approved).toBe(true);
  });
  it('should fallback to DB if Redis cache JSON is invalid', async () => {
    await mockRedis.set('cache:device:dev-1', 'INVALID_JSON');

    mockOptions.findDeviceById.mockResolvedValue(mockDevice());
    mockValidator.mockReturnValue({ valid: true });
    mockMapper.mockReturnValue({ deviceId: 'dev-1', data: {}, timestamp: '', raw: {} });

    const result = await service.processTelemetry({}, { deviceId: 'dev-1' });

    expect(result.approved).toBe(true);
  });
  it('should throw if onTelemetry fails', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());
    mockValidator.mockReturnValue({ valid: true });
    mockMapper.mockReturnValue({ deviceId: 'dev-1', data: {}, timestamp: '', raw: {} });

    mockOptions.onTelemetry.mockRejectedValue(new Error('fail'));

    await expect(
      service.processTelemetry({}, { deviceId: 'dev-1' })
    ).rejects.toThrow();
  });

});