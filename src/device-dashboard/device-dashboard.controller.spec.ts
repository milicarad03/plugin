import { Test, TestingModule } from '@nestjs/testing';
import { DeviceDashboardController } from './device-dashboard.controller';

describe('DeviceDashboardController', () => {
  let controller: DeviceDashboardController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeviceDashboardController],
    }).compile();

    controller = module.get<DeviceDashboardController>(DeviceDashboardController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
