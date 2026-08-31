import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DEVICE_DASHBOARD_OPTIONS,
  type CommandDispatchContext,
  type CommandExecutionResult,
  type DeviceDashboardModuleOptions,
} from '../device-registry.interface';
import { CommandRedundancyService } from './command-redundancy.service';
import { DeviceCommandService } from './device-command.service';
import { DeviceIngestionService } from './device-ingestion.service';
import { DeviceProfileService } from './device-profile.service';
import type {
  ProcessingResult,
  TelemetryContext,
} from './device-dashboard.types';

export type {
  DeviceStatus,
  TelemetryContext,
} from './device-dashboard.types';

@Injectable()
export class DeviceDashboardService {
  private readonly profiles: DeviceProfileService;
  private readonly redundancy: CommandRedundancyService;
  private readonly ingestion: DeviceIngestionService;
  private readonly commands: DeviceCommandService;

  constructor(
    @Inject(DEVICE_DASHBOARD_OPTIONS)
    options: DeviceDashboardModuleOptions,
    @Optional() profiles?: DeviceProfileService,
    @Optional() redundancy?: CommandRedundancyService,
    @Optional() ingestion?: DeviceIngestionService,
    @Optional() commands?: DeviceCommandService,
  ) {
    this.profiles = profiles ?? new DeviceProfileService(options);
    this.redundancy = redundancy ?? new CommandRedundancyService();
    this.ingestion =
      ingestion ??
      new DeviceIngestionService(
        options,
        this.profiles,
        this.redundancy,
      );
    this.commands =
      commands ??
      new DeviceCommandService(
        options,
        this.profiles,
        this.redundancy,
      );
  }

  processTelemetry(
    message: unknown,
    context: TelemetryContext,
  ): Promise<ProcessingResult> {
    return this.ingestion.processTelemetry(message, context);
  }

  processAttributes(
    message: unknown,
    context: TelemetryContext,
  ): Promise<ProcessingResult> {
    return this.ingestion.processAttributes(message, context);
  }

  processStatus(
    statusPayload: unknown,
    context: TelemetryContext,
  ): Promise<void> {
    return this.ingestion.processStatus(statusPayload, context);
  }

  triggerDeviceTelemetry(
    deviceId: string,
    state: 'ACTIVE' | 'IDLE',
    context?: CommandDispatchContext,
  ): Promise<CommandExecutionResult> {
    return this.commands.triggerDeviceTelemetry(deviceId, state, context);
  }

  executeCommand(
    deviceId: string,
    command: string,
    payload: any,
    context?: CommandDispatchContext,
  ): Promise<CommandExecutionResult> {
    return this.commands.executeCommand(
      deviceId,
      command,
      payload,
      context,
    );
  }

  getCommandMetadata(deviceId: string) {
    return this.commands.getCommandMetadata(deviceId);
  }

  async invalidateDeviceCache(deviceId: string): Promise<void> {
    this.redundancy.clearDevice(deviceId);
    await this.profiles.invalidateDeviceCache(deviceId);
  }

  checkDevice(deviceId: string) {
    return this.profiles.checkDevice(deviceId);
  }

  getPluginStatus(deviceId: string) {
    return {
      id: deviceId,
      pluginName: 'DeviceDashboard',
      active: true,
      version: '1.0.0',
    };
  }

  getDashboardConfig() {
    return {
      theme: 'cyberpunk',
      widgets: ['battery', 'signal', 'uptime'],
    };
  }

  getDevices() {
    return [
      { id: 1, name: 'Termostat - Dnevna', status: 'online' },
      { id: 2, name: 'Pametna sijalica', status: 'offline' },
      { id: 3, name: 'IP Kamera', status: 'online' },
    ];
  }

  getSubscriptionTopics(): string[] {
    return [
      'iot/devices/+/telemetry',
      'iot/devices/+/status',
      'iot/devices/+/attributes',
    ];
  }
}
