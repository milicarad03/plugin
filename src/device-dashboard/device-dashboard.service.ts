// serverplugin/src/device-dashboard/device-dashboard.service.ts

import fs from "fs";
import path from "path";

import { Inject, Injectable } from "@nestjs/common";
import {
  DEVICE_DASHBOARD_OPTIONS,
  type DeviceDashboardModuleOptions,
  type DeviceTelemetry,
} from "../device-registry.interface";

import { validateTelemetryPayload } from "src/newvalidator";
import { normalizeUnknownDeviceModel } from "src/telemetry-normalizer";
import { LazyModuleLoader } from "@nestjs/core";
import { normalizeWithMapping } from "src/mapping-normalizer";

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

@Injectable()
export class DeviceDashboardService {
  constructor(
    @Inject(DEVICE_DASHBOARD_OPTIONS)
    private readonly options: DeviceDashboardModuleOptions,
  ) {}

  async processTelemetry(message: unknown,context: TelemetryContext): Promise<{ approved: boolean; reason?: string }> {
    console.log("[PLUGIN] Primljen raw telemetry payload za procesiranje");

    const deviceId = context.deviceId;

    if (!deviceId) {
      return {
        approved: false,
        reason: "MISSING_DEVICE_IDENTIFIER",
      };
    }
    const validation = validateTelemetryPayload(deviceId,message);

    if (!validation.valid) {
      console.warn("[PLUGIN] Payload odbijen. Nevalidna struktura.");
      console.warn("[PLUGIN] Validation errors:", validation.errors);

      return {
        approved: false,
        reason: "INVALID_TELEMETRY_SCHEMA",
      };
    }

    const device = await this.options.findDeviceById(deviceId);

    if (!device) {
      console.warn("[PLUGIN] Payload odbijen. Uređaj ne postoji u bazi:", deviceId);

      return {
        approved: false,
        reason: "DEVICE_NOT_FOUND",
      };
    }
    const mapping=loadMapping(deviceId);
    const telemetry=normalizeWithMapping(message,deviceId,mapping);


    if (!telemetry) {
      return {
        approved: false,
        reason: "NORMALIZATION_FAILED",
      };
    }

    await this.options.onTelemetry?.(telemetry);

    return {
      approved: true,
    };
  }

  async processStatus(statusPayload: unknown, context: TelemetryContext): Promise<void> {
    const deviceId = context.deviceId;

    if (!deviceId) {
      console.warn("[PLUGIN] Status odbijen. Nedostaje deviceId u context-u.");
      return;
    }

    const statusObject = this.asRecord(statusPayload);

    if (!statusObject) {
      console.warn("[PLUGIN] Status payload nije objekat.");
      return;
    }

    const status = String(statusObject.status ?? "unknown");
    const timestamp =
      typeof statusObject.timestamp === "string"
        ? statusObject.timestamp
        : new Date().toISOString();

    console.log("[PLUGIN] Primljen status uređaja na obradu:", deviceId, "->", status);

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