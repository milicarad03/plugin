import { MappingDefinition } from "src/mapping-normalizer";



export type RegisteredDevice = {
  id: string;
  serialNumber: string;
  name?: string | null;
  type?: string | null;

 // modelVersionId?: string | null;
  model?: string | null;
  version?: string | null;

  schema?: any;   
  mapping?: any;

};
export type DeviceTelemetry = {
  deviceId: string;
  timestamp: string;
  data: Record<string, unknown>;

};

export type DeviceDashboardModuleOptions = {
 // brokerUrl: string;
  findDeviceById: (deviceId: string) => Promise<RegisteredDevice | null>;
  onTelemetry?:(telemetry:DeviceTelemetry)=> Promise <void> | void;
};
export interface DeviceRegistry {
    findByDeviceId(deviceId:string):Promise<RegisteredDevice| null> ;
   
}
export const DEVICE_DASHBOARD_OPTIONS = 'DEVICE_DASHBOARD_OPTIONS';