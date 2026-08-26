import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeviceDashboardService } from '../device-dashboard/device-dashboard.service';
import { clearValidatorCache } from 'src/newvalidator';
import {
  DeviceNotFoundException,
  DeviceOfflineException,
  DeviceUninitializedException,
  DeviceSchemaMissingException,
  CommandValidationException,
  InvalidTimestampException,
} from '../exceptions/plugin.exceptions';

describe('DeviceDashboardService Integration Tests', () => {
  let service: DeviceDashboardService;
  let createdServices: DeviceDashboardService[];

  let onTelemetry: jest.Mock;
  let onAttributes: jest.Mock;
  let onStatusChange: jest.Mock;
  let sendCommand: jest.Mock;
  let findDeviceById: jest.Mock;
  let getLatestTelemetry: jest.Mock;
  let mockRedis: any;

  const mockDevice = {
    id: 'dev-1',
    serialNumber: 'dev-1',
    model: 'LED_V1',
    version: '1.0.0',
    status: 'ONLINE',
    mapping: {
      fields: {
        temperature: { path: 'temperature' },
        led: { path: 'led' },
        serialNumber: { path: 'attributes.serialNumber' },
        firmware: { path: 'attributes.firmware' },
        hardwareModel: { path: 'attributes.hardwareModel' },
      },
    },
    schema: {
      type: 'object',
      properties: {
        schemaId: { const: 'LED_V1' },
        temperature: { type: 'number' },
        led: { type: 'boolean' },
        attributes: {
          type: 'object',
          additionalProperties: false,
          required: ['serialNumber', 'firmware', 'hardwareModel'],
          properties: {
            serialNumber: { type: 'string' },
            firmware: { type: 'string' },
            hardwareModel: { type: 'string' },
          },
        },
      },
      required: ['temperature'],
      commands: {
        SET_LED: {
          payload: {
            type: 'object',
            properties: { value: { type: 'boolean' } },
            required: ['value'],
          },
        },
        SET_STATE: {
          payload: {
            type: 'object',
            properties: { state: { type: 'string' } },
            required: ['state'],
          },
        },
        SET_MODE: {
          payload: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
          },
        },
      },
    },
  };

  function makeService(opts: any): DeviceDashboardService {
    const instance = new DeviceDashboardService(opts);
    createdServices.push(instance);
    return instance;
  }

  beforeEach(() => {
    jest.useRealTimers();
    createdServices = [];
    clearValidatorCache();

    onTelemetry = jest.fn();
    onAttributes = jest.fn();
    onStatusChange = jest.fn();
    sendCommand = jest.fn();
    getLatestTelemetry = jest.fn().mockResolvedValue(null);
    findDeviceById = jest.fn().mockResolvedValue(mockDevice);
    
    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    service = makeService({
      findDeviceById,
      onTelemetry,
      onAttributes,
      onStatusChange,
      sendCommand,
      getLatestTelemetry,
      redis: mockRedis,
    });
  });

  describe('processAttributes', () => {
    const validAttributes = {
      serialNumber: 'dev-1',
      firmware: '1.0.0',
      hardwareModel: 'LED_V1',
    };

    it('validates, maps and forwards a complete attributes snapshot', async () => {
      const result = await service.processAttributes(
        validAttributes,
        { deviceId: 'dev-1', transport: 'mqtt' },
      );

      expect(result).toEqual({ approved: true });
      expect(onAttributes).toHaveBeenCalledWith(
        'dev-1',
        validAttributes,
      );
      expect(onTelemetry).not.toHaveBeenCalled();
    });

    it('rejects attributes with a missing required field', async () => {
      const result = await service.processAttributes(
        {
          serialNumber: 'dev-1',
          firmware: '1.0.0',
        },
        { deviceId: 'dev-1', transport: 'mqtt' },
      );

      expect(result).toEqual({
        approved: false,
        reason: 'INVALID_ATTRIBUTES_SCHEMA',
      });
      expect(onAttributes).not.toHaveBeenCalled();
    });

    it('rejects attributes with an invalid field type', async () => {
      const result = await service.processAttributes(
        {
          ...validAttributes,
          firmware: 113,
        },
        { deviceId: 'dev-1', transport: 'mqtt' },
      );

      expect(result.reason).toBe('INVALID_ATTRIBUTES_SCHEMA');
      expect(onAttributes).not.toHaveBeenCalled();
    });

    it('rejects attributes not declared by the model schema', async () => {
      const result = await service.processAttributes(
        {
          ...validAttributes,
          unsupportedAttribute: true,
        },
        { deviceId: 'dev-1', transport: 'mqtt' },
      );

      expect(result.reason).toBe('INVALID_ATTRIBUTES_SCHEMA');
      expect(onAttributes).not.toHaveBeenCalled();
    });

    it('rejects attributes whose serial number differs from the topic', async () => {
      const result = await service.processAttributes(
        {
          ...validAttributes,
          serialNumber: 'another-device',
        },
        { deviceId: 'dev-1', transport: 'mqtt' },
      );

      expect(result.reason).toBe('ATTRIBUTES_ID_MISMATCH');
      expect(onAttributes).not.toHaveBeenCalled();
    });

    it('rejects attributes for an unknown device', async () => {
      findDeviceById.mockResolvedValue(null);

      const result = await service.processAttributes(
        validAttributes,
        { deviceId: 'dev-1', transport: 'mqtt' },
      );

      expect(result.reason).toBe('DEVICE_NOT_FOUND');
      expect(onAttributes).not.toHaveBeenCalled();
    });

    it('rejects attributes when the host persistence hook fails', async () => {
      onAttributes.mockRejectedValue(new Error('DATABASE_WRITE_FAILED'));

      const result = await service.processAttributes(
        validAttributes,
        { deviceId: 'dev-1', transport: 'mqtt' },
      );

      expect(result.reason).toBe('HOOK_FAILED');
    });
  });

  afterEach(() => {
    createdServices = [];
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('processTelemetry', () => {
    it('should process valid telemetry', async () => {
      clearValidatorCache();
      const result = await service.processTelemetry(
        { schemaId: 'LED_V1', temperature: 25 },
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(true);
      expect(onTelemetry).toHaveBeenCalledTimes(1);
    });

    it('should reject invalid schema', async () => {
      clearValidatorCache();
      const result = await service.processTelemetry(
        { invalidField: true },
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('INVALID_TELEMETRY_SCHEMA');
      expect(onTelemetry).not.toHaveBeenCalled();
    });

    it('should reject malformed (non-object) payload', async () => {
      clearValidatorCache();
      const result = await service.processTelemetry(null, { deviceId: 'dev-1' });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('INVALID_PAYLOAD_FORMAT');
      expect(onTelemetry).not.toHaveBeenCalled();
    });

    it('should reject array payload', async () => {
      clearValidatorCache();
      const result = await service.processTelemetry([1, 2, 3], { deviceId: 'dev-1' });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('INVALID_PAYLOAD_FORMAT');
    });

    it('should reject telemetry missing deviceId', async () => {
      clearValidatorCache();
      const result = await service.processTelemetry(
        { schemaId: 'LED_V1', temperature: 25 },
        {} as any,
      );

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('MISSING_DEVICE_IDENTIFIER');
    });

    it('should reject unknown device', async () => {
      clearValidatorCache();
      findDeviceById.mockResolvedValue(null);

      const result = await service.processTelemetry(
        { schemaId: 'LED_V1', temperature: 20 },
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('DEVICE_NOT_FOUND');
    });

    it('should reject device without assigned model', async () => {
      clearValidatorCache();
      findDeviceById.mockResolvedValue({ ...mockDevice, model: undefined });

      const result = await service.processTelemetry(
        { schemaId: 'LED_V1', temperature: 20 },
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('MISSING_MODEL_VERSION');
    });

    it('should return config missing when mapping is missing', async () => {
      clearValidatorCache();
      findDeviceById.mockResolvedValue({ ...mockDevice, mapping: null });

      const result = await service.processTelemetry({ schemaId: 'LED_V1', temperature: 20 }, { deviceId: 'dev-1' });
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('CONFIG_MISSING');
    });

    it('should return config missing when schema is missing', async () => {
      clearValidatorCache();
      findDeviceById.mockResolvedValue({ ...mockDevice, schema: null });

      const result = await service.processTelemetry({ schemaId: 'LED_V1', temperature: 20 }, { deviceId: 'dev-1' });
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('CONFIG_MISSING');
    });

    it('should detect config mismatch (schemaId does not match model)', async () => {
      clearValidatorCache();
      findDeviceById.mockResolvedValue({
        ...mockDevice,
        model: 'MODEL_A',
        schema: {
          properties: { schemaId: { const: 'MODEL_B' } },
        },
      });

      const result = await service.processTelemetry({ schemaId: 'MODEL_B', temperature: 20 }, { deviceId: 'dev-1' });
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('CONFIG_MISMATCH');
    });

    it('should return DATABASE_FAILURE when findDeviceById rejects', async () => {
      clearValidatorCache();
      findDeviceById.mockRejectedValue(new Error('connection timeout'));

      const result = await service.processTelemetry({ schemaId: 'LED_V1', temperature: 25 }, { deviceId: 'dev-1' });
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('DATABASE_FAILURE');
    });

    it('should return HOOK_FAILED when generic onTelemetry hook errors occur', async () => {
      clearValidatorCache();
      onTelemetry.mockRejectedValue(new Error('downstream write failed'));

      const result = await service.processTelemetry({ schemaId: 'LED_V1', temperature: 25 }, { deviceId: 'dev-1' });
      expect(result.approved).toBe(false);
      expect(result.reason).toBe('HOOK_FAILED');
    });

    it('should rethrow InvalidTimestampException when hook throws it', async () => {
      clearValidatorCache();
      onTelemetry.mockRejectedValue(new InvalidTimestampException());

      await expect(
        service.processTelemetry({ schemaId: 'LED_V1', temperature: 25 }, { deviceId: 'dev-1' })
      ).rejects.toThrow(InvalidTimestampException);
    });
  });

  describe('executeCommand', () => {
    it('should execute a valid command successfully', async () => {
      await service.executeCommand('dev-1', 'SET_LED', { value: true });

      expect(sendCommand).toHaveBeenCalledWith('dev-1', 'SET_LED', { value: true });
    });

    it('should forward command audit context to the host transport', async () => {
      await service.executeCommand(
        'dev-1',
        'SET_LED',
        { value: true },
        { correlationId: 'audit-correlation-1' },
      );

      expect(sendCommand).toHaveBeenCalledWith(
        'dev-1',
        'SET_LED',
        { value: true },
        { correlationId: 'audit-correlation-1' },
      );
    });

    it('should throw DeviceNotFoundException for an unknown device', async () => {
      findDeviceById.mockResolvedValue(null);

      await expect(
        service.executeCommand('dev-1', 'SET_LED', { value: true }),
      ).rejects.toThrow(DeviceNotFoundException);
    });

    it('should reject invalid command payload', async () => {
      await expect(
        service.executeCommand('dev-1', 'SET_LED', { value: 'wrong' }),
      ).rejects.toThrow(CommandValidationException);
    });

    it('should throw DeviceSchemaMissingException when device schema is missing', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, schema: null });

      await expect(
        service.executeCommand('dev-1', 'SET_LED', { value: true }),
      ).rejects.toThrow(DeviceSchemaMissingException);
    });

    it('should reject command for offline device', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'OFFLINE' });

      await expect(
        service.executeCommand('dev-1', 'SET_LED', { value: true }),
      ).rejects.toThrow(DeviceOfflineException);
    });

    it('should reject command for uninitialized device', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'UNINITIALIZED' });

      await expect(
        service.executeCommand('dev-1', 'SET_LED', { value: true }),
      ).rejects.toThrow(DeviceUninitializedException);
    });
  });

  describe('triggerDeviceTelemetry', () => {
    it('should trigger ACTIVE state and send SET_MODE and SET_STATE commands', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'IDLE' });

      await service.triggerDeviceTelemetry('dev-1', 'ACTIVE');

      expect(sendCommand).toHaveBeenCalledWith('dev-1', 'SET_MODE', { value: 'RUNNING' });
      expect(sendCommand).toHaveBeenCalledWith('dev-1', 'SET_STATE', { state: 'ACTIVE' });
    });

    it('should trigger IDLE state directly', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'ACTIVE' });

      await service.triggerDeviceTelemetry('dev-1', 'IDLE');

      expect(sendCommand).toHaveBeenCalledWith('dev-1', 'SET_STATE', { state: 'IDLE' });
    });
  });

  describe('getCommandMetadata', () => {
    it('should return command metadata for valid device', async () => {
      const metadata = await service.getCommandMetadata('dev-1');

      expect(metadata).toBeInstanceOf(Array);
      expect(metadata.length).toBeGreaterThan(0);
      expect(metadata.find((m: any) => m.command === 'SET_LED')).toBeDefined();
    });

    it('should throw DeviceNotFoundException if device not found in metadata request', async () => {
      findDeviceById.mockResolvedValue(null);

      await expect(service.getCommandMetadata('dev-1')).rejects.toThrow(DeviceNotFoundException);
    });
  });

  describe('Redis Caching & Device Loading', () => {
    it('should load device from Redis cache if available', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify(mockDevice));

      const res = await service.processTelemetry({ schemaId: 'LED_V1', temperature: 22 }, { deviceId: 'dev-1' });

      expect(mockRedis.get).toHaveBeenCalledWith('cache:device:dev-1');
      expect(findDeviceById).not.toHaveBeenCalled();
      expect(res.approved).toBe(true);
    });

    it('should invalidate device cache successfully', async () => {
      await service.invalidateDeviceCache('dev-1');

      expect(mockRedis.del).toHaveBeenCalledWith('cache:device:dev-1');
    });

    it('should handle missing redis client gracefully on invalidation', async () => {
      const serviceNoRedis = makeService({ findDeviceById, redis: null });
      await expect(serviceNoRedis.invalidateDeviceCache('dev-1')).resolves.not.toThrow();
    });
  });

  describe('Plugin Static Methods & Metadata', () => {
    it('should return plugin status', () => {
      const status = service.getPluginStatus('dev-1');
      expect(status.id).toBe('dev-1');
      expect(status.pluginName).toBe('DeviceDashboard');
      expect(status.active).toBe(true);
    });

    it('should return dashboard config', () => {
      const config = service.getDashboardConfig();
      expect(config.theme).toBe('cyberpunk');
      expect(config.widgets).toContain('battery');
    });

    it('should return device list', () => {
      const devices = service.getDevices();
      expect(devices.length).toBe(3);
    });

    it('should return subscription topics', () => {
      const topics = service.getSubscriptionTopics();
      expect(topics).toContain('iot/devices/+/telemetry');
      expect(topics).toContain('iot/devices/+/attributes');
    });
  });

  describe('processStatus', () => {
    it('should process a valid status update', async () => {
      await service.processStatus({ status: 'ONLINE' }, { deviceId: 'dev-1' });

      expect(onStatusChange).toHaveBeenCalledWith('dev-1', 'ONLINE');
    });

    it('should ignore status update with missing deviceId', async () => {
      await service.processStatus({ status: 'ONLINE' }, {} as any);

      expect(onStatusChange).not.toHaveBeenCalled();
    });

    it('should ignore malformed status payload', async () => {
      await service.processStatus(null, { deviceId: 'dev-1' });

      expect(onStatusChange).not.toHaveBeenCalled();
    });
  });
});