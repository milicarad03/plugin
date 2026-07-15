import type { RegisteredDevice } from "./device-registry.interface";

export type DeviceTelemetry = {
  deviceId: string;
  timestamp: string;
  data: Record<string, unknown>;
};

export type DeviceStatus = {
  deviceId: string;
  timestamp: string;
  status: string;
};

export class DeviceCoreService {
  constructor(

    private readonly findByDeviceId: (deviceId: string) => Promise<RegisteredDevice | null>,
    private readonly onTelemetry?: (telemetry: DeviceTelemetry) => Promise<void> | void,
    private readonly onStatusChange?: (status: DeviceStatus) => Promise<void> | void 
  ) {}

  
  async processTelemetry(telemetry: DeviceTelemetry): Promise<{ approved: boolean; reason?: string }> {
    console.log("[PLUGIN] Procesiranje telemetrije za uređaj:", telemetry.deviceId);

   
    const device = await this.findByDeviceId(telemetry.deviceId);

    if (!device) {
      console.warn("[PLUGIN] Telemetrija odbijena. Nepoznat uređaj:", telemetry.deviceId);
      return { approved: false, reason: "UNKNOWN_DEVICE" };
    }

    console.log("[PLUGIN] Telemetrija odobrena za:", device.serialNumber);
    
   
    await this.onTelemetry?.(telemetry);

    return { approved: true };
  }

 
  async processStatus(status: DeviceStatus): Promise<void> {
    console.log("[PLUGIN] Procesiranje statusa:", status.deviceId, "->", status.status);
    
    
    await this.onStatusChange?.(status);
  }
}