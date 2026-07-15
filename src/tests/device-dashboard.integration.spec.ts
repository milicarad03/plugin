import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeviceDashboardService } from '../device-dashboard/device-dashboard.service';
import { PluginErrorCode } from 'src/device-registry.interface';
import { clearValidatorCache } from 'src/newvalidator';

describe('DeviceDashboardService Integration Tests', () => {
  let service: DeviceDashboardService;
  let createdServices: DeviceDashboardService[];

  let onTelemetry: jest.Mock;
  let onStatusChange: jest.Mock;
  let sendCommand: jest.Mock;
  let findDeviceById: jest.Mock;
  let getLatestTelemetry: jest.Mock;

  const mockDevice = {
    id: 'dev-1',
    serialNumber: 'dev-1',
    model: 'LED_V1',
    status: 'ONLINE',
    mapping: {
      fields: {
        temperature: { path: 'temperature' },
        led: { path: 'led' },
      },
    },
    schema: {
      type: 'object',
      properties: {
        schemaId: { const: 'LED_V1' },
        temperature: { type: 'number' },
        led: { type: 'boolean' },
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
    onStatusChange = jest.fn();
    sendCommand = jest.fn();
    getLatestTelemetry = jest.fn().mockResolvedValue(null);
    findDeviceById = jest.fn().mockResolvedValue(mockDevice);

    service = makeService({
      findDeviceById,
      onTelemetry,
      onStatusChange,
      sendCommand,
      getLatestTelemetry,
    });
  });

  afterEach(() => {
   // createdServices.forEach((s) => s.onModuleDestroy());
    createdServices = [];
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------
  // processTelemetry
  // ---------------------------------------------------------------------
  describe('processTelemetry', () => {
    it('should process valid telemetry', async () => {
      const result = await service.processTelemetry(
        { temperature: 25 },
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(true);
      expect(onTelemetry).toHaveBeenCalledTimes(1);
    });

    it('should reject invalid schema', async () => {
      const result = await service.processTelemetry(
        { invalidField: true },
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('INVALID_TELEMETRY_SCHEMA');
      expect(onTelemetry).not.toHaveBeenCalled();
    });

    it('should reject malformed (non-object) payload', async () => {
      const result = await service.processTelemetry(null, { deviceId: 'dev-1' });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('INVALID_PAYLOAD_FORMAT');
      expect(onTelemetry).not.toHaveBeenCalled();
    });

    it('should reject array payload', async () => {
      const result = await service.processTelemetry([1, 2, 3], { deviceId: 'dev-1' });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('INVALID_PAYLOAD_FORMAT');
    });

    it('should reject telemetry missing deviceId', async () => {
      const result = await service.processTelemetry(
        { temperature: 25 },
        {} as any,
      );

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('MISSING_DEVICE_IDENTIFIER');
    });

    it('should reject unknown device', async () => {
      findDeviceById.mockResolvedValue(null);

      const result = await service.processTelemetry(
        { temperature: 20 },
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('DEVICE_NOT_FOUND');
    });

    it('should reject device without assigned model', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, model: undefined });

      const result = await service.processTelemetry(
        { temperature: 20 },
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('MISSING_MODEL_VERSION');
    });

    it('should throw CONFIG_MISSING when mapping is missing', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, mapping: null });

      await expect(
        service.processTelemetry({ temperature: 20 }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(PluginErrorCode.CONFIG_MISSING);
    });

    it('should throw CONFIG_MISSING when schema is missing', async () => {
 
      findDeviceById.mockResolvedValue({ ...mockDevice, schema: null });

      await expect(
        service.processTelemetry({ temperature: 20 }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(PluginErrorCode.CONFIG_MISSING);
    });

    it('should detect config mismatch (schemaId does not match model)', async () => {
      findDeviceById.mockResolvedValue({
        ...mockDevice,
        model: 'MODEL_A',
        schema: {
          properties: { schemaId: { const: 'MODEL_B' } },
        },
      });

      await expect(
        service.processTelemetry({ temperature: 20 }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(PluginErrorCode.CONFIG_MISMATCH);
    });

    it('should throw DATABASE_FAILURE when findDeviceById rejects', async () => {
      findDeviceById.mockRejectedValue(new Error('connection timeout'));

      await expect(
        service.processTelemetry({ temperature: 25 }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(PluginErrorCode.DATABASE_FAILURE);
    });

    it('should throw NORMALIZATION_FAILED when mapping has no usable fields', async () => {
      findDeviceById.mockResolvedValue({
        ...mockDevice,
        mapping: { fields: undefined },
      });

      await expect(
        service.processTelemetry({ temperature: 22 }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(PluginErrorCode.NORMALIZATION_FAILED);
    });

    it('should wrap generic onTelemetry hook errors as HOOK_FAILED', async () => {
      onTelemetry.mockRejectedValue(new Error('downstream write failed'));

      await expect(
        service.processTelemetry({ temperature: 25 }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(PluginErrorCode.HOOK_FAILED);
    });

    it('should map hook errors with message INVALID_TIMESTAMP to the correct code', async () => {
      onTelemetry.mockRejectedValue(new Error('INVALID_TIMESTAMP'));

      await expect(
        service.processTelemetry({ temperature: 25 }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(PluginErrorCode.INVALID_TIMESTAMP);
    });

    it('should rethrow NotFoundException from onTelemetry hook unchanged', async () => {
      onTelemetry.mockRejectedValue(new NotFoundException('device removed downstream'));

      await expect(
        service.processTelemetry({ temperature: 25 }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw SCHEMA_COMPILE_ERROR when the JSON schema itself is invalid', async () => {
   
      findDeviceById.mockResolvedValue({
        ...mockDevice,
        model: 'BROKEN_MODEL_V1',
        schema: {
          properties: {
            schemaId: { const: 'BROKEN_MODEL_V1' },
            temperature: { type: 'not-a-real-json-schema-type' },
          },
        },
      });

      await expect(
        service.processTelemetry({ temperature: 20 }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(PluginErrorCode.SCHEMA_COMPILE_ERROR);
    });
  });

  describe('processTelemetry - optional hooks', () => {
    it('should succeed without throwing when no onTelemetry hook is configured', async () => {
      service = makeService({
        findDeviceById,
        onStatusChange,
        sendCommand,
        getLatestTelemetry,
      });

      const result = await service.processTelemetry(
        { temperature: 25 },
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(true);
    });
  });

  describe('processTelemetry - normalized payload shape', () => {


    it('should forward correctly normalized data and strip unmapped fields', async () => {
      await service.processTelemetry(
        { temperature: 25, led: true, extraneous: 'should not appear' },
        { deviceId: 'dev-1' },
      );

      expect(onTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: 'dev-1',
          data: { temperature: 25, led: true },
        }),
      );

      const call = onTelemetry.mock.calls[0][0];
      expect(call.data).not.toHaveProperty('extraneous');
      expect(typeof call.timestamp).toBe('string');
    });

    it('should preserve falsy telemetry values instead of dropping them', async () => {
      await service.processTelemetry({ temperature: 0, led: false }, { deviceId: 'dev-1' });

      const call = onTelemetry.mock.calls[0][0];
      expect(call.data).toEqual({ temperature: 0, led: false });
    });

    it('should extract values from nested payload paths using dot notation', async () => {
      findDeviceById.mockResolvedValue({
        ...mockDevice,
        mapping: {
          fields: {
            temperature: { path: 'sensor.readings.temperature' },
          },
        },
        schema: {
            type:'object',
          properties: {
            schemaId: { const: 'LED_V1' },
            sensor: {
              type: 'object',
              properties: {
                readings: {
                  type: 'object',
                  properties: { temperature: { type: 'number' } },
                },
              },
            },
          },
          required: ['sensor'],
        },
      });

      await service.processTelemetry(
        { sensor: { readings: { temperature: 42 } } },
        { deviceId: 'dev-1' },
      );

      const call = onTelemetry.mock.calls[0][0];
      expect(call.data.temperature).toBe(42);
    });

    it('should not expose dangerous prototype-chain keys through mapping paths', async () => {
      findDeviceById.mockResolvedValue({
        ...mockDevice,
        mapping: {
          fields: {
            temperature: { path: 'temperature' },
            leakedConstructor: { path: 'constructor' },
            leakedProto: { path: '__proto__' },
          },
        },
      });

      await service.processTelemetry({ temperature: 25 }, { deviceId: 'dev-1' });

      const call = onTelemetry.mock.calls[0][0];
      expect(call.data).toEqual({ temperature: 25 });
      expect(call.data).not.toHaveProperty('leakedConstructor');
      expect(call.data).not.toHaveProperty('leakedProto');
    });
  });

  // ---------------------------------------------------------------------
  // Redis caching
  // ---------------------------------------------------------------------
  describe('redis caching', () => {
    it('should load device from redis cache when present', async () => {
      const redis = {
        get: jest.fn().mockResolvedValue(JSON.stringify(mockDevice)),
        set: jest.fn(),
      };

      service = makeService({
        redis,
        findDeviceById,
        onTelemetry,
        onStatusChange,
        sendCommand,
        getLatestTelemetry,
      });

      await service.processTelemetry({ temperature: 22 }, { deviceId: 'dev-1' });

      expect(redis.get).toHaveBeenCalled();
      expect(findDeviceById).not.toHaveBeenCalled();
    });

    it('should load device from database and cache it on a cache miss', async () => {
      const redis = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn(),
      };

      service = makeService({
        redis,
        findDeviceById,
        onTelemetry,
        onStatusChange,
        sendCommand,
        getLatestTelemetry,
      });

      await service.processTelemetry({ temperature: 25 }, { deviceId: 'dev-1' });

      expect(findDeviceById).toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalled();
    });

    it('should fall back to the database when redis read fails', async () => {
      const redis = {
        get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        set: jest.fn(),
      };

      service = makeService({
        redis,
        findDeviceById,
        onTelemetry,
        onStatusChange,
        sendCommand,
        getLatestTelemetry,
      });

      const result = await service.processTelemetry(
        { temperature: 25 },
        { deviceId: 'dev-1' },
      );

      expect(result.approved).toBe(true);
      expect(findDeviceById).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // executeCommand
  // ---------------------------------------------------------------------
  describe('executeCommand', () => {
    it('should execute a valid command successfully', async () => {
      await service.executeCommand('dev-1', 'SET_LED', { value: true });

      expect(sendCommand).toHaveBeenCalledWith('dev-1', 'SET_LED', { value: true });
    });

    it('should throw DEVICE_NOT_FOUND for an unknown device', async () => {
      findDeviceById.mockResolvedValue(null);

      await expect(
        service.executeCommand('dev-1', 'SET_LED', { value: true }),
      ).rejects.toThrow('DEVICE_NOT_FOUND');
    });

    it('should proceed with the command when the latest telemetry value differs from the requested one', async () => {
     
      getLatestTelemetry.mockResolvedValue({ data: { state: 'IDLE' } });
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'IDLE' });

      await service.executeCommand('dev-1', 'SET_STATE', { state: 'ACTIVE' });

      expect(sendCommand).toHaveBeenCalledWith('dev-1', 'SET_STATE', { state: 'ACTIVE' });
    });

    it('should reject invalid command payload', async () => {
 
      await expect(
        service.executeCommand('dev-1', 'SET_LED', { value: 'wrong' }),
      ).rejects.toThrow(/must be boolean/);
    });

    it('should reject unsupported commands', async () => {
      await expect(
        service.executeCommand('dev-1', 'UNKNOWN_CMD', {}),
      ).rejects.toThrow(/not supported/);
    });

    it('should reject command for offline device', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'OFFLINE' });

      await expect(
        service.executeCommand('dev-1', 'SET_LED', { value: true }),
      ).rejects.toThrow('DEVICE_OFFLINE');
    });

    it('should reject command for uninitialized device', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'UNINITIALIZED' });

      await expect(
        service.executeCommand('dev-1', 'SET_LED', { value: true }),
      ).rejects.toThrow('DEVICE_UNINITIALIZED');
    });

    it('should reject command when device schema is missing', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, schema: null });

      await expect(
        service.executeCommand('dev-1', 'SET_LED', { value: true }),
      ).rejects.toThrow('DEVICE_SCHEMA_MISSING');
    });

    it('should skip sending a redundant SET_STATE command', async () => {
      getLatestTelemetry.mockResolvedValue({ data: { state: 'ACTIVE' } });

      await service.executeCommand('dev-1', 'SET_STATE', { state: 'ACTIVE' });

      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('should send SET_MODE before SET_STATE when the device supports it', async () => {
      jest.useFakeTimers();

      findDeviceById.mockResolvedValue({
        ...mockDevice,
        status: 'IDLE',
        schema: {
          ...mockDevice.schema,
          commands: {
            ...mockDevice.schema.commands,
            SET_MODE: {
              payload: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value'],
              },
            },
          },
        },
      });

      const pending = service.executeCommand('dev-1', 'SET_STATE', { state: 'ACTIVE' });
      await jest.advanceTimersByTimeAsync(500);
      await pending;

      expect(sendCommand).toHaveBeenNthCalledWith(1, 'dev-1', 'SET_MODE', { value: 'RUNNING' });
      expect(sendCommand).toHaveBeenNthCalledWith(2, 'dev-1', 'SET_STATE', { state: 'ACTIVE' });

      jest.useRealTimers();
    });

    it('should throw DEVICE_NOT_FOUND if the device disappears between the initial lookup and orchestration', async () => {
   
      findDeviceById
        .mockResolvedValueOnce(mockDevice)
        .mockResolvedValueOnce(null);

      await expect(
        service.executeCommand('dev-1', 'SET_STATE', { state: 'ACTIVE' }),
      ).rejects.toThrow('DEVICE_NOT_FOUND');
    });
  });

  describe('triggerDeviceTelemetry', () => {
    it('should no-op when the device is already in the requested ACTIVE state', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'ACTIVE' });

      await service.triggerDeviceTelemetry('dev-1', 'ACTIVE');

      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('should no-op when the device is already in the requested IDLE state', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'IDLE' });

      await service.triggerDeviceTelemetry('dev-1', 'IDLE');

      expect(sendCommand).not.toHaveBeenCalled();
    });

    it('should ignore a concurrent call for the same device while one is already in flight', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'IDLE' });

      const first = service.triggerDeviceTelemetry('dev-1', 'ACTIVE');
      const second = service.triggerDeviceTelemetry('dev-1', 'ACTIVE');

      await Promise.all([first, second]);

      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(sendCommand).toHaveBeenCalledWith('dev-1', 'SET_STATE', { state: 'ACTIVE' });
    });

    it('should release the lock after completion, allowing a subsequent call to run', async () => {
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'IDLE' });

      await service.triggerDeviceTelemetry('dev-1', 'ACTIVE');
      findDeviceById.mockResolvedValue({ ...mockDevice, status: 'ACTIVE' });
      await service.triggerDeviceTelemetry('dev-1', 'IDLE');

      expect(sendCommand).toHaveBeenNthCalledWith(1, 'dev-1', 'SET_STATE', { state: 'ACTIVE' });
      expect(sendCommand).toHaveBeenNthCalledWith(2, 'dev-1', 'SET_STATE', { state: 'IDLE' });
    });
  });

  describe('getCommandMetadata', () => {
    it('should return field metadata for every supported command', async () => {
      const metadata = await service.getCommandMetadata('dev-1');

      const setLed = metadata.find((m: any) => m.command === 'SET_LED');
      expect(setLed).toEqual(
        expect.objectContaining({
            command: 'SET_LED',
        }),
        );
      expect(setLed?.fields).toEqual([
        expect.objectContaining({ name: 'value', path: 'value', type: 'boolean', required: true }),
      ]);

      const setState = metadata.find((m: any) => m.command === 'SET_STATE');
      expect(setState).toEqual(
        expect.objectContaining({
            command: 'SET_STATE',
        }),
        );
      expect(setState?.fields).toEqual([
        expect.objectContaining({ name: 'state', path: 'state', type: 'string', required: true }),
      ]);
    });

    it('should recursively extract fields from nested object payloads', async () => {
      findDeviceById.mockResolvedValue({
        ...mockDevice,
        schema: {
          ...mockDevice.schema,
          commands: {
            SET_PROFILE: {
              payload: {
                type: 'object',
                properties: {
                  profile: {
                    type: 'object',
                    required: ['brightness'],
                    properties: {
                      brightness: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      });

      const metadata = await service.getCommandMetadata('dev-1');
      const setProfile = metadata.find((m: any) => m.command === 'SET_PROFILE');
      expect(setProfile).toEqual(
        expect.objectContaining({
            command: 'SET_PROFILE',
        }),
        );

      expect(setProfile?.fields).toEqual([
        expect.objectContaining({
          name: 'brightness',
          path: 'profile.brightness',
          type: 'number',
          required: true,
        }),
      ]);
    });

    it('should return an empty command list when the device has no commands defined', async () => {
      findDeviceById.mockResolvedValue({
        ...mockDevice,
        schema: { ...mockDevice.schema, commands: undefined },
      });

      const metadata = await service.getCommandMetadata('dev-1');

      expect(metadata).toEqual([]);
    });

    it('should throw DEVICE_NOT_FOUND for an unknown device', async () => {
      findDeviceById.mockResolvedValue(null);

      await expect(service.getCommandMetadata('dev-1')).rejects.toThrow('DEVICE_NOT_FOUND');
    });
  });

  describe('checkDevice', () => {
    it('should return the device when found', async () => {
      const result = await service.checkDevice('dev-1');

      expect(result).toEqual(mockDevice);
    });

    it('should return null when the device is not found', async () => {
      findDeviceById.mockResolvedValue(null);

      const result = await service.checkDevice('dev-1');

      expect(result).toBeNull();
    });
  });

  describe('static plugin API', () => {
    it('should expose a stable plugin status shape', () => {
      expect(service.getPluginStatus('dev-1')).toEqual({
        id: 'dev-1',
        pluginName: 'DeviceDashboard',
        active: true,
        version: '1.0.0',
      });
    });

    it('should expose the MQTT subscription topics used to wire the plugin', () => {
      expect(service.getSubscriptionTopics()).toEqual([
        'iot/devices/+/telemetry',
        'iot/devices/+/status',
      ]);
    });
  });

  // ---------------------------------------------------------------------
  // processStatus
  // ---------------------------------------------------------------------
  describe('processStatus', () => {
    it('should process a valid status update', async () => {
      await service.processStatus({ status: 'ONLINE' }, { deviceId: 'dev-1' });

      expect(onStatusChange).toHaveBeenCalledWith('dev-1', 'ONLINE');
    });

    it('should ignore status update missing deviceId', async () => {
      await service.processStatus({ status: 'ONLINE' }, {} as any);

      expect(onStatusChange).not.toHaveBeenCalled();
    });

    it('should ignore malformed status payload', async () => {
      await service.processStatus(null, { deviceId: 'dev-1' });

      expect(onStatusChange).not.toHaveBeenCalled();
    });

    it('should wrap generic onStatusChange hook errors as HOOK_FAILED', async () => {
      onStatusChange.mockRejectedValue(new Error('db unavailable'));

      await expect(
        service.processStatus({ status: 'ONLINE' }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(PluginErrorCode.HOOK_FAILED);
    });

    it('should rethrow ForbiddenException from onStatusChange hook unchanged', async () => {
      onStatusChange.mockRejectedValue(new ForbiddenException('not allowed'));

      await expect(
        service.processStatus({ status: 'ONLINE' }, { deviceId: 'dev-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should default status to "UNKNOWN" when the status field is missing', async () => {
      await service.processStatus({}, { deviceId: 'dev-1' });

      expect(onStatusChange).toHaveBeenCalledWith('dev-1', 'UNKNOWN');
    });

    it('should not throw when no onStatusChange hook is configured', async () => {
      service = makeService({
        findDeviceById,
        onTelemetry,
        sendCommand,
        getLatestTelemetry,
      });

      await expect(
        service.processStatus({ status: 'ONLINE' }, { deviceId: 'dev-1' }),
      ).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // Offline monitor (setInterval)
  // ---------------------------------------------------------------------
 /* describe('offline monitor', () => {
    it('should mark a stale device offline', async () => {
      jest.useFakeTimers();

      service = makeService({
        findDeviceById,
        onTelemetry,
        onStatusChange,
        sendCommand,
        getLatestTelemetry,
      });

      (service as any).lastSeen.set('dev-1', Date.now() - 120000);

      await jest.advanceTimersByTimeAsync(30000);

      expect(onStatusChange).toHaveBeenCalledWith('dev-1', 'OFFLINE');
      expect((service as any).lastSeen.has('dev-1')).toBe(false);

      jest.useRealTimers();
    });

    it('should not touch recently seen devices', async () => {
      jest.useFakeTimers();

      service = makeService({
        findDeviceById,
        onTelemetry,
        onStatusChange,
        sendCommand,
        getLatestTelemetry,
      });

      (service as any).lastSeen.set('dev-1', Date.now());

      await jest.advanceTimersByTimeAsync(30000);

      expect(onStatusChange).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('should silently clean up stale entries for devices that no longer exist', async () => {
      jest.useFakeTimers();
      findDeviceById.mockResolvedValue(null);

      service = makeService({
        findDeviceById,
        onTelemetry,
        onStatusChange,
        sendCommand,
        getLatestTelemetry,
      });

      (service as any).lastSeen.set('dev-1', Date.now() - 120000);

      await jest.advanceTimersByTimeAsync(30000);

      expect(onStatusChange).not.toHaveBeenCalled();
      expect((service as any).lastSeen.has('dev-1')).toBe(false);

      jest.useRealTimers();
    });
  });*/
});