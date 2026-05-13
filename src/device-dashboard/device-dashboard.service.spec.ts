import { Test, TestingModule } from '@nestjs/testing';
import { DeviceDashboardService } from './device-dashboard.service';

describe('DeviceDashboardService', () => {
  let service: DeviceDashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DeviceDashboardService],
    }).compile();

    service = module.get<DeviceDashboardService>(DeviceDashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
