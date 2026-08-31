export type TelemetryContext = {
  deviceId: string;
  topic?: string;
  transport?: 'mqtt' | 'http' | 'coap' | string;
};

export type DeviceStatus = {
  deviceId?: string;
  timestamp?: string;
  status: string;
};

export type ProcessingResult = {
  approved: boolean;
  reason?: string;
};
