import mqtt, { MqttClient } from "mqtt";
//import type { DeviceRegistry } from "./device-registry.interface";
import type { RegisteredDevice } from "./device-registry.interface";
export type DeviceTelemetry = {
  deviceId: string;
  timestamp: string;
  data: Record<string, unknown>;

};
export type DeviceStatus= {
  deviceId: string;
  timestamp: string;

  status: string;
};


export class MqttDevicePlugin {
  private client: MqttClient | null = null;

  constructor(
    private readonly brokerUrl: string,
     private readonly findByDeviceId: (deviceId: string) => Promise<RegisteredDevice | null>,
     private readonly onTelemetry?:(telemetry:DeviceTelemetry)=> Promise <void> | void,
  ) {}

  connect() {
    this.client = mqtt.connect(this.brokerUrl);

    this.client.on("connect", () => {
      console.log("[PLUGIN] Connected to MQTT broker");

      this.client?.subscribe("iot/devices/+/telemetry", (error) => {
        if (error) {
          console.error("[PLUGIN] Subscribe error:", error);
          return;
        }

        console.log("[PLUGIN] Subscribed to iot/devices/+/telemetry");
      });

      this.client?.subscribe("iot/devices/+/status", (error) => {
        if (error) {
        console.error("[PLUGIN] Status subscribe error:", error);
        return;
        }

        console.log("[PLUGIN] Subscribed to iot/devices/+/status");
      });
      
    });

    this.client.on("message", (topic, payload) => {
       this.handleMessage(topic, payload).catch((error) => {
        console.error("[PLUGIN] Failed to handle MQTT message:", error);
      });
    });

    this.client.on("error", (error) => {
      console.error("[PLUGIN] MQTT error:", error);
    });
  }

  disconnect() {
    this.client?.end();
    this.client = null;
  }

  private async handleMessage(topic: string, payload: Buffer) {
   try {
      const message = JSON.parse(payload.toString());

      if (topic.endsWith("/telemetry")) {
        const telemetry = message as DeviceTelemetry;

        console.log("[PLUGIN] Telemetry received");
        console.log("Topic:", topic);
        console.log("Device ID:", telemetry.deviceId);
        console.log("Timestamp:", telemetry.timestamp);
        console.log("Data:", telemetry.data);
        const device = await this.findByDeviceId(telemetry.deviceId);

        if (!device) {
          console.warn('[PLUGIN] Telemetry rejected. Unknown device:', telemetry.deviceId);
          return;
        }

        console.log('[PLUGIN] Telemetry approved for:', device.serialNumber);
        console.log('[PLUGIN] Telemetry data:', telemetry.data);
        await this.onTelemetry?.(telemetry);

        return;
      }

      if (topic.endsWith("/status")) {
        const status = message as DeviceStatus;

        console.log("[PLUGIN] Status received");
        console.log("Topic:", topic);
        console.log("Device ID:", status.deviceId);
        console.log("Timestamp:", status.timestamp);
        console.log("Status:", status.status);

        return;
      }

      console.log("[PLUGIN] Unknown topic:", topic);
      console.log("Payload:", message);
    } catch (error) {
      console.error("[PLUGIN] Invalid JSON payload:", error);
    }
  }
}