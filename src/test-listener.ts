import { DeviceDashboardRepository } from "./device-dashboard/device-dashboard.repository";
import { MqttDevicePlugin } from "./MqttDevicePlugin";

import type { DeviceRegistry } from "./device-registry.interface";
import {RegisteredDevice} from "./device-registry.interface"

 const findDeviceById = async (
  deviceId: string,
): Promise<RegisteredDevice | null> => {
  if (deviceId === "sn-100") {
    return {
      id: "test-device-id",
      serialNumber: "sn-100",
      name: "sensor 1",
      type: "temp sensor",
    };
  }

  return null;
};

const plugin = new MqttDevicePlugin(
  "mqtt://localhost:1883",
  findDeviceById
);

plugin.connect();

process.on("SIGINT", () => {
  console.log("\n[PLUGIN] Stopping listener...");
  plugin.disconnect();
  process.exit(0);
});