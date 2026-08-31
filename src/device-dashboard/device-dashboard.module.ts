

import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { DeviceDashboardController } from './device-dashboard.controller';
import { DeviceDashboardService } from './device-dashboard.service';
import { CommandRedundancyService } from './command-redundancy.service';
import { DeviceCommandService } from './device-command.service';
import { DeviceIngestionService } from './device-ingestion.service';
import { DeviceProfileService } from './device-profile.service';
import {
  DEVICE_DASHBOARD_OPTIONS,
  DeviceDashboardModuleOptions,
} from '../device-registry.interface';

export type DeviceDashboardModuleAsyncOptions = {
  imports?: Array<Type<any> | DynamicModule>;
  useFactory: (
    ...args: any[]
  ) => Promise<DeviceDashboardModuleOptions> | DeviceDashboardModuleOptions;
  inject?: any[];
};

@Module({})
export class DeviceDashboardModule {
  static registerAsync(options: DeviceDashboardModuleAsyncOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: DEVICE_DASHBOARD_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject ?? [],
    };

    return {
      module: DeviceDashboardModule,
      imports: options.imports ?? [],
      controllers: [DeviceDashboardController],
      providers: [
        optionsProvider,
        CommandRedundancyService,
        DeviceProfileService,
        DeviceIngestionService,
        DeviceCommandService,
        DeviceDashboardService,
      ],
      exports: [DeviceDashboardService],
    };
  }
}
