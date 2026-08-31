import { Inject, Injectable } from '@nestjs/common';
import {
  DEVICE_DASHBOARD_OPTIONS,
  type CommandDispatchContext,
  type CommandExecutionResult,
  type DeviceCommandResponse,
  type DeviceDashboardModuleOptions,
} from '../device-registry.interface';
import {
  CommandValidationException,
  DeviceNotFoundException,
  DeviceSchemaMissingException,
} from '../exceptions/plugin.exceptions';
import { validateDeviceCommand } from '../newvalidator';
import { CommandRedundancyService } from './command-redundancy.service';
import { extractCommandFields } from './command-metadata';
import { DeviceProfileService } from './device-profile.service';
import { PluginLogger } from './plugin-logger';

@Injectable()
export class DeviceCommandService {
  private readonly logger = new PluginLogger(DeviceCommandService.name);
  private readonly commandQueue = new Map<string, Promise<void>>();

  constructor(
    @Inject(DEVICE_DASHBOARD_OPTIONS)
    private readonly options: DeviceDashboardModuleOptions,
    private readonly profiles: DeviceProfileService,
    private readonly redundancy: CommandRedundancyService,
  ) {}

  async executeCommand(
    deviceId: string,
    command: string,
    payload: any,
    context?: CommandDispatchContext,
  ): Promise<CommandExecutionResult> {
    return this.serializeDeviceCommand(deviceId, async () => {
      const device = await this.options.findDeviceById(deviceId);

      this.profiles.validateDevice(device, deviceId);

      if (!device.schema) {
        throw new DeviceSchemaMissingException(deviceId);
      }

      const validation = validateDeviceCommand(
        device.schema,
        command,
        payload,
        `${device.model}:${device.version}`,
      );

      if (!validation.valid) {
        throw new CommandValidationException(validation.errors);
      }

      const latest = await this.options.getLatestTelemetry(deviceId);
      const redundancy = this.redundancy.getResult(
        device,
        latest,
        command,
        payload,
      );

      if (redundancy) {
        return redundancy;
      }

      if (command === 'SET_STATE') {
        return this.triggerDeviceTelemetry(
          deviceId,
          payload.state,
          context,
        );
      }

      const response = await this.dispatchCommand(
        deviceId,
        command,
        payload,
        context,
      );

      if (response && !response.success) {
        throw new Error(response.error ?? 'DEVICE_REJECTED_COMMAND');
      }

      this.redundancy.rememberConfirmedState(
        device,
        command,
        payload,
        response ?? undefined,
      );

      return {
        status: 'DISPATCHED',
        response: response ?? undefined,
      };
    });
  }

  async triggerDeviceTelemetry(
    deviceId: string,
    state: 'ACTIVE' | 'IDLE',
    context?: CommandDispatchContext,
  ): Promise<CommandExecutionResult> {
    this.logger.warn(
      `[TRIGGER] device=${deviceId} requestedState=${state}`,
    );

    try {
      const device = await this.options.findDeviceById(deviceId);
      this.profiles.validateDevice(device, deviceId);

      if (
        device.telemetryStateUpdatedAt &&
        device.telemetryState === state &&
        this.redundancy.isFresh(
          device.telemetryStateUpdatedAt,
          15_000,
        )
      ) {
        return {
          status: 'NOOP',
          reason: 'ALREADY_APPLIED',
          observedAt: new Date(
            device.telemetryStateUpdatedAt as any,
          ).toISOString(),
        };
      }

      const supportsSetMode = Boolean(device.schema?.commands?.SET_MODE);
      this.logger.log(
        `[CONTROL] Sending state change to ${state} for device ${deviceId}`,
      );

      if (state === 'ACTIVE' && supportsSetMode) {
        const modeResponse = await this.dispatchCommand(
          deviceId,
          'SET_MODE',
          { value: 'RUNNING' },
          context,
        );

        if (modeResponse && !modeResponse.success) {
          throw new Error(
            modeResponse.error ?? 'DEVICE_REJECTED_SET_MODE',
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const response = await this.dispatchCommand(
        deviceId,
        'SET_STATE',
        { state },
        context,
      );

      if (response && !response.success) {
        throw new Error(response.error ?? 'DEVICE_REJECTED_COMMAND');
      }

      return {
        status: 'DISPATCHED',
        response: response ?? undefined,
      };
    } catch (error: any) {
      this.logger.warn(`Command failed for ${deviceId}: ${error.message}`);
      throw error;
    }
  }

  async getCommandMetadata(deviceId: string) {
    const device = await this.options.findDeviceById(deviceId);

    if (!device) {
      throw new DeviceNotFoundException(deviceId);
    }

    return Object.entries<any>(device.schema?.commands ?? {}).map(
      ([commandName, commandDefinition]) => ({
        command: commandName,
        fields: extractCommandFields(
          commandDefinition.payload,
          '',
          commandDefinition.payload?.required ?? [],
        ),
      }),
    );
  }

  private async serializeDeviceCommand<T>(
    deviceId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.commandQueue.get(deviceId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queueTail = previous.catch(() => undefined).then(() => gate);

    this.commandQueue.set(deviceId, queueTail);
    await previous.catch(() => undefined);

    try {
      return await action();
    } finally {
      release();

      if (this.commandQueue.get(deviceId) === queueTail) {
        this.commandQueue.delete(deviceId);
      }
    }
  }

  private dispatchCommand(
    deviceId: string,
    command: string,
    payload: any,
    context?: CommandDispatchContext,
  ): Promise<DeviceCommandResponse | void> {
    if (context?.correlationId) {
      return this.options.sendCommand(
        deviceId,
        command,
        payload,
        context,
      );
    }

    return this.options.sendCommand(deviceId, command, payload);
  }
}
