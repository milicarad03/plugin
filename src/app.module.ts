import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DeviceDashboardModule } from './device-dashboard/device-dashboard.module';
import { DeviceDashboardService } from './device-dashboard/device-dashboard.service';

@Module({
  imports: [DeviceDashboardModule],
  controllers: [AppController],
  providers: [AppService, DeviceDashboardService],
})
export class AppModule {}
