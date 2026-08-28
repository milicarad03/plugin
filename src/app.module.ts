import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DeviceDashboardModule } from './device-dashboard/device-dashboard.module';

@Module({
  imports: [
    DeviceDashboardModule.register({
      findDeviceById: async () => null,
      sendCommand: async (deviceId, command, payload) => ({
        deviceId,
        command,
        success: true,
      }),
      getLatestTelemetry: async () => null,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}