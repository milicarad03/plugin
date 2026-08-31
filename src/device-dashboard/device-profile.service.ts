import { Inject, Injectable } from '@nestjs/common';
import {
  DEVICE_DASHBOARD_OPTIONS,
  type DeviceDashboardModuleOptions,
  type RegisteredDevice,
} from '../device-registry.interface';
import {
  ConfigMismatchException,
  ConfigMissingException,
  DatabaseFailureException,
  DeviceNotFoundException,
  DeviceOfflineException,
  DeviceUninitializedException,
} from '../exceptions/plugin.exceptions';
import { PluginLogger } from './plugin-logger';

@Injectable()
export class DeviceProfileService {
  private readonly logger = new PluginLogger(DeviceProfileService.name);
  private readonly cacheTtlSeconds = 60;

  constructor(
    @Inject(DEVICE_DASHBOARD_OPTIONS)
    private readonly options: DeviceDashboardModuleOptions,
  ) {}

  validateDevice(
    device: RegisteredDevice | null,
    deviceId: string,
  ): asserts device is RegisteredDevice {
    if (!device) {
      throw new DeviceNotFoundException(deviceId);
    }

    if (device.status === 'OFFLINE') {
      throw new DeviceOfflineException(deviceId);
    }

    if (device.status === 'UNINITIALIZED') {
      throw new DeviceUninitializedException(deviceId);
    }
  }

  async loadDevice(deviceId: string): Promise<RegisteredDevice | null> {
    let device: RegisteredDevice | null | undefined;
    const redisClient = this.options.redis;

    if (redisClient) {
      try {
        const cachedData = await redisClient.get(`cache:device:${deviceId}`);

        if (cachedData) {
          this.logger.debug(
            `[REDIS CACHE] HIT -> Device ${deviceId} profile loaded from Redis RAM.`,
          );
          device = JSON.parse(cachedData);
        }
      } catch (error: any) {
        this.logger.error(
          `[REDIS CACHE] Error reading from Redis: ${error.message}`,
        );
      }
    }

    if (!device) {
      this.logger.debug(
        `[REDIS CACHE] MISS -> Fetching device ${deviceId} from database.`,
      );

      try {
        device = await this.options.findDeviceById(deviceId);
      } catch (error: any) {
        this.logger.error(
          `[DATABASE] Failed loading device ${deviceId}: ${error.message}`,
        );
        throw new DatabaseFailureException(error.message);
      }

      if (device && redisClient) {
        try {
          this.logger.log(
            `[REDIS CACHE] Saving device ${deviceId} to Redis for ${this.cacheTtlSeconds}s.`,
          );
          await redisClient.set(
            `cache:device:${deviceId}`,
            JSON.stringify(device),
            'EX',
            this.cacheTtlSeconds,
          );
        } catch (error: any) {
          this.logger.error(
            `[REDIS CACHE] Error saving to Redis: ${error.message}`,
          );
        }
      }
    }

    return device ?? null;
  }

  validateDeviceConfiguration(
    device: RegisteredDevice,
    deviceId: string,
  ): void {
    if (!device.mapping) {
      this.logger.warn(
        `[DENIED] Missing mapping definitions for version: ${device.model}`,
      );
      throw new ConfigMissingException();
    }

    if (!device.schema) {
      this.logger.warn(
        `[DENIED] Missing JSON schema for version: ${device.model}`,
      );
      throw new ConfigMissingException();
    }

    if (!device.version) {
      this.logger.warn(
        `[DENIED] Missing model version for device ${deviceId}`,
      );
      throw new ConfigMissingException();
    }

    if (device.schema.properties?.schemaId?.const !== device.model) {
      this.logger.error(
        `[CONFIG MISMATCH] Device ${deviceId} is assigned to model '${device.model}', ` +
          `but its schema expects '${device.schema.properties?.schemaId?.const}'.`,
      );
      throw new ConfigMismatchException();
    }
  }

  async invalidateDeviceCache(deviceId: string): Promise<void> {
    const redisClient = this.options.redis;

    if (!redisClient) {
      this.logger.debug(
        `[REDIS CACHE] Redis not configured. Nothing to invalidate for ${deviceId}`,
      );
      return;
    }

    try {
      await redisClient.del(`cache:device:${deviceId}`);
      this.logger.log(
        `[REDIS CACHE] Invalidated device profile for ${deviceId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[REDIS CACHE] Failed to invalidate device ${deviceId}: ${error.message}`,
      );
      throw error;
    }
  }

  checkDevice(deviceId: string): Promise<RegisteredDevice | null> {
    return this.options.findDeviceById(deviceId);
  }
}
