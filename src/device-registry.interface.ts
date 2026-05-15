

export type RegisteredDevice = {
  id: string;
  serialNumber: string;
  name?: string | null;
  type?: string | null;
};

export type DeviceDashboardModuleOptions = {
  brokerUrl: string;
  findDeviceById: (deviceId: string) => Promise<RegisteredDevice | null>;
};
export interface DeviceRegistry {
    findByDeviceId(deviceId:string):Promise<RegisteredDevice| null> ;
}
export const DEVICE_DASHBOARD_OPTIONS = 'DEVICE_DASHBOARD_OPTIONS';