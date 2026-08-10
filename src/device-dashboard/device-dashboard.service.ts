import fs from "fs";
import path from "path";

import { Inject, Injectable, Logger, NotFoundException, ForbiddenException, HttpException} from "@nestjs/common";
import {
  DEVICE_DASHBOARD_OPTIONS,
  type DeviceDashboardModuleOptions,
  type DeviceTelemetry,
} from "../device-registry.interface";

import { validateTelemetryPayload, validateDeviceCommand } from "src/newvalidator";

import { LazyModuleLoader } from "@nestjs/core";
import { normalizeWithMapping } from "src/mapping-normalizer";
import { MappingDefinition } from "src/mapping-normalizer";
import { PluginErrorCode } from "../device-registry.interface";
import {
  DeviceNotFoundException,
  DeviceOfflineException,
  DeviceUninitializedException,
  ConfigMissingException,
  ConfigMismatchException,
  NormalizationFailedException,
  HookFailedException,
  InvalidTimestampException,
  SchemaCompileException,
  DeviceSchemaMissingException, 
  DatabaseFailureException, 
  CommandValidationException
} from '../exceptions/plugin.exceptions';

export type TelemetryContext = {
  deviceId: string;
  topic?: string;
  transport?: "mqtt" | "http" | "coap" | string;
};

export type DeviceStatus = {
  deviceId?: string;
  timestamp?: string;
  status: string;
};

class PluginLogger extends Logger {
  override debug(message: string) {
    if (process.env.LOG_LEVEL === 'debug') {
      super.debug(message);
    }
  }
}

@Injectable()
export class DeviceDashboardService  {
  constructor(
    @Inject(DEVICE_DASHBOARD_OPTIONS)
    private readonly options: DeviceDashboardModuleOptions,
  ) {
  //  this.startOfflineMonitor();
  }
  
  private readonly logger = new PluginLogger(DeviceDashboardService.name);
  private readonly DEVICE_TTL = 60 * 1000;
  private readonly CACHE_TTL = 60;

  private validateDevice(device: any, deviceId: string) {
    if (!device) {
      throw new DeviceNotFoundException(deviceId);
    }

    if (device.status === "OFFLINE") {
      throw new DeviceOfflineException(deviceId);
    }

    if (device.status === "UNINITIALIZED") {
      throw new DeviceUninitializedException(deviceId);
    }
  }

  private async loadDevice(deviceId: string) {
    let device;
    const redisClient = this.options.redis;

    if (redisClient) {
      try { 
        const cachedData = await redisClient.get( `cache:device:${deviceId}`);

        if (cachedData) {
            this.logger.debug(`[REDIS CACHE] HIT -> Device ${deviceId} profile loaded from Redis RAM.`);
            device = JSON.parse(cachedData);
        }
      } catch (err: any) {
        this.logger.error(`[REDIS CACHE] Error reading from Redis: ${err.message}`);
      }
    }

    if (!device) {
      this.logger.debug(`[REDIS CACHE] MISS -> Fetching device ${deviceId} from database.` );
      try {
        device = await this.options.findDeviceById(deviceId);
      } catch (err: any) {
        this.logger.error(`[DATABASE] Failed loading device ${deviceId}: ${err.message}`);
        throw new DatabaseFailureException(err.message);
      }
      if (device && redisClient) {
        try {
          this.logger.log(`[REDIS CACHE] Saving device ${deviceId} to Redis for ${this.CACHE_TTL}s.`);
          await redisClient.set(`cache:device:${deviceId}`, JSON.stringify(device), 'EX', this.CACHE_TTL );
        } catch (err: any) {
          this.logger.error(`[REDIS CACHE] Error saving to Redis: ${err.message}` );
        }
      }
    }
    return device;
  }

  private validateDeviceConfiguration(device: any, deviceId:string) {
    if (!device.mapping) {
      this.logger.warn(`[DENIED] Missing mapping definitions for version: ${device.model}`);
      throw new ConfigMissingException();
    }

    if (!device.schema){
      this.logger.warn(`[DENIED] Missing JSON schema for version: ${device.model}`);
      throw new ConfigMissingException();
    }
    
    if (!device.version) {
      this.logger.warn(`[DENIED] Missing model version for device ${deviceId}` );
      throw new ConfigMissingException();
    }

    if (device.schema.properties?.schemaId?.const !==  device.model) {
      this.logger.error( `[CONFIG MISMATCH] Device ${deviceId} is assigned to model '${device.model}', ` +  `but its schema expects '${device.schema.properties?.schemaId?.const}'.`);
      throw new ConfigMismatchException();
    }
  }

  private validateSchema(device: any, message: unknown) {
    const cacheKey = `${device.model}:${device.version}`;

    return validateTelemetryPayload(
      device.model,
      cacheKey,
      device.schema,
      message
    );
  }

  private async forwardTelemetry( telemetry: DeviceTelemetry, deviceId: string) {
    try {
      await this.options.onTelemetry?.(telemetry);
    } catch (err: any) {
      this.logger.error(`[HOOK] onTelemetry failed for ${deviceId}: ${err.message}`);

      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException ||
        err instanceof InvalidTimestampException
      ) {
        throw err;
      }
      throw new HookFailedException();
    }
  }

  private normalizeTelemetry(  message: unknown, deviceId: string, mapping: MappingDefinition) {
    try {
      const telemetry = normalizeWithMapping( message, deviceId, mapping);

      if (!telemetry) {
        throw new NormalizationFailedException();
      }
      return telemetry;
    } catch (err: any) {
      this.logger.error(`[NORMALIZATION] Mapping normalization failed for ${deviceId}: ${err.message}`);
      throw new NormalizationFailedException();
    }
  }

  private findTelemetryField( mapping: any,  statePath: string): string | null {
    for (const [field, config] of Object.entries<any>(mapping?.fields ?? {})) {
      if (config.path === statePath) {
        return field;
      }
    }
    return null;
  }

  private getLatestValue(latestData: any, field: string) {
    const history = latestData?.[field];

    if (!Array.isArray(history) ||  history.length === 0 ) {
      return undefined;
    }

    return history[ history.length - 1 ][0];
  }

  private isCommandRedundant(device: any, latestData: any, command: string, payload: any): boolean {
    if (command === "SET_STATE") {
      const currentState = device.telemetryState;
      const requestedState =   payload.state;
      return currentState === requestedState;
    }

    if (!latestData) {
      return false;
    }

    const commandDef = device.schema?.commands?.[command];

    if (!commandDef) {
      return false;
    }

    const statePath = commandDef["x-state-path"];
    const payloadField = commandDef["x-payload-field"];

    if (!statePath || !payloadField) {
      return false;
    }

    const telemetryField = this.findTelemetryField( device.mapping, statePath);

    if (!telemetryField) {
      return false;
    }

    const currentValue = this.getLatestValue( latestData, telemetryField);
    const requestedValue =  payload[payloadField];

    this.logger.debug(`[REDUNDANCY] command=${command} current=${currentValue} requested=${requestedValue}`);

    if (currentValue === requestedValue) {
      this.logger.warn( `[REDUNDANT] ${command} ignored`);
      return true;
    }

    return false;
  }
  
  async processTelemetry( message: unknown, context: TelemetryContext): Promise<{ approved: boolean; reason?: string }> {

    if ( typeof message !== "object" || message === null ||  Array.isArray(message)) {
      return {
        approved: false,
        reason: "INVALID_PAYLOAD_FORMAT",
      };
    }

    const deviceId = context.deviceId;
    this.logger.debug(`[START] Received telemetry for device : ${deviceId || "UNKNOWN"}`);
    
    if (!deviceId) {
      return { approved: false, reason: "MISSING_DEVICE_IDENTIFIER"};
    }

    try {
      const device = await this.loadDevice(deviceId);

      if (!device) {
        return { approved: false, reason: "DEVICE_NOT_FOUND"};
      }

      if (!device.model) {
        this.logger.warn(`[DENIED] Device ${deviceId} has no assigned model version.`);
        return { approved: false, reason: "MISSING_MODEL_VERSION"};
      }

      this.validateDeviceConfiguration(device, deviceId);
      this.logger.debug(`[VALIDATION] Running AJV structure check for model version: ${device.model}:${device.version}`);

      const validation = this.validateSchema( device, message);

      if (!validation.valid) {
        this.logger.warn(`[DENIED] Payload for device ${deviceId} failed JSON schema validation.`);
        this.logger.warn(`[VALIDATION ERRORS]: ${JSON.stringify(validation.errors)}`);
        return {approved: false, reason: "INVALID_TELEMETRY_SCHEMA"};
      }
      
      this.logger.log(`[VALIDATION] Success! Payload structure is valid.`);
      this.logger.debug(`[NORMALIZATION] Transforming device data using defined mapping rules.`);

      const telemetry = this.normalizeTelemetry( message, deviceId, device.mapping );
      this.logger.debug(`[NORMALIZATION] Transformation result: ${JSON.stringify(telemetry.data)}`);

      this.logger.debug(`[SUCCESS] Forwarding normalized data to host application via onTelemetry hook...`);
      await this.forwardTelemetry( telemetry, deviceId);
      return {
        approved: true,
      };
    } catch (error: any) {
      this.logger.error(`[ERROR] processTelemetry failed for device ${deviceId}: ${error.message}`);

      if (error instanceof DeviceNotFoundException) {
        this.logger.warn(`[NOT_FOUND] Device ${deviceId} does not exist.`);
        return { approved: false, reason: "DEVICE_NOT_FOUND" };
      }

      if (error instanceof DeviceOfflineException) {
        this.logger.warn(`[OFFLINE] Device ${deviceId} is offline.`);
        return { approved: false, reason: "DEVICE_OFFLINE" };
      }

      if (error instanceof DeviceUninitializedException) {
        this.logger.warn(`[UNINITIALIZED] Device ${deviceId} is not initialized.`);
        return { approved: false, reason: "DEVICE_UNINITIALIZED" };
      }

      if (error instanceof ConfigMissingException) {
        this.logger.warn(`[CONFIG] Device ${deviceId} is missing configuration.`);
        return { approved: false, reason: "CONFIG_MISSING" };
      }

      if (error instanceof ConfigMismatchException) {
        this.logger.warn(`[CONFIG] Device ${deviceId} has config mismatch.`);
        return { approved: false, reason: "CONFIG_MISMATCH" };
      }

      if (error instanceof NormalizationFailedException) {
        this.logger.warn(`[NORMALIZATION] Device ${deviceId} normalization failed.`);
        return { approved: false, reason: "NORMALIZATION_FAILED" };
      }

      if (error instanceof InvalidTimestampException) {
        this.logger.warn(`[TIMESTAMP] Device ${deviceId} sent invalid timestamp.`);
        throw error;
      }

      if (error instanceof SchemaCompileException) {
        this.logger.error(`[SCHEMA] Device ${deviceId} schema compilation failed.`);
        return { approved: false, reason: "SCHEMA_COMPILE_ERROR" };
      }

      if (error instanceof DatabaseFailureException) {
        this.logger.error(`[DATABASE] Database failure for device ${deviceId}.`);
        return { approved: false, reason: "DATABASE_FAILURE" };
      }

      if (error instanceof HookFailedException) {
        this.logger.error(`[HOOK] onTelemetry hook failed for device ${deviceId}.`);
        return { approved: false, reason: "HOOK_FAILED" };
      }

      this.logger.error(`[UNHANDLED] Unexpected error for device ${deviceId}: ${error.message}`);
      return { approved: false, reason: "INTERNAL_ERROR" };
    }
  }

  async processStatus(statusPayload: unknown, context: TelemetryContext): Promise<void> {
    const deviceId = context.deviceId;

    if (!deviceId) {
     this.logger.warn("[STATUS] Device status rejected. Missing deviceId.");
      return;
    }

    const statusObject = this.asRecord(statusPayload);

    if (!statusObject) {
      this.logger.warn(`[STATUS] Device ${deviceId} sent an invalid status object.`);
      return;
    }

    const status = String(statusObject.status ?? "unknown");
    const timestamp =
      typeof statusObject.timestamp === "string"
        ? statusObject.timestamp
        : new Date().toISOString();
    
    const normalizedStatus=status.toUpperCase();

    this.logger.log(`[STATUS LOG] Device: ${deviceId} changed state -> ${status.toUpperCase()}`);

    if (this.options.onStatusChange) {
      try {
        await this.options.onStatusChange(deviceId, normalizedStatus);
        this.logger.debug(`[STATUS] Status hook successfully executed for device: ${deviceId}`);
      } catch (err: any) {
        this.logger.error(`[STATUS] Error executing status hook: ${err.message}`);

        if (err instanceof NotFoundException || err instanceof ForbiddenException) {
          throw err;
        }
        throw new HookFailedException();
      }
    }
  }

  private commandLock = new Map<string, boolean>();
  
  async triggerDeviceTelemetry(deviceId: string, state: 'ACTIVE' | 'IDLE') {

    this.logger.warn(
        `[TRIGGER] device=${deviceId} requestedState=${state}`
      );

      if (this.commandLock.get(deviceId)) {
        this.logger.warn(`[LOCKED] Command for ${deviceId} ongoing. Ignore.`);
        return;
      }
    this.commandLock.set(deviceId, true);

    try{

      const device = await this.options.findDeviceById(deviceId);
      
      if (!device) {
        this.logger.error(`[ORCHESTRATION] Device ${deviceId} not found.`);
        throw new DeviceNotFoundException(deviceId);
      }
    
      this.validateDevice(device, deviceId);
      if (state === 'ACTIVE' && device.status === 'ACTIVE') return; 
      if (state === 'IDLE' && device.status === 'IDLE') return;
      const supportsSetMode = !!device.schema?.commands?.SET_MODE;

      this.logger.log(`[CONTROL] Sending state change to ${state} for device ${deviceId}`);
      if (state === 'ACTIVE') {
        if(supportsSetMode){
        await this.options.sendCommand(deviceId, 'SET_MODE', { value: 'RUNNING' });
        await new Promise(resolve => setTimeout(resolve, 500)); 
        }
        await this.options.sendCommand(deviceId, 'SET_STATE', { state: 'ACTIVE' });
      } else {
        await this.options.sendCommand(deviceId, 'SET_STATE', { state: 'IDLE' });
      }
    }catch (err:any) {

      this.logger.warn(
        `Command failed for ${deviceId}: ${err.message}`
      );

      throw err;
    } finally{
     
      this.commandLock.delete(deviceId);
    }
  }

  async executeCommand( deviceId: string, command: string, payload: any ) {
    const device = await this.options.findDeviceById(deviceId);

    this.validateDevice(device, deviceId);
    if (!device) {
     throw new DeviceNotFoundException(deviceId);
    }
    if (!device.schema) {
      throw new DeviceSchemaMissingException(deviceId);
    }
    const latest = await this.options.getLatestTelemetry(deviceId);
    
    console.log(
      "LATEST TELEMETRY:",
      JSON.stringify(latest?.data, null, 2)
    );
    if (this.isCommandRedundant(device, latest?.data, command, payload)) {
      return; 
    }

    const validation = validateDeviceCommand( device.schema, command, payload );

    if (!validation.valid) {
      throw new CommandValidationException(validation.errors);
    }

    if (command === "SET_STATE") {
      return this.triggerDeviceTelemetry(
        deviceId,
        payload.state
      );
    }

    await this.options.sendCommand( deviceId, command, payload);
  }

  private extractFields( schema: any, prefix = "", required: string[] = []): any[] {

    const result: any[] = [];

    if (!schema?.properties) {
      return result;
    }

    for (const [key, value] of Object.entries<any>(schema.properties)) {

      const path = prefix ? `${prefix}.${key}`: key;

      if (value.type === "object" && value.properties) {

        result.push(
          ...this.extractFields(value, path, value.required ?? [])
        );

        continue;
      }

     result.push({
      name: key,
      path,
      type: value.type,
      required: required.includes(key),
      enum: value.enum,
      minimum: value.minimum,
      maximum: value.maximum,
      default: value.default,
      description: value.description
    });
    }

    return result;
  }

  async getCommandMetadata(deviceId: string) {

    const device = await this.options.findDeviceById(deviceId);
    if (!device) {
       throw new DeviceNotFoundException(deviceId);
    }

    const commands = device.schema?.commands ?? {};

    return Object.entries(commands).map(
      ([commandName, commandDef]: any) => ({

        command: commandName,

        fields: this.extractFields(
          commandDef.payload,
          "",
          commandDef.payload?.required ?? []
        )
      })
    );
  }

  async invalidateDeviceCache(
    deviceId: string,
  ): Promise<void> {
    const redisClient = this.options.redis;

    if (!redisClient) {
      this.logger.debug(
        `[REDIS CACHE] Redis not configured. Nothing to invalidate for ${deviceId}`,
      );
      return;
    }

    try {
      await redisClient.del(
        `cache:device:${deviceId}`,
      );

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

  async checkDevice(deviceId: string) {
    const device = await this.options.findDeviceById(deviceId);

    if (!device) {
      return null;
    }

    return device;
  }

  getPluginStatus(deviceId: string) {
    return {
      id: deviceId,
      pluginName: "DeviceDashboard",
      active: true,
      version: "1.0.0",
    };
  }

  getDashboardConfig() {
    return {
      theme: "cyberpunk",
      widgets: ["battery", "signal", "uptime"],
    };
  }

  getDevices() {
    return [
      { id: 1, name: "Termostat - Dnevna", status: "online" },
      { id: 2, name: "Pametna sijalica", status: "offline" },
      { id: 3, name: "IP Kamera", status: "online" },
    ];
  }

  getSubscriptionTopics(): string[] {
    return [
      "iot/devices/+/telemetry",
      "iot/devices/+/status",
    ];
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      return value as Record<string, unknown>;
    }

    return null;
  }
}