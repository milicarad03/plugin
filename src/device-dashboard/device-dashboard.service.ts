import { Inject,Injectable,OnModuleInit, OnModuleDestroy,ForbiddenException,NotFoundException , ConflictException, InternalServerErrorException} from "@nestjs/common";
import { DeviceDashboardRepository } from "./device-dashboard.repository";
import { DEVICE_DASHBOARD_OPTIONS} from "../device-registry.interface"
import type  { DeviceDashboardModuleOptions} from "../device-registry.interface"
import { MqttDevicePlugin } from "src/MqttDevicePlugin";
export type DeviceTelemetry = {
  deviceId: string;
  timestamp: string;
  data: Record<string, unknown>;

};

@Injectable()
export class DeviceDashboardService implements OnModuleInit, OnModuleDestroy {
    private mqttPlugin:MqttDevicePlugin;
   
    constructor(
        @Inject(DEVICE_DASHBOARD_OPTIONS)
        private readonly options: DeviceDashboardModuleOptions,
    ){
        
    this.mqttPlugin = new MqttDevicePlugin(
      this.options.brokerUrl,
      this.options.findDeviceById,
      this.options.onTelemetry,
    );
    ;}
    onModuleInit() {
        console.log('[PLUGIN] DeviceDashboardService initialized');
        this.mqttPlugin.connect();
    }

    onModuleDestroy() {
        console.log('[PLUGIN] DeviceDashboardService destroyed');
        this.mqttPlugin.disconnect();
    }

    async approveDevice(device: DeviceTelemetry): Promise <boolean> {
        const dev= await this.options.findDeviceById(device.deviceId);
        
        if(!dev){
            console.warn("[PLUGIN] this device does not exist", device.deviceId)
            return false;
        }
        console.log("[PLUGIN] device approved", device.deviceId)
        return true;
    }
    async checkDevice(deviceId: string) {
    const device = await this.options.findDeviceById(deviceId);

    if (!device) {
      console.log('[PLUGIN] Device does not exist:', deviceId);
      return null;
    }

    console.log('[PLUGIN] Device exists:', device);
    return device;
  }
  

    
    
    getPluginStatus(deviceId:string){

        return{
            id:deviceId,
            pluginName:"DeviceDashboard",
            active:true,
            version:'1.0.0'

        };
    }
    getDashboardConfig(){
        return{
            theme: "cyberpunk",
            widgets:['battery', 'signal', 'uptime']
        };
    }
   
    getDevices() {
        return [
            { id: 1, name: 'Termostat - Dnevna', status: 'online' },
            { id: 2, name: 'Pametna sijalica', status: 'offline' },
            { id: 3, name: 'IP Kamera', status: 'online' }
        ];
    }

   
}
