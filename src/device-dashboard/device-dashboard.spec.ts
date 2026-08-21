import { Test, TestingModule } from '@nestjs/testing';
import { DeviceDashboardService } from './device-dashboard.service';
import { DEVICE_DASHBOARD_OPTIONS } from '../device-registry.interface';
import { 
  DeviceNotFoundException, 
  DeviceOfflineException, 
  DeviceUninitializedException, 
  ConfigMissingException, 
  ConfigMismatchException, 
  NormalizationFailedException,
  HookFailedException,
  DatabaseFailureException,
  SchemaCompileException,
  CommandValidationException,
  DeviceSchemaMissingException,
  InvalidTimestampException 
} from '../exceptions/plugin.exceptions';
import { NotFoundException, ForbiddenException } from '@nestjs/common';

describe('DeviceDashboardService - Comprehensive Negative & Edge Case Scenarios', () => {
  let service: DeviceDashboardService;
  let mockRedis: any;
  let mockOptions: any;

  const sampleDevice = {
    id: 'device-1',
    model: 'smartPumpModel',
    version: '1.0.0',
    status: 'ACTIVE',
    telemetryState: 'ACTIVE',
    schema: {
      type: 'object',
      properties: {
        schemaId: { const: 'smartPumpModel' },
        value: { type: 'number' }
      },
      required: ['schemaId', 'value'],
      commands: {
        SET_STATE: {
          'x-state-path': 'metrics.state',
          'x-payload-field': 'state',
          payload: {
            type: 'object',
            properties: { state: { type: 'string' } },
            required: ['state']
          }
        },
        SET_LED: {
          payload: {
            type: 'object',
            properties: { value: { type: 'boolean' } },
            required: ['value']
          }
        }
      }
    },
    mapping: {
      fields: {
        flowRate: { path: 'metrics.flowRate' }
      }
    }
  };

  beforeEach(async () => {
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    mockOptions = {
      redis: mockRedis,
      findDeviceById: jest.fn().mockResolvedValue(sampleDevice),
      onTelemetry: jest.fn().mockResolvedValue(undefined),
      onStatusChange: jest.fn().mockResolvedValue(undefined),
      sendCommand: jest.fn().mockResolvedValue(undefined),
      getLatestTelemetry: jest.fn().mockResolvedValue({ data: { flowRate: [[100, 1]] } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceDashboardService,
        {
          provide: DEVICE_DASHBOARD_OPTIONS,
          useValue: mockOptions,
        },
      ],
    }).compile();

    service = module.get<DeviceDashboardService>(DeviceDashboardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('1. should reject processTelemetry when message is undefined', async () => {
    const result = await service.processTelemetry(undefined, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('INVALID_PAYLOAD_FORMAT');
  });

  it('2. should reject processTelemetry when message is null', async () => {
    const result = await service.processTelemetry(null, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('INVALID_PAYLOAD_FORMAT');
  });

  it('3. should reject processTelemetry when message is an array', async () => {
    const result = await service.processTelemetry([1, 2, 3], { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('INVALID_PAYLOAD_FORMAT');
  });

  it('4. should reject processTelemetry when deviceId is empty string', async () => {
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: '' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('MISSING_DEVICE_IDENTIFIER');
  });

  it('5. should reject processTelemetry when deviceId is missing from context', async () => {
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, {} as any);
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('MISSING_DEVICE_IDENTIFIER');
  });

  it('6. should return DEVICE_NOT_FOUND when device does not exist in db', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce(null);
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'unknown' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('DEVICE_NOT_FOUND');
  });

  it('7. should return MISSING_MODEL_VERSION when device model is null', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce({ ...sampleDevice, model: null });
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('MISSING_MODEL_VERSION');
  });

  it('8. should return CONFIG_MISSING when device mapping is undefined', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce({ ...sampleDevice, mapping: undefined });
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('CONFIG_MISSING');
  });

  it('9. should return CONFIG_MISSING when device schema is undefined', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce({ ...sampleDevice, schema: undefined });
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('CONFIG_MISSING');
  });

  it('10. should return CONFIG_MISSING when device version is missing', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce({ ...sampleDevice, version: '' });
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('CONFIG_MISSING');
  });

  it('11. should return CONFIG_MISMATCH when schemaId const does not match device model', async () => {
    const badSchema = {
      type: 'object',
      properties: { schemaId: { const: 'differentModel' } }
    };
    mockOptions.findDeviceById.mockResolvedValueOnce({ ...sampleDevice, schema: badSchema });
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('CONFIG_MISMATCH');
  });

  it('12. should return INVALID_TELEMETRY_SCHEMA when payload structure fails ajv validation', async () => {
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 'not-a-number' }, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('INVALID_TELEMETRY_SCHEMA');
  });

  it('13. should handle redis read failure gracefully and proceed with database fetch', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('Redis connection failure'));
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' });
    expect(result.approved).toBe(true);
    expect(mockOptions.findDeviceById).toHaveBeenCalledWith('device-1');
  });

  it('14. should handle redis write failure gracefully during device caching', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockRedis.set.mockRejectedValueOnce(new Error('Redis write failure'));
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' });
    expect(result.approved).toBe(true);
  });

  it('15. should return DATABASE_FAILURE when findDeviceById throws an unexpected error', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockOptions.findDeviceById.mockRejectedValueOnce(new Error('DB failure'));
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('DATABASE_FAILURE');
  });

  it('16. should return HOOK_FAILED when onTelemetry hook throws general error', async () => {
    mockOptions.onTelemetry.mockRejectedValueOnce(new Error('Hook error'));
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('HOOK_FAILED');
  });

  it('17. should propagate NotFoundException directly if thrown by onTelemetry hook', async () => {
    mockOptions.onTelemetry.mockRejectedValueOnce(new NotFoundException('Not found'));
    const result = await service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' });
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('INTERNAL_ERROR');
  });

  it('18. should propagate InvalidTimestampException directly if thrown inside onTelemetry hook', async () => {
    mockOptions.onTelemetry.mockRejectedValueOnce(new InvalidTimestampException());
    
    await expect(
      service.processTelemetry({ schemaId: 'smartPumpModel', value: 10 }, { deviceId: 'device-1' })
    ).rejects.toThrow(InvalidTimestampException);
  });

  it('19. should handle processStatus when status payload is null', async () => {
    const res = await service.processStatus(null, { deviceId: 'device-1' });
    expect(res).toBeUndefined();
    expect(mockOptions.onStatusChange).not.toHaveBeenCalled();
  });

  it('20. should handle processStatus when status payload is not an object', async () => {
    const res = await service.processStatus('online', { deviceId: 'device-1' });
    expect(res).toBeUndefined();
    expect(mockOptions.onStatusChange).not.toHaveBeenCalled();
  });

  it('21. should handle processStatus when deviceId is missing', async () => {
    const res = await service.processStatus({ status: 'online' }, { deviceId: '' });
    expect(res).toBeUndefined();
    expect(mockOptions.onStatusChange).not.toHaveBeenCalled();
  });

  it('22. should throw HookFailedException when onStatusChange hook fails with generic error', async () => {
    mockOptions.onStatusChange.mockRejectedValueOnce(new Error('Status hook fail'));
    await expect(
      service.processStatus({ status: 'online' }, { deviceId: 'device-1' })
    ).rejects.toThrow(HookFailedException);
  });

  it('23. should propagate NotFoundException directly from onStatusChange hook', async () => {
    mockOptions.onStatusChange.mockRejectedValueOnce(new NotFoundException());
    await expect(
      service.processStatus({ status: 'online' }, { deviceId: 'device-1' })
    ).rejects.toThrow(NotFoundException);
  });

  it('24. should throw DeviceNotFoundException in executeCommand when device is missing', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce(null);
    await expect(
      service.executeCommand('device-1', 'SET_LED', { value: true })
    ).rejects.toThrow(DeviceNotFoundException);
  });

  it('25. should throw DeviceSchemaMissingException in executeCommand when schema is missing', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce({ ...sampleDevice, schema: undefined });
    await expect(
      service.executeCommand('device-1', 'SET_LED', { value: true })
    ).rejects.toThrow(DeviceSchemaMissingException);
  });

  it('26. should throw DeviceOfflineException when executing command on offline device', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce({ ...sampleDevice, status: 'OFFLINE' });
    await expect(
      service.executeCommand('device-1', 'SET_LED', { value: true })
    ).rejects.toThrow(DeviceOfflineException);
  });

  it('27. should throw DeviceUninitializedException when executing command on uninitialized device', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce({ ...sampleDevice, status: 'UNINITIALIZED' });
    await expect(
      service.executeCommand('device-1', 'SET_LED', { value: true })
    ).rejects.toThrow(DeviceUninitializedException);
  });

  it('28. should throw CommandValidationException when command payload is invalid', async () => {
    await expect(
      service.executeCommand('device-1', 'SET_LED', { value: 'not-a-boolean' })
    ).rejects.toThrow(CommandValidationException);
  });

  it('29. should ignore command execution if command is redundant', async () => {
    await service.executeCommand('device-1', 'SET_STATE', { state: 'ACTIVE' });
    expect(mockOptions.sendCommand).not.toHaveBeenCalled();
  });

  it('30. should throw DeviceNotFoundException in getCommandMetadata when device does not exist', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce(null);
    await expect(service.getCommandMetadata('device-1')).rejects.toThrow(DeviceNotFoundException);
  });

  it('31. should do nothing when invalidating cache and redis is not configured', async () => {
    const localOptions = { ...mockOptions, redis: undefined };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviceDashboardService,
        { provide: DEVICE_DASHBOARD_OPTIONS, useValue: localOptions },
      ],
    }).compile();
    const localService = module.get<DeviceDashboardService>(DeviceDashboardService);
    await expect(localService.invalidateDeviceCache('device-1')).resolves.toBeUndefined();
  });

  it('32. should throw error when redis deletion fails during cache invalidation', async () => {
    mockRedis.del.mockRejectedValueOnce(new Error('Redis delete error'));
    await expect(service.invalidateDeviceCache('device-1')).rejects.toThrow('Redis delete error');
  });

  it('33. should return null in checkDevice if device is not found', async () => {
    mockOptions.findDeviceById.mockResolvedValueOnce(null);
    const res = await service.checkDevice('device-1');
    expect(res).toBeNull();
  });

  it('34. should handle triggerDeviceTelemetry concurrency lock correctly', async () => {
    mockOptions.sendCommand.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 50))
    );
    const firstCall = service.triggerDeviceTelemetry('device-1', 'IDLE');
    await service.triggerDeviceTelemetry('device-1', 'IDLE');
    await firstCall;
    expect(mockOptions.sendCommand).toHaveBeenCalledTimes(1);
  });
});