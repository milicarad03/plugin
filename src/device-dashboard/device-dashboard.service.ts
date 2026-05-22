// serverplugin/src/device-dashboard/device-dashboard.service.ts

import { Inject, Injectable } from "@nestjs/common";
import { DEVICE_DASHBOARD_OPTIONS } from "../device-registry.interface";
import type { DeviceDashboardModuleOptions, DeviceTelemetry } from "../device-registry.interface";

export type DeviceStatus = {
  deviceId: string;
  timestamp: string;
  status: string;
};

@Injectable()
export class DeviceDashboardService {
   
    constructor(
        @Inject(DEVICE_DASHBOARD_OPTIONS)
        private readonly options: DeviceDashboardModuleOptions,
    ) {}

    
    async processTelemetry(telemetry: DeviceTelemetry): Promise<{ approved: boolean; reason?: string }> {
        console.log('[PLUGIN] Primljen zahtev za procesiranje telemetrije:', telemetry.deviceId);

        const device = await this.options.findDeviceById(telemetry.deviceId);
        
        if (!device) {
            console.warn("[PLUGIN] Telemetrija odbijena. Uređaj ne postoji u bazi:", telemetry.deviceId);
            return { approved: false, reason: "DEVICE_NOT_FOUND" };
        }

        console.log("[PLUGIN] Uređaj odobren:", device.serialNumber);

        if (this.options.onTelemetry) {
            await this.options.onTelemetry(telemetry);
        }

        return { approved: true };
    }

  
    async processStatus(status: DeviceStatus): Promise<void> {
        console.log('[PLUGIN] Primljen status uređaja na obradu:', status.deviceId, '->', status.status);
        
    }

    
    async checkDevice(deviceId: string) {
        const device = await this.options.findDeviceById(deviceId);
        if (!device) return null;
        return device;
    }
  
    getPluginStatus(deviceId: string) {
        return { id: deviceId, pluginName: "DeviceDashboard", active: true, version: '1.0.0' };
    }

    getDashboardConfig() {
        return { theme: "cyberpunk", widgets: ['battery', 'signal', 'uptime'] };
    }
   
    getDevices() {
        return [
            { id: 1, name: 'Termostat - Dnevna', status: 'online' },
            { id: 2, name: 'Pametna sijalica', status: 'offline' },
            { id: 3, name: 'IP Kamera', status: 'online' }
        ];
    }
}