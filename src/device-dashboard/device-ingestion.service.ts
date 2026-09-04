import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DEVICE_DASHBOARD_OPTIONS,
  type DeviceAttributes,
  type DeviceDashboardModuleOptions,
  type DeviceTelemetry,
} from '../device-registry.interface';
import {
  ConfigMismatchException,
  ConfigMissingException,
  DatabaseFailureException,
  DeviceNotFoundException,
  DeviceOfflineException,
  DeviceUninitializedException,
  HookFailedException,
  InvalidTimestampException,
  NormalizationFailedException,
  SchemaCompileException,
} from '../exceptions/plugin.exceptions';
import {
  validateAttributesPayload,
  validateTelemetryPayload,
} from '../newvalidator';
import {
  normalizeWithMapping,
  type MappingDefinition,
} from '../mapping-normalizer';
import { CommandRedundancyService } from './command-redundancy.service';
import { DeviceProfileService } from './device-profile.service';
import type {
  ProcessingResult,
  TelemetryContext,
} from './device-dashboard.types';
import { PluginLogger } from './plugin-logger';

@Injectable()
export class DeviceIngestionService {
  private readonly logger = new PluginLogger(DeviceIngestionService.name);

  constructor(
    @Inject(DEVICE_DASHBOARD_OPTIONS)
    private readonly options: DeviceDashboardModuleOptions,
    private readonly profiles: DeviceProfileService,
    private readonly redundancy: CommandRedundancyService,
  ) {}

  async processTelemetry(
    message: unknown,
    context: TelemetryContext,
  ): Promise<ProcessingResult> {
    if (
      typeof message !== 'object' ||
      message === null ||
      Array.isArray(message)
    ) {
      return { approved: false, reason: 'INVALID_PAYLOAD_FORMAT' };
    }

    const deviceId = context.deviceId;
    this.logger.debug(
      `[START] Received telemetry for device : ${deviceId || 'UNKNOWN'}`,
    );

    if (!deviceId) {
      return { approved: false, reason: 'MISSING_DEVICE_IDENTIFIER' };
    }

    try {
      const device = await this.profiles.loadDevice(deviceId);

      if (!device) {
        return { approved: false, reason: 'DEVICE_NOT_FOUND' };
      }

      if (!device.model) {
        this.logger.warn(
          `[DENIED] Device ${deviceId} has no assigned model version.`,
        );
        return { approved: false, reason: 'MISSING_MODEL_VERSION' };
      }

      this.profiles.validateDeviceConfiguration(device, deviceId);
      this.logger.debug(
        `[VALIDATION] Running AJV structure check for model version: ${device.model}:${device.version}`,
      );

      const validation = validateTelemetryPayload(
        device.model,
        `${device.model}:${device.version}`,
        device.schema,
        message,
      );

      if (!validation.valid) {
        this.logger.warn(
          `[DENIED] Payload for device ${deviceId} failed JSON schema validation.`,
        );
        this.logger.warn(
          `[VALIDATION ERRORS]: ${JSON.stringify(validation.errors)}`,
        );
        return { approved: false, reason: 'INVALID_TELEMETRY_SCHEMA' };
      }

      this.logger.log('[VALIDATION] Success! Payload structure is valid.');
      this.logger.debug(
        '[NORMALIZATION] Transforming device data using defined mapping rules.',
      );

      const telemetry = this.normalizeTelemetry(
        message,
        deviceId,
        device.mapping,
      );

      this.logger.debug(
        `[NORMALIZATION] Transformation result: ${JSON.stringify(telemetry.data)}`,
      );
      await this.forwardTelemetry(telemetry, deviceId);

      return { approved: true };
    } catch (error: any) {
      this.logger.error(
        `[ERROR] processTelemetry failed for device ${deviceId}: ${error.message}`,
      );

      if (error instanceof DeviceNotFoundException) {
        return { approved: false, reason: 'DEVICE_NOT_FOUND' };
      }
      if (error instanceof DeviceOfflineException) {
        return { approved: false, reason: 'DEVICE_OFFLINE' };
      }
      if (error instanceof DeviceUninitializedException) {
        return { approved: false, reason: 'DEVICE_UNINITIALIZED' };
      }
      if (error instanceof ConfigMissingException) {
        return { approved: false, reason: 'CONFIG_MISSING' };
      }
      if (error instanceof ConfigMismatchException) {
        return { approved: false, reason: 'CONFIG_MISMATCH' };
      }
      if (error instanceof NormalizationFailedException) {
        return { approved: false, reason: 'NORMALIZATION_FAILED' };
      }
      if (error instanceof InvalidTimestampException) {
        throw error;
      }
      if (error instanceof SchemaCompileException) {
        return { approved: false, reason: 'SCHEMA_COMPILE_ERROR' };
      }
      if (error instanceof DatabaseFailureException) {
        return { approved: false, reason: 'DATABASE_FAILURE' };
      }
      if (error instanceof HookFailedException) {
        return { approved: false, reason: 'HOOK_FAILED' };
      }

      return { approved: false, reason: 'INTERNAL_ERROR' };
    }
  }

  async processAttributes(
    message: unknown,
    context: TelemetryContext,
  ): Promise<ProcessingResult> {
    const attributes = this.asRecord(message);

    if (!attributes) {
      return { approved: false, reason: 'INVALID_ATTRIBUTES_FORMAT' };
    }

    const deviceId = context.deviceId?.trim();

    if (!deviceId) {
      return { approved: false, reason: 'MISSING_DEVICE_IDENTIFIER' };
    }

    try {
      const device = await this.profiles.loadDevice(deviceId);

      if (!device) {
        return { approved: false, reason: 'DEVICE_NOT_FOUND' };
      }
      if (!device.model) {
        return { approved: false, reason: 'MISSING_MODEL_VERSION' };
      }

      this.profiles.validateDeviceConfiguration(device, deviceId);
      const attributesSchema = device.schema?.properties?.attributes;

      if (!this.asRecord(attributesSchema)) {
        return { approved: false, reason: 'ATTRIBUTES_SCHEMA_MISSING' };
      }

      const validation = validateAttributesPayload(
        `${device.model}:${device.version}`,
        attributesSchema,
        attributes,
      );

      if (!validation.valid) {
        this.logger.warn(
          `[ATTRIBUTES] Invalid payload for ${deviceId}: ${JSON.stringify(validation.errors)}`,
        );
        return { approved: false, reason: 'INVALID_ATTRIBUTES_SCHEMA' };
      }

      if (
        attributes.serialNumber !== deviceId ||
        attributes.serialNumber !== device.serialNumber
      ) {
        this.logger.warn(
          `[ATTRIBUTES] Serial number mismatch for topic device ${deviceId}`,
        );
        return { approved: false, reason: 'ATTRIBUTES_ID_MISMATCH' };
      }

      const attributeFields = Object.fromEntries(
        Object.entries<any>(device.mapping?.fields ?? {}).filter(
          ([, definition]) =>
            typeof definition?.path === 'string' &&
            definition.path.startsWith('attributes.'),
        ),
      );

      if (Object.keys(attributeFields).length === 0) {
        return { approved: false, reason: 'ATTRIBUTES_MAPPING_MISSING' };
      }

      const normalized = this.normalizeTelemetry(
        { attributes },
        deviceId,
        { fields: attributeFields },
      );

      if (Object.keys(normalized.data).length === 0) {
        return { approved: false, reason: 'NORMALIZATION_FAILED' };
      }

      await this.forwardAttributes(deviceId, normalized.data);
      return { approved: true };
    } catch (error: any) {
      this.logger.error(
        `[ATTRIBUTES] Processing failed for ${deviceId}: ${error.message}`,
      );

      if (error instanceof ConfigMissingException) {
        return { approved: false, reason: 'CONFIG_MISSING' };
      }
      if (error instanceof ConfigMismatchException) {
        return { approved: false, reason: 'CONFIG_MISMATCH' };
      }
      if (error instanceof SchemaCompileException) {
        return { approved: false, reason: 'SCHEMA_COMPILE_ERROR' };
      }
      if (error instanceof DatabaseFailureException) {
        return { approved: false, reason: 'DATABASE_FAILURE' };
      }
      if (error instanceof NormalizationFailedException) {
        return { approved: false, reason: 'NORMALIZATION_FAILED' };
      }
      if (error instanceof HookFailedException) {
        return { approved: false, reason: 'HOOK_FAILED' };
      }

      return { approved: false, reason: 'INTERNAL_ERROR' };
    }
  }

  async processStatus(
    statusPayload: unknown,
    context: TelemetryContext,
  ): Promise<void> {
    const deviceId = context.deviceId;

    if (!deviceId) {
      this.logger.warn('[STATUS] Device status rejected. Missing deviceId.');
      return;
    }

    const statusObject = this.asRecord(statusPayload);

    if (!statusObject) {
      this.logger.warn(
        `[STATUS] Device ${deviceId} sent an invalid status object.`,
      );
      return;
    }

    const normalizedStatus = String(
      statusObject.status ?? 'unknown',
    ).toUpperCase();
    const isHeartbeat = statusObject.heartbeat === true;

    if (!isHeartbeat) {
      this.redundancy.clearDevice(deviceId);
    }
    this.logger.log(
      `[STATUS LOG] Device: ${deviceId} changed state -> ${normalizedStatus}`,
    );

    if (!this.options.onStatusChange) {
      return;
    }

    try {
      if (isHeartbeat) {
        await this.options.onStatusChange(deviceId, normalizedStatus, {
          heartbeat: true,
        });
      } else {
        await this.options.onStatusChange(deviceId, normalizedStatus);
      }
      this.logger.debug(
        `[STATUS] Status hook successfully executed for device: ${deviceId}`,
      );
    } catch (error: any) {
      this.logger.error(
        `[STATUS] Error executing status hook: ${error.message}`,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new HookFailedException();
    }
  }

  private normalizeTelemetry(
    message: unknown,
    deviceId: string,
    mapping: MappingDefinition,
  ): DeviceTelemetry & { raw?: unknown } {
    try {
      const telemetry = normalizeWithMapping(message, deviceId, mapping);

      if (!telemetry) {
        throw new NormalizationFailedException();
      }

      return telemetry;
    } catch (error: any) {
      this.logger.error(
        `[NORMALIZATION] Mapping normalization failed for ${deviceId}: ${error.message}`,
      );
      throw new NormalizationFailedException();
    }
  }

  private async forwardTelemetry(
    telemetry: DeviceTelemetry,
    deviceId: string,
  ): Promise<void> {
    try {
      await this.options.onTelemetry?.(telemetry);
    } catch (error: any) {
      this.logger.error(
        `[HOOK] onTelemetry failed for ${deviceId}: ${error.message}`,
      );

      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof InvalidTimestampException
      ) {
        throw error;
      }

      throw new HookFailedException();
    }
  }

  private async forwardAttributes(
    deviceId: string,
    attributes: DeviceAttributes,
  ): Promise<void> {
    if (!this.options.onAttributes) {
      this.logger.error(
        `[HOOK] onAttributes is not configured for device ${deviceId}`,
      );
      throw new HookFailedException();
    }

    try {
      await this.options.onAttributes(deviceId, attributes);
    } catch (error: any) {
      this.logger.error(
        `[HOOK] onAttributes failed for ${deviceId}: ${error.message}`,
      );
      throw new HookFailedException();
    }
  }

  private asRecord(value: unknown): Record<string, any> | null {
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      return value as Record<string, any>;
    }

    return null;
  }
}
