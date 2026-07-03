// serverplugin/src/device-dashboard/device-dashboard.service.ts

import fs from "fs";
import path from "path";

import { Inject, Injectable, Logger, NotFoundException, ForbiddenException} from "@nestjs/common";
import {
  DEVICE_DASHBOARD_OPTIONS,
  type DeviceDashboardModuleOptions,
  type DeviceTelemetry,
} from "../device-registry.interface";

import { validateTelemetryPayload } from "src/newvalidator";
import { normalizeUnknownDeviceModel } from "src/telemetry-normalizer";
import { LazyModuleLoader } from "@nestjs/core";
import { normalizeWithMapping } from "src/mapping-normalizer";
import { MappingDefinition } from "src/mapping-normalizer";
import { PluginErrorCode } from "../device-registry.interface";


function loadMapping(deviceId: string) {
  const filePath = path.join(process.cwd(), "schema", deviceId,"mapper.json");

  if (!fs.existsSync(filePath)) {
    throw new Error(`[MAPPING] Missing mapping for model: ${deviceId}`);
  }

  
  const mapping = JSON.parse(fs.readFileSync(filePath, "utf8"));

  
  if (!mapping.fields) {
    throw new Error(`[MAPPING] Invalid mapping format for ${deviceId}`);
  }

  return mapping;

}

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
export class DeviceDashboardService {
  constructor(
    @Inject(DEVICE_DASHBOARD_OPTIONS)
    private readonly options: DeviceDashboardModuleOptions,
  ) {}
  private readonly logger = new PluginLogger(DeviceDashboardService.name);
 // private deviceCache = new Map<string, { device: any; expiresAt: number }>();
  private readonly DEVICE_TTL = 60 * 1000;
  private readonly CACHE_TTL = 60;

  async processTelemetry(message: unknown,context: TelemetryContext): Promise<{ approved: boolean; reason?: string }> {

    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      this.logger.warn(`[DENIED] Malformed payload received for device ${context.deviceId}`);
      return { approved: false, reason: "INVALID_PAYLOAD_FORMAT" };
    }
    const deviceId = context.deviceId;
   /* if (this.deviceCache.size >= 1000) {
    const firstKey = this.deviceCache.keys().next().value;
  
    if (firstKey !== undefined) {
      this.deviceCache.delete(firstKey);
      this.logger.debug(`[CACHE] Evicted oldest entry from deviceCache: ${firstKey}`);
    }
  }*/
    this.logger.debug(`[START] Received telemetry for device : ${deviceId || "UNKNOWN"}`);

    if (!deviceId) {
      this.logger.warn("[DENIED] Missing deviceId in message context.");
      return { approved: false, reason: "MISSING_DEVICE_IDENTIFIER"};
    }
    const now=Date.now();

    //let cached = this.deviceCache.get(deviceId);
    let device;
    const redisClient = this.options.redis;

    if (redisClient) {
      try {
        const cachedData = await redisClient.get(`cache:device:${deviceId}`);
        if (cachedData) {
          this.logger.debug(`[REDIS CACHE] HIT -> Device ${deviceId} profile loaded from Redis RAM.`);
          device = JSON.parse(cachedData);
        }
      } catch (err: any) {
        this.logger.error(`[REDIS CACHE] Error reading from Redis: ${err.message}`);
      }
    }

    if(!device){
      this.logger.debug(`[REDIS CACHE] MISS -> Fetching device ${deviceId} from database.`);
    //  device = await this.options.findDeviceById(deviceId);
        try {
          device = await this.options.findDeviceById(deviceId);
        } catch (err: any) {
          this.logger.error(`[DATABASE] Failed loading device ${deviceId}: ${err.message}`);
          throw new Error(PluginErrorCode.DATABASE_FAILURE);
        }
  
      if (device && redisClient) {
          try {
            this.logger.log(`[REDIS CACHE] Saving device ${deviceId} to Redis for ${this.CACHE_TTL}s.`);
            await redisClient.set(
              `cache:device:${deviceId}`, 
              JSON.stringify(device), 
              'EX', 
              this.CACHE_TTL
            );
          } catch (err: any) {
            this.logger.error(`[REDIS CACHE] Error saving to Redis: ${err.message}`);
          }
        }
    }
    
    if (!device) {
    this.logger.warn(`[DENIED] Device ${deviceId} does not exist in the database.`);
      return { approved: false, reason: "DEVICE_NOT_FOUND" };
    }
    if (!device.model) {
      this.logger.warn(`[DENIED] Device ${deviceId} has no assigned model version.`);
      return {
        approved: false,
        reason: "MISSING_MODEL_VERSION",
      };
    }
    

    const map=device.mapping;
    const mapping = map as MappingDefinition;

    const sch=device.schema;

    if (!map) {
      this.logger.warn(`[DENIED] Missing mapping definitions for version: ${device.model}`);
      /*return {
        approved: false,
        reason: "MISSING_MAPPING",
      };*/
     throw new Error(PluginErrorCode.CONFIG_MISSING);
    }

    if (!sch) {
      this.logger.warn(`[DENIED] Missing JSON schema for version: ${device.model}`);
      throw new Error(PluginErrorCode.CONFIG_MISSING);
    }

    if (sch.properties?.schemaId?.const !== device.model) {
      this.logger.error(
        `[CONFIG MISMATCH] Device ${deviceId} is assigned to model '${device.model}', ` +
        `but its schema expects '${sch.properties?.schemaId?.const}'.`
      );
     throw new Error(PluginErrorCode.CONFIG_MISMATCH);
    }

    this.logger.debug(`[VALIDATION] Running AJV structure check for model version: ${device.model}`);
    
    const messageWithId = {
      schemaId: device.model, 
      ...(message as Record<string, any>) 
    };
        
    //const validation = validateTelemetryPayload(device.model,sch,messageWithId);
    let validation;
    try {
      validation = validateTelemetryPayload(device.model, sch, messageWithId);
    } catch (err: any) {
      this.logger.error(`[VALIDATION] Schema compilation failed for model ${device.model}: ${err.message}`);
      throw new Error(PluginErrorCode.SCHEMA_COMPILE_ERROR);
    }

    if (!validation.valid) {
      this.logger.warn(`[DENIED] Payload for device ${deviceId} failed JSON schema validation.`);
      this.logger.warn(`[VALIDATION ERRORS]: ${JSON.stringify(validation.errors)}`);
      return {
        approved: false,
        reason: "INVALID_TELEMETRY_SCHEMA",
      };
    }
    this.logger.log(`[VALIDATION] Success! Payload structure is valid.`);
    this.logger.debug(`[NORMALIZATION] Transforming device data using defined mapping rules.`);

    //const telemetry=normalizeWithMapping(message,deviceId,mapping);
   // let telemetry;
   // const telemetry = normalizeWithMapping(message, deviceId, device.mapping);
   // if (!telemetry) throw new Error(PluginErrorCode.NORMALIZATION_FAILED);
    let telemetry;
    try {
      telemetry = normalizeWithMapping(message, deviceId, device.mapping);
    } catch (err: any) {
      this.logger.error(`[NORMALIZATION] Mapping normalization threw for device ${deviceId}: ${err.message}`);
      throw new Error(PluginErrorCode.NORMALIZATION_FAILED);
    }
    if (!telemetry) throw new Error(PluginErrorCode.NORMALIZATION_FAILED);


   /* if (!telemetry) {
      this.logger.warn(`[DENIED] Data normalization failed for device: ${deviceId}`);
      return {approved: false,reason: "NORMALIZATION_FAILED"};
    }*/
    this.logger.debug(`[NORMALIZATION] Transformation result: ${JSON.stringify(telemetry.data)}`);

    this.logger.debug(`[SUCCESS] Forwarding normalized data to host application via onTelemetry hook...`);

   // await this.options.onTelemetry?.(telemetry);
   try {
      await this.options.onTelemetry?.(telemetry);
    } catch (err: any) {
      this.logger.error(`[HOOK] onTelemetry failed for ${deviceId}: ${err.message}`);
      if (err instanceof NotFoundException || err instanceof ForbiddenException) {
        throw err;
      }
      if (err.message === 'INVALID_TIMESTAMP') {
        throw new Error(PluginErrorCode.INVALID_TIMESTAMP);
      }
      throw new Error(PluginErrorCode.HOOK_FAILED);

    
    }

    return { approved: true };
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
        throw new Error(PluginErrorCode.HOOK_FAILED);

      }
    }
  }
  async triggerDeviceTelemetry(deviceId: string, state: 'ACTIVE' | 'IDLE') {
    const device = await this.options.findDeviceById(deviceId);
    if (!device) {
      this.logger.error(`[ORCHESTRATION] Device ${deviceId} not found.`);
      throw new NotFoundException(`Device ${deviceId} not found`);
    }
    if (device.status === 'UNINITIALIZED') {
      throw new ForbiddenException(`Device ${deviceId} is not initialized. Please complete setup.`);
    }
    if (device.status === 'OFFLINE') {
      throw new ForbiddenException(`Device ${deviceId} is currently OFFLINE. Cannot perform action.`);
    }
    this.logger.log(`[CONTROL] Sending state change to ${state} for device ${deviceId}`);
  if (state === 'ACTIVE') {
    await this.options.sendCommand(deviceId, 'SET_MODE', { value: 'RUNNING' });
    await new Promise(resolve => setTimeout(resolve, 500)); 
    await this.options.sendCommand(deviceId, 'SET_STATE', { state: 'ACTIVE' });
  } else {
    await this.options.sendCommand(deviceId, 'SET_STATE', { state: 'IDLE' });
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

  private normalizeTelemetry(message: unknown, deviceId: string): DeviceTelemetry | null {
    const messageObject = this.asRecord(message);

    if (!messageObject) {
      return null;
    }

    const telemetryObject = this.asRecord(messageObject.telemetry);

    if (!telemetryObject) {
      return null;
    }

    return {
      deviceId,
      timestamp: new Date().toISOString(),
      data: telemetryObject,
    };
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