import { DeviceDashboardService } from "../device-dashboard/device-dashboard.service";

describe("DeviceDashboardService E2E", () => {
  let service: DeviceDashboardService;

  const mockOptions = {
    redis: null,
    findDeviceById: jest.fn(),
    onTelemetry: jest.fn(),
  };

  beforeEach(() => {
    service = new DeviceDashboardService(mockOptions as any);
    jest.clearAllMocks();
  });

  it("should process full telemetry flow (no mocks inside service)", async () => {
    const device = {
      model: "modelF",
      schema: {
        type: "object",
        properties: {
          schemaId: { const: "modelF" },
          value: { type: "number" }
        },
        required: ["schemaId", "value"]
      },
      mapping: {
        fields: {
          val: { path: "value" }
        }
      }
    };

    mockOptions.findDeviceById.mockResolvedValue(device);

    const result = await service.processTelemetry(
      { value: 42 },
      { deviceId: "dev-1" }
    );

    expect(result.approved).toBe(true);

    expect(mockOptions.onTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "dev-1",
        data: { val: 42 }
      })
    );
  });

  it("should reject invalid telemetry end-to-end", async () => {
    mockOptions.findDeviceById.mockResolvedValue({
      model: "modelF",
      schema: {
        type: "object",
        properties: {
          schemaId: { const: "modelF" },
          value: { type: "number" }
        },
        required: ["schemaId", "value"]
      },
      mapping: { fields: { val: { path: "value" } } }
    });

    const result = await service.processTelemetry(
      { value: "wrong" },
      { deviceId: "dev-1" }
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("INVALID_TELEMETRY_SCHEMA");
  });

  it("should reject if device is not found", async () => {
    mockOptions.findDeviceById.mockResolvedValue(null);

    const result = await service.processTelemetry(
      { value: 42 },
      { deviceId: "unknown-dev" }
    );

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("DEVICE_NOT_FOUND");
  });
});
