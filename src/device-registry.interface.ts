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
  status?:any

};
export type DeviceTelemetry = {
  deviceId: string;
  timestamp: string;
  data: Record<string, unknown>;

};

export type DeviceAttributes = Record<string, unknown>;

export type CommandDispatchContext = {
  correlationId?: string;
};

export type DeviceDashboardModuleOptions = {
 // brokerUrl: string;
  findDeviceById: (deviceId: string) => Promise<RegisteredDevice | null>;
  onTelemetry?:(telemetry:DeviceTelemetry)=> Promise <void> | void;
  onAttributes?: (
    deviceId: string,
    attributes: DeviceAttributes,
  ) => Promise<void> | void;
  redis? : any;
  onStatusChange?: (deviceId: string, status: string) => Promise<void>;
  sendCommand: (
    deviceId: string,
    command: string,
    payload?: any,
    context?: CommandDispatchContext,
  ) => Promise<void>;
  getLatestTelemetry: (deviceId: string) => Promise<{ data: any } | null>;
 
};
export interface DeviceRegistry {
    findByDeviceId(deviceId:string):Promise<RegisteredDevice| null> ;
   
}
export const DEVICE_DASHBOARD_OPTIONS = 'DEVICE_DASHBOARD_OPTIONS';
export enum PluginErrorCode {
  DATABASE_FAILURE = 'DATABASE_FAILURE',
  NORMALIZATION_FAILED = 'NORMALIZATION_INTERNAL_FAILURE',
  HOOK_FAILED = 'HOST_APPLICATION_HOOK_FAILED',
  CONFIG_MISSING = 'CONFIG_MISSING',
  CONFIG_MISMATCH='CONFIG_MISMATCH',
  SCHEMA_COMPILE_ERROR='SCHEMA_COMPILE_ERROR',
  INVALID_TIMESTAMP = 'INVALID_TIMESTAMP'
}