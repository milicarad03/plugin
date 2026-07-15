import { DeviceDashboardService } from './device-dashboard.service';
import Redis from 'ioredis-mock';
import * as validator from '../newvalidator';
import * as mapper from '../mapping-normalizer';

import { PluginErrorCode } from 'src/device-registry.interface';
import { ForbiddenException , NotFoundException} from '@nestjs/common';
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
      sendCommand: jest.fn(),
      getLatestTelemetry: jest.fn(),
    };
    service = new DeviceDashboardService(mockOptions);
    jest.clearAllMocks();
  });
  afterEach(async () => {
      
   // service.onModuleDestroy();

    if (mockRedis) {
      await mockRedis.disconnect();
    }

    jest.clearAllMocks();
    jest.restoreAllMocks();

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
  it('should throw PluginErrorCode.CONFIG_MISMATCH if configuration mismatch occurs', async () => {
    mockOptions.findDeviceById.mockResolvedValue({ 
      model: 'modelF', 
      schema: { properties: { schemaId: { const: 'WRONG_MODEL' } }},
      mapping: { fields: {} }
    });

    await expect(service.processTelemetry({ value: 10 }, { deviceId: 'x' }))
      .rejects.toThrow(PluginErrorCode.CONFIG_MISMATCH);
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

  it('should handle malformed non-object telemetry payload', async () => {
      mockOptions.findDeviceById.mockResolvedValue(mockDevice());
      
      const result = await service.processTelemetry(12345, { deviceId: 'dev-123' });
      
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('INVALID_PAYLOAD_FORMAT');
  });
  it('should function correctly when Redis is not provided', async () => {
      const serviceNoRedis = new DeviceDashboardService({ ...mockOptions, redis: undefined });
     // try {
        mockOptions.findDeviceById.mockResolvedValue(mockDevice());
        mockValidator.mockReturnValue({ valid: true });
        mockMapper.mockReturnValue({ data: {} });

        const result = await serviceNoRedis.processTelemetry({ val: 1 }, { deviceId: 'dev-123' });
        expect(result.approved).toBe(true);
      /*} finally {
        serviceNoRedis.onModuleDestroy();
      }*/
  });
  it('should fallback to DB if Redis cache JSON is invalid', async () => {
    await mockRedis.set('cache:device:dev-1', 'INVALID_JSON');

    mockOptions.findDeviceById.mockResolvedValue(mockDevice());
    mockValidator.mockReturnValue({ valid: true });
    mockMapper.mockReturnValue({ deviceId: 'dev-1', data: {}, timestamp: '', raw: {} });

    const result = await service.processTelemetry({}, { deviceId: 'dev-1' });
    expect(mockOptions.findDeviceById).toHaveBeenCalled();

    expect(result.approved).toBe(true);
  });

  it('should throw PluginErrorCode.DATABASE_FAILURE if findDeviceById fails', async () => {
    mockOptions.findDeviceById.mockRejectedValue(new Error('DB is down'));

    await expect(
      service.processTelemetry({ val: 1 }, { deviceId: 'dev-1' })
    ).rejects.toThrow(PluginErrorCode.DATABASE_FAILURE);
  });


  it('should throw PluginErrorCode.CONFIG_MISSING if mapping is missing', async () => {
    mockOptions.findDeviceById.mockResolvedValue({
      model: 'modelF',
      schema: { properties: { schemaId: { const: 'modelF' } } },
      mapping: null 
    });

    await expect(
      service.processTelemetry({}, { deviceId: 'dev-1' })
    ).rejects.toThrow(PluginErrorCode.CONFIG_MISSING);
  });
  

  it('should throw PluginErrorCode.HOOK_FAILED if onTelemetry hook fails', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());
    mockValidator.mockReturnValue({ valid: true });
    mockMapper.mockReturnValue({ deviceId: 'dev-1', data: {}, timestamp: '', raw: {} });
    
    mockOptions.onTelemetry.mockRejectedValue(new Error('Hook crash'));

    await expect(
      service.processTelemetry({}, { deviceId: 'dev-1' })
    ).rejects.toThrow(PluginErrorCode.HOOK_FAILED);
  });
  
  it('should throw PluginErrorCode.HOOK_FAILED if onStatusChange hook fails', async () => {
    mockOptions.onStatusChange.mockRejectedValue(new Error('DB failure'));
    
    await expect(
      service.processStatus({ status: 'online' }, { deviceId: 'dev-123' })
    ).rejects.toThrow(PluginErrorCode.HOOK_FAILED);
  });

  it('should throw PluginErrorCode.CONFIG_MISSING if schema is missing', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice({ schema: null }));
    await expect(service.processTelemetry({}, { deviceId: 'x' }))
      .rejects.toThrow(PluginErrorCode.CONFIG_MISSING);
  });
  it('should throw PluginErrorCode.SCHEMA_COMPILE_ERROR when validator throws', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());

    mockValidator.mockImplementation(() => {
      throw new Error('AJV compile failed');
    });

    await expect(
      service.processTelemetry({}, { deviceId: 'dev-1' }),
    ).rejects.toThrow(PluginErrorCode.SCHEMA_COMPILE_ERROR);
  });
  it('should throw PluginErrorCode.NORMALIZATION_FAILED when mapper throws', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());

    mockValidator.mockReturnValue({
      valid: true,
      errors: [],
    });

    mockMapper.mockImplementation(() => {
      throw new Error('mapping failed');
    });

    await expect(
      service.processTelemetry({}, { deviceId: 'dev-1' }),
    ).rejects.toThrow(PluginErrorCode.NORMALIZATION_FAILED);
  });

  it('should throw PluginErrorCode.NORMALIZATION_FAILED when mapper returns null', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());

    mockValidator.mockReturnValue({
      valid: true,
      errors: [],
    });

    mockMapper.mockReturnValue(null);

    await expect(
      service.processTelemetry({}, { deviceId: 'dev-1' }),
    ).rejects.toThrow(PluginErrorCode.NORMALIZATION_FAILED);
  });
  it('should throw PluginErrorCode.INVALID_TIMESTAMP when hook returns INVALID_TIMESTAMP', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());

    mockValidator.mockReturnValue({
      valid: true,
      errors: [],
    });

    mockMapper.mockReturnValue({
      deviceId: 'dev-1',
      data: {},
      timestamp: '',
      raw: {},
    });

    mockOptions.onTelemetry.mockRejectedValue(
      new Error('INVALID_TIMESTAMP'),
    );

    await expect(
      service.processTelemetry({}, { deviceId: 'dev-1' }),
    ).rejects.toThrow(PluginErrorCode.INVALID_TIMESTAMP);
  });
  it('should reject array payload', async () => {
    const result = await service.processTelemetry(
      [1, 2, 3],
      { deviceId: 'dev-1' },
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toBe('INVALID_PAYLOAD_FORMAT');
  });
  it('should work when onTelemetry hook is not configured', async () => {
    const serviceNoHook = new DeviceDashboardService({
      ...mockOptions,
      onTelemetry: undefined,
    });

   // try {
      mockOptions.findDeviceById.mockResolvedValue(mockDevice());

      mockValidator.mockReturnValue({
        valid: true,
        errors: [],
      });

      mockMapper.mockReturnValue({
        deviceId: 'dev-1',
        data: {},
        timestamp: '',
        raw: {},
      });

      const result = await serviceNoHook.processTelemetry(
        {},
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(true);
   /* } finally {
      serviceNoHook.onModuleDestroy();
    }*/
  });
  it('should process status when onStatusChange hook is not configured', async () => {
    const serviceNoHook = new DeviceDashboardService({
      ...mockOptions,
      onStatusChange: undefined,
    });

    //try {
      await expect(
        serviceNoHook.processStatus(
          { status: 'ONLINE' },
          { deviceId: 'dev-1' },
        ),
      ).resolves.toBeUndefined();
   /* } finally {
      serviceNoHook.onModuleDestroy();
    }*/
  });
  it('should ignore status when deviceId is missing', async () => {
    await service.processStatus(
      { status: 'ONLINE' },
      {} as any,
    );

    expect(
      mockOptions.onStatusChange,
    ).not.toHaveBeenCalled();
  });
  it('should process OFFLINE status update', async () => {
    await service.processStatus(
      { status: 'offline' },
      { deviceId: 'dev-123' },
    );

    expect(mockOptions.onStatusChange)
      .toHaveBeenCalledWith(
        'dev-123',
        'OFFLINE',
      );
  });
  it('should rethrow ForbiddenException from onTelemetry hook', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());

    mockValidator.mockReturnValue({
      valid: true,
      errors: [],
    });

    mockMapper.mockReturnValue({
      deviceId: 'dev-1',
      data: {},
      timestamp: '',
      raw: {},
    });

    const error = new ForbiddenException();

    mockOptions.onTelemetry.mockRejectedValue(error);

    await expect(
      service.processTelemetry(
        {},
        { deviceId: 'dev-1' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
  it('should rethrow NotFoundException from onTelemetry hook', async () => {
    mockOptions.findDeviceById.mockResolvedValue(mockDevice());

    mockValidator.mockReturnValue({
      valid: true,
      errors: [],
    });

    mockMapper.mockReturnValue({
      deviceId: 'dev-1',
      data: {},
      timestamp: '',
      raw: {},
    });

    mockOptions.onTelemetry.mockRejectedValue(
      new NotFoundException(),
    );

    await expect(
      service.processTelemetry(
        {},
        { deviceId: 'dev-1' },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('should rethrow ForbiddenException from status hook', async () => {
    mockOptions.onStatusChange.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      service.processStatus(
        { status: 'ONLINE' },
        { deviceId: 'dev-1' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
  it('should rethrow NotFoundException from status hook', async () => {
    mockOptions.onStatusChange.mockRejectedValue(
      new NotFoundException(),
    );

    await expect(
      service.processStatus(
        { status: 'ONLINE' },
        { deviceId: 'dev-1' },
      ),
    ).rejects.toThrow(NotFoundException);
  });

});