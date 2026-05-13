import { Injectable,ForbiddenException,NotFoundException , ConflictException, InternalServerErrorException} from "@nestjs/common";
import { DeviceDashboardRepository } from "./device-dashboard.repository";
@Injectable()
export class DeviceDashboardService {
    private repository :DeviceDashboardRepository;

    constructor(prisma:any){
        this.repository= new DeviceDashboardRepository(prisma);
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

    async createDevice(data:any, targetUserId:number){
        console.log("plugin kreira uredjaj ", data.name);
        if(!data.name) throw new Error("Device name required!");
      

        try{
            return await this.repository.create({
           data :{ 
            serialNumber : data.serialNumber,
            name:data.name || 'unnamed device',
            type:data.type || 'GENERIC',
             user: {
                connect: { id: targetUserId}
             },
           }
        })
        }catch(error:any){
            console.error('DETALJNA GREŠKA:', error);
            if(error.code ==='P2002'){
                    throw new ConflictException('DEVICE_SERIAL_ALREADY_EXISTS');
            }
            throw new InternalServerErrorException('DATABASE_CONNECTION_ERROR');
        }

    }
}
