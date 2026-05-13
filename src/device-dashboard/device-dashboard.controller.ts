
import { Controller, Get } from '@nestjs/common';
import { DeviceDashboardService } from './device-dashboard.service';

@Controller('device-dashboard')
export class DeviceDashboardController {
  constructor(private readonly deviceService: DeviceDashboardService) {}

 
  @Get()
  getHello() {
    return {
      status: 'Plugin is active',
      message: 'Welcome to the Device Dashboard API'
    };
  }

  
  @Get('status')
  getStatus() {
    return this.deviceService.getDashboardConfig();
  }
  
  @Get('devices')
  getDevices() {
    return this.deviceService.getDevices();
  }

}